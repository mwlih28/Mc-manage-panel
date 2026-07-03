import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Server, Node } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

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

  await prisma.activity.create({
    data: {
      userId: opts.userId,
      serverId: server.id,
      event: 'server:backup.start',
      properties: JSON.stringify({ name: backup.name }),
    },
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
    } catch (err) {
      logger.warn(`Backup ${backup.uuid} failed for server ${server.uuid}: ${(err as Error).message}`);
    }
  };

  return { backup, run };
}
