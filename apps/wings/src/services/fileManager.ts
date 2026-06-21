import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
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

export async function writeFile(uuid: string, filePath: string, content: string): Promise<void> {
  const root = getServerRoot(uuid);
  const target = safePath(root, filePath);
  const dir = path.dirname(target);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
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

export async function createBackup(uuid: string, name: string, ignored: string[]): Promise<{
  path: string;
  size: number;
  checksum: string;
}> {
  const root = getServerRoot(uuid);
  const cfg = getConfig();
  const backupDir = path.join(cfg.system.data, '..', 'backups', uuid);
  fs.mkdirSync(backupDir, { recursive: true });

  const backupFile = path.join(backupDir, `${name}.tar.gz`);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupFile);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });

    output.on('close', () => {
      const stat = fs.statSync(backupFile);
      resolve({ path: backupFile, size: stat.size, checksum: '' });
    });

    archive.on('error', reject);
    archive.pipe(output);

    archive.glob('**/*', {
      cwd: root,
      ignore: [...ignored, '*.log', '*.lock'],
      dot: false,
    });

    archive.finalize();
  });
}
