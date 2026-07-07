import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import archiver from 'archiver';
import SftpClient from 'ssh2-sftp-client';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { createServerOnNode } from './wingsClient';
import { logger } from '../utils/logger';

const APP_API_TIMEOUT_MS = 15000;
// A full server (world saves, plugin jars) can be large — generous enough
// not to abort a legitimately slow transfer, matching this codebase's
// existing backup/restore/migration timeout norm.
const TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;
// Covers the SFTP pull off the source host (buildImportArchive) — the step
// that actually takes the longest for a many-GB world with thousands of
// region files, and unlike the upload-to-Wings step below had no timeout at
// all: a stalled source connection would hang the background job forever
// with nothing surfaced to the admin. Longer than TRANSFER_TIMEOUT_MS since
// pulling thousands of small files one SFTP round-trip at a time is
// inherently slower than one streamed upload.
const SFTP_PULL_TIMEOUT_MS = 45 * 60 * 1000;
const SFTP_CONNECT_TIMEOUT_MS = 20 * 1000;

export interface PterodactylServerSummary {
  id: number;
  uuid: string;
  name: string;
  memory: number;
  disk: number;
  eggId: number;
}

function ptClient(url: string, apiKey: string) {
  return axios.create({
    baseURL: url.replace(/\/+$/, ''),
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    timeout: APP_API_TIMEOUT_MS,
  });
}

export async function testPterodactylConnection(url: string, apiKey: string): Promise<void> {
  await ptClient(url, apiKey).get('/api/application/servers', { params: { per_page: 1 } });
}

// Paginates through the Application API's server list — the same endpoint
// `testPterodactylConnection` sanity-checks against.
export async function listPterodactylServers(url: string, apiKey: string): Promise<PterodactylServerSummary[]> {
  const client = ptClient(url, apiKey);
  const all: PterodactylServerSummary[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.get('/api/application/servers', { params: { per_page: 50, page } });
    for (const row of data.data || []) {
      const a = row.attributes;
      all.push({ id: a.id, uuid: a.uuid, name: a.name, memory: a.limits?.memory || 0, disk: a.limits?.disk || 0, eggId: a.egg });
    }
    const pagination = data.meta?.pagination;
    if (!pagination || page >= pagination.total_pages) break;
    page++;
  }
  return all;
}

export interface SourceSftpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  volumesPath?: string;
}

export interface ImportSelection {
  sourceServerId: number;
  sourceUuid: string;
  name: string;
  memory: number;
  disk: number;
  destinationNodeId: string;
  destinationEggId: string;
}

interface JobLogEntry {
  ts: string;
  serverName: string;
  status: 'ok' | 'error';
  message: string;
}

async function appendJobLog(jobId: string, entry: JobLogEntry) {
  const job = await prisma.migrationJob.findUnique({ where: { id: jobId } });
  const log: JobLogEntry[] = job ? JSON.parse(job.log) : [];
  log.push(entry);
  await prisma.migrationJob.update({ where: { id: jobId }, data: { log: JSON.stringify(log) } });
}

// Recursively archives a remote SFTP directory into an already-open
// archiver instance. Files are pulled one at a time as buffers (not
// streamed in parallel) to keep memory bounded to a single file — adequate
// for a v1 migration tool, not tuned for many-GB single files.
async function archiveRemoteDir(sftp: SftpClient, baseDir: string, currentDir: string, archive: archiver.Archiver): Promise<void> {
  const entries = await sftp.list(currentDir);
  for (const entry of entries) {
    const remotePath = `${currentDir}/${entry.name}`;
    if (entry.type === 'd') {
      await archiveRemoteDir(sftp, baseDir, remotePath, archive);
    } else if (entry.type === '-') {
      const buffer = await sftp.get(remotePath) as Buffer;
      const relativePath = path.posix.relative(baseDir, remotePath);
      archive.append(buffer, { name: relativePath });
    }
    // Symlinks (type 'l') are skipped — Pterodactyl server directories don't
    // typically rely on them, and following them risks escaping the volume.
  }
}

