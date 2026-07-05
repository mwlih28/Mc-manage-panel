import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Server, Node } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logActivity } from './activityService';
import { logger } from '../utils/logger';
import { buildAdapter, getStorageConf } from './storage';

// Archiving a large world can take minutes — callers that have an HTTP
// response to give back (the backups route) don't wait on this; the
// scheduler, which has no such response, awaits it directly.
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

// Creates the DB row + activity log synchronously, then hands back a `run`
// function that does the actual Wings archiving and flips isSuccessful —
// split this way so both an HTTP route (respond immediately, run in the
// background) and the scheduler (no response to give, just await it) can
// share the exact same backup logic instead of drifting apart.
export async function startBackup(
  server: Server & { node: Node | null },
  opts: { name?: string; ignoredFiles?: string[]; userId?: string } = {}
): Promise<{ backup: Awaited<ReturnType<typeof prisma.backup.create>>; run: () => Promise<void> }> {
  if (!server.node) throw new Error('Server has no assigned node');
  const node = server.node;

  const backup = await prisma.backup.create({
    data: {
      serverId: server.id,
      uuid: uuidv4(),
      name: opts.name || `Backup ${new Date().toISOString()}`,
      ignoredFiles: JSON.stringify(opts.ignoredFiles || []),
      isSuccessful: false,
    },
  });

  await logActivity({
    userId: opts.userId,
    serverId: server.id,
    event: 'server:backup.start',
    properties: JSON.stringify({ name: backup.name }),
  });

  const run = async () => {
    const client = axios.create({
      baseURL: `${node.scheme}://${node.fqdn}:${node.daemonPort}/api`,
      headers: { Authorization: `Bearer ${node.token}` },
      timeout: BACKUP_TIMEOUT_MS,
    });
    try {
      const { data } = await client.post(`/servers/${server.uuid}/backups`, {
        backupUuid: backup.uuid,
        ignoredFiles: opts.ignoredFiles || [],
      });
      await prisma.backup.update({
        where: { id: backup.id },
        data: {
          isSuccessful: true,
          bytes: BigInt(data.size || 0),
          checksum: data.checksum || null,
          completedAt: new Date(),
        },
      });
      await logActivity({
        userId: opts.userId,
        serverId: server.id,
        event: 'server:backup.complete',
        properties: JSON.stringify({ name: backup.name }),
      });

      // Cloud upload is a best-effort extra step on top of an already-
      // successful local backup — a failure here must never flip
      // isSuccessful back to false or discard the local archive Wings
      // already made.
      try {
        const conf = await getStorageConf();
        const adapter = buildAdapter(conf);
        if (adapter) {
          const download = await client.get(`/servers/${server.uuid}/backups/${backup.uuid}/download`, {
            responseType: 'stream',
          });
          const { remotePath } = await adapter.upload(download.data, `${server.uuid}/${backup.uuid}.tar.gz`);
          await prisma.backup.update({
            where: { id: backup.id },
            data: { disk: conf['storage.provider'], remotePath },
          });
          if (conf['storage.deleteLocalAfterUpload'] === 'true') {
            await client.delete(`/servers/${server.uuid}/backups/${backup.uuid}`).catch((e) => {
              logger.warn(`Could not remove local copy of backup ${backup.uuid} after cloud upload: ${(e as Error).message}`);
            });
          }
        }
      } catch (err) {
        logger.warn(`Cloud upload failed for backup ${backup.uuid}, local copy retained: ${(err as Error).message}`);
      }
    } catch (err) {
      logger.warn(`Backup ${backup.uuid} failed for server ${server.uuid}: ${(err as Error).message}`);
      await logActivity({
        userId: opts.userId,
        serverId: server.id,
        event: 'server:backup.failed',
        properties: JSON.stringify({ name: backup.name, error: (err as Error).message }),
      });
    }
  };

  return { backup, run };
}
