import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import * as tar from 'tar';
import { getConfig } from '../config';
import { logger } from '../utils/logger';

function getServerRoot(uuid: string): string {
  const cfg = getConfig();
  return path.join(cfg.system.data, uuid);
}

function safePath(root: string, filePath: string): string {
  const resolved = path.resolve(root, filePath.replace(/^\/+/, ''));
  if (!resolved.startsWith(root)) {
    throw new Error('Path traversal attempt detected');
  }
  return resolved;
}

export interface FileEntry {
  name: string;
  size: number;
  mode: string;
  isFile: boolean;
  isDir: boolean;
  isSymlink: boolean;
  modifiedAt: Date;
}

export async function listDirectory(uuid: string, dirPath = '/'): Promise<FileEntry[]> {
  const root = getServerRoot(uuid);
  const target = safePath(root, dirPath);

  if (!fs.existsSync(target)) return [];

  const entries = fs.readdirSync(target, { withFileTypes: true });
  return entries.map(entry => {
    const fullPath = path.join(target, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return null;
    }
    return {
      name: entry.name,
      size: stat.size,
      mode: (stat.mode & 0o777).toString(8),
      isFile: entry.isFile(),
      isDir: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
      modifiedAt: stat.mtime,
    } as FileEntry;
  }).filter(Boolean) as FileEntry[];
}

export async function readFile(uuid: string, filePath: string): Promise<string> {
  const root = getServerRoot(uuid);
  const target = safePath(root, filePath);

  if (!fs.existsSync(target)) throw new Error('File not found');
  const stat = fs.statSync(target);
  if (stat.size > 5 * 1024 * 1024) throw new Error('File too large to edit (>5MB)');

  return fs.readFileSync(target, 'utf8');
}

export async function writeFile(uuid: string, filePath: string, content: string, encoding: 'utf8' | 'base64' = 'utf8'): Promise<void> {
  const root = getServerRoot(uuid);
  const target = safePath(root, filePath);
  const dir = path.dirname(target);

  fs.mkdirSync(dir, { recursive: true });
  // File may be owned by container uid 1000; unlink first so we can recreate it
  // as the Wings process user. Directory write permission is sufficient to unlink.
  if (fs.existsSync(target)) {
    try { fs.unlinkSync(target); } catch { /* fall through */ }
  }
  const data = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  fs.writeFileSync(target, data, { mode: 0o666 });
  logger.debug(`File written: ${filePath} for server ${uuid}`);
}

export async function deleteFiles(uuid: string, filePaths: string[]): Promise<void> {
  const root = getServerRoot(uuid);
  for (const filePath of filePaths) {
    const target = safePath(root, filePath);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    logger.debug(`Deleted: ${filePath} for server ${uuid}`);
  }
}

export async function createDirectory(uuid: string, dirPath: string): Promise<void> {
  const root = getServerRoot(uuid);
  const target = safePath(root, dirPath);
  fs.mkdirSync(target, { recursive: true });
}

export async function renameFile(uuid: string, from: string, to: string): Promise<void> {
  const root = getServerRoot(uuid);
  const fromPath = safePath(root, from);
  const toPath = safePath(root, to);
  fs.renameSync(fromPath, toPath);
}

function getBackupDir(serverUuid: string): string {
  const cfg = getConfig();
  return path.join(cfg.system.data, '..', 'backups', serverUuid);
}

// Backups are keyed by the panel's Backup.uuid (not the user-facing display
// name, which isn't guaranteed unique or filesystem-safe) so multiple
// backups of the same server never collide.
export function getBackupFilePath(serverUuid: string, backupUuid: string): string {
  return path.join(getBackupDir(serverUuid), `${backupUuid}.tar.gz`);
}

export async function createBackup(serverUuid: string, backupUuid: string, ignored: string[]): Promise<{
  size: number;
  checksum: string;
}> {
  const root = getServerRoot(serverUuid);
  const backupDir = getBackupDir(serverUuid);
  fs.mkdirSync(backupDir, { recursive: true });

  const backupFile = getBackupFilePath(serverUuid, backupUuid);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(backupFile);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    archive.glob('**/*', {
      cwd: root,
      ignore: [...ignored, '*.log', '*.lock'],
      dot: false,
    });

    archive.finalize();
  });

  const stat = fs.statSync(backupFile);
  const checksum = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(backupFile);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });

  return { size: stat.size, checksum };
}