// Pulls one server's files off the source Wings host's disk via SFTP into a
// local tar.gz (same format Wings' own createBackup() produces), ready to
// hand to the destination node's existing backup-upload endpoint.
async function buildImportArchive(ssh: SourceSftpConfig, sourceUuid: string): Promise<string> {
  const client = new SftpClient();
  await client.connect({
    host: ssh.host,
    port: ssh.port || 22,
    username: ssh.username,
    password: ssh.password || undefined,
    privateKey: ssh.privateKey || undefined,
    readyTimeout: SFTP_CONNECT_TIMEOUT_MS,
  });

  const volumesPath = (ssh.volumesPath || '/var/lib/pterodactyl/volumes').replace(/\/+$/, '');
  const remoteDir = `${volumesPath}/${sourceUuid}`;
  const tmpFile = path.join(os.tmpdir(), `kretase-import-${sourceUuid}-${Date.now()}.tar.gz`);

  try {
    await new Promise<void>((resolve, reject) => {
      // A stalled source connection (network blip, source host hangs
      // mid-directory) would otherwise leave this promise — and the whole
      // background job — pending forever with nothing surfaced to the admin.
      const timer = setTimeout(
        () => reject(new Error(`SFTP transfer from source host timed out after ${SFTP_PULL_TIMEOUT_MS / 60000} minutes`)),
        SFTP_PULL_TIMEOUT_MS
      );
      const output = fs.createWriteStream(tmpFile);
      const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
      output.on('close', () => { clearTimeout(timer); resolve(); });
      archive.on('error', (err) => { clearTimeout(timer); reject(err); });
      archive.pipe(output);
      archiveRemoteDir(client, remoteDir, remoteDir, archive)
        .then(() => archive.finalize())
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  } catch (err) {
    // The caller only unlinks tmpFile on the happy path (it never learns
    // the path if this function throws) — clean up the partial file
    // ourselves so a timeout or mid-transfer failure doesn't leak a
    // multi-GB half-written archive in the OS temp dir.
    fs.unlink(tmpFile, () => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }

  return tmpFile;
}

function generateShortUuid(): string {
  return uuidv4().replace(/-/g, '').slice(0, 8);
}

// Provisions one Kretase server (allocation + DB row + Wings registration),
// mirroring POST /servers' essential logic. Kept separate from that route
// rather than a shared extraction — the route's inline validation/response
// shaping doesn't map cleanly onto a programmatic bulk-import caller.
async function provisionImportedServer(sel: ImportSelection, ownerUserId: string) {
  const [node, egg] = await Promise.all([
    prisma.node.findUnique({ where: { id: sel.destinationNodeId } }),
    prisma.egg.findUnique({ where: { id: sel.destinationEggId }, include: { variables: true } }),
  ]);
  if (!node) throw new Error('Destination node not found');
  if (!egg) throw new Error('Destination egg not found');

  const isBedrockEgg = egg.name.toLowerCase().includes('bedrock') || egg.startup.includes('bedrock_server');

  const server = await prisma.$transaction(async (tx) => {
    const freeAlloc = await tx.allocation.findFirst({ where: { nodeId: node.id, assigned: false }, orderBy: { port: 'asc' } });
    let allocationId: string;
    let port: number;
    if (freeAlloc) {
      await tx.allocation.update({ where: { id: freeAlloc.id }, data: { assigned: true } });
      allocationId = freeAlloc.id;
      port = freeAlloc.port;
    } else {
      const highest = await tx.allocation.findFirst({ where: { nodeId: node.id }, orderBy: { port: 'desc' } });
      const basePort = isBedrockEgg ? 19132 : 25565;
      port = highest ? highest.port + 1 : basePort;
      const created = await tx.allocation.create({ data: { nodeId: node.id, ip: node.fqdn, port, assigned: true } });
      allocationId = created.id;
    }

    return tx.server.create({
      data: {
        uuid: uuidv4(),
        uuidShort: generateShortUuid(),
        name: sel.name,
        userId: ownerUserId,
        nodeId: node.id,
        eggId: egg.id,
        allocationId,
        memory: sel.memory,
        disk: sel.disk,
        startup: egg.startup,
        image: egg.dockerImage,
        env: JSON.stringify({
          SERVER_MEMORY: String(sel.memory),
          SERVER_JARFILE: 'server.jar',
          SERVER_IDENT: generateShortUuid(),
          ...Object.fromEntries((egg.variables || []).map((v) => [v.envVariable, v.defaultValue])),
          SERVER_PORT: String(port),
          QUERY_PORT: String(port + 1),
          RCON_PORT: String(port + 2),
        }),
        status: 'INSTALLING',
      },
      include: {
        node: { select: { id: true, fqdn: true, daemonPort: true, scheme: true, token: true } },
        egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
      },
    });
  });

  if (server.node) {
    await createServerOnNode(server as Parameters<typeof createServerOnNode>[0]);
  }

  return server;
}

export async function runPterodactylImport(
  jobId: string,
  ssh: SourceSftpConfig,
  selections: ImportSelection[],
  ownerUserId: string
): Promise<void> {
  await prisma.migrationJob.update({ where: { id: jobId }, data: { status: 'running' } });

  let anyFailed = false;
  for (const sel of selections) {
    try {
      const server = await provisionImportedServer(sel, ownerUserId);
      if (!server.node) throw new Error('Destination node has no Wings connection configured');

      const archivePath = await buildImportArchive(ssh, sel.sourceUuid);
      try {
        const importUuid = uuidv4();
        const client = axios.create({
          baseURL: `${server.node.scheme}://${server.node.fqdn}:${server.node.daemonPort}/api`,
          headers: { Authorization: `Bearer ${server.node.token}` },
          timeout: TRANSFER_TIMEOUT_MS,
        });
        await client.post(
          `/servers/${server.uuid}/backups/${importUuid}/upload`,
          fs.createReadStream(archivePath),
          { headers: { 'Content-Type': 'application/octet-stream' } }
        );
        await client.delete(`/servers/${server.uuid}/backups/${importUuid}`).catch(() => {});
      } finally {
        fs.unlink(archivePath, () => {});
      }

      await prisma.server.update({ where: { id: server.id }, data: { status: 'OFFLINE' } });
      await appendJobLog(jobId, { ts: new Date().toISOString(), serverName: sel.name, status: 'ok', message: 'Imported successfully' });
    } catch (err) {
      anyFailed = true;
      logger.error(`Pterodactyl import failed for "${sel.name}": ${(err as Error).message}`);
      await appendJobLog(jobId, { ts: new Date().toISOString(), serverName: sel.name, status: 'error', message: (err as Error).message });
    }
  }

  await prisma.migrationJob.update({ where: { id: jobId }, data: { status: anyFailed ? 'failed' : 'completed' } });
}