// Extracts on top of the existing server directory rather than wiping it
// first — matches how most backup tools restore (a damaged extraction still
// leaves the original files intact instead of destroying them first).
export async function restoreBackup(serverUuid: string, backupUuid: string): Promise<void> {
  const root = getServerRoot(serverUuid);
  const backupFile = getBackupFilePath(serverUuid, backupUuid);
  if (!fs.existsSync(backupFile)) throw new Error('Backup file not found on this node');

  fs.mkdirSync(root, { recursive: true });
  await tar.extract({ file: backupFile, cwd: root });
  logger.info(`Restored backup ${backupUuid} onto server ${serverUuid}`);
}

export function deleteBackupFile(serverUuid: string, backupUuid: string): void {
  const backupFile = getBackupFilePath(serverUuid, backupUuid);
  if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
}

// ── World management ──────────────────────────────────────────────────────────

function dirSizeSync(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeSync(full);
    else if (entry.isFile()) {
      try { total += fs.statSync(full).size; } catch { /* ignore races with concurrent writes */ }
    }
  }
  return total;
}

// A world folder is one containing level.dat at its root. Downloaded world
// zips commonly wrap the actual world in a single named subfolder, so this
// checks the given dir and, failing that, one level of subdirectories.
function findLevelDatRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, 'level.dat'))) return dir;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name);
      if (fs.existsSync(path.join(sub, 'level.dat'))) return sub;
    }
  }
  return null;
}

export interface WorldEntry {
  name: string;
  size: number;
  active: boolean;
}

export async function listWorlds(uuid: string): Promise<WorldEntry[]> {
  const root = getServerRoot(uuid);
  const active = getActiveWorldName(uuid);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const worlds: WorldEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (fs.existsSync(path.join(full, 'level.dat'))) {
      worlds.push({ name: entry.name, size: dirSizeSync(full), active: entry.name === active });
    }
  }
  return worlds;
}

export function getActiveWorldName(uuid: string): string {
  const root = getServerRoot(uuid);
  const propsPath = path.join(root, 'server.properties');
  if (!fs.existsSync(propsPath)) return 'world';
  const content = fs.readFileSync(propsPath, 'utf8');
  const match = content.match(/^level-name=(.*)$/m);
  return match ? match[1].trim() || 'world' : 'world';
}

export async function setActiveWorldName(uuid: string, worldName: string): Promise<void> {
  const root = getServerRoot(uuid);
  const propsPath = path.join(root, 'server.properties');
  let content = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, 'utf8') : '';
  if (/^level-name=.*$/m.test(content)) {
    content = content.replace(/^level-name=.*$/m, `level-name=${worldName}`);
  } else {
    content += `${content.endsWith('\n') || content === '' ? '' : '\n'}level-name=${worldName}\n`;
  }
  fs.writeFileSync(propsPath, content, { mode: 0o666 });
}

// Downloads happen via a URL fetched by the route handler into a temp zip
// file — this just handles extraction, world-root detection, and placing it
// under the server as a new world folder.
export async function installWorldFromZipFile(uuid: string, zipPath: string, worldName: string): Promise<void> {
  const root = getServerRoot(uuid);
  const safeName = worldName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'world';
  const target = safePath(root, safeName);
  if (fs.existsSync(target)) throw new Error(`A world named "${safeName}" already exists`);

  const tmpDir = path.join(os.tmpdir(), `mc_world_${Date.now()}_${uuid}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    await extractZip(zipPath, { dir: tmpDir });
    const worldRoot = findLevelDatRoot(tmpDir);
    if (!worldRoot) throw new Error('No level.dat found in the downloaded world archive');
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(worldRoot, target, { recursive: true });
    logger.info(`World "${safeName}" installed for ${uuid}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function createWorldZipStream(uuid: string, worldName: string): archiver.Archiver {
  const root = getServerRoot(uuid);
  const worldPath = safePath(root, worldName);
  if (!fs.existsSync(path.join(worldPath, 'level.dat'))) {
    throw new Error('Not a valid world folder');
  }
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.directory(worldPath, worldName);
  archive.finalize();
  return archive;
}
