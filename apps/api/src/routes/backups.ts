import { Router, Response } from 'express';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { authenticate, requireScope } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getWingsClient } from './servers';
import { startBackup } from '../services/backupService';
import { logActivity } from '../services/activityService';
import { logger } from '../utils/logger';
import { buildAdapter, getStorageConf } from '../services/storage';

const router = Router({ mergeParams: true });

// Archiving a large world can take minutes — the panel's own response to
// the frontend doesn't wait on this, but the underlying call to Wings needs
// a timeout generous enough not to abort a legitimately slow backup.
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

// GET /servers/:serverId/backups
router.get('/', authenticate, requireScope('servers:read'), async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.serverId,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const backups = await prisma.backup.findMany({
    where: { serverId: server.id },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ data: backups });
});

// POST /servers/:serverId/backups
router.post('/', authenticate, requireScope('servers:write'), async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.serverId,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
    include: { node: true },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });
  if (!server.node) return res.status(422).json({ message: 'Server has no assigned node' });

  const backupCount = await prisma.backup.count({
    where: { serverId: server.id },
  });

  if (server.backupLimit > 0 && backupCount >= server.backupLimit) {
    return res.status(400).json({ message: 'Backup limit reached' });
  }

  const { name, ignoredFiles } = req.body;
  const { backup, run } = await startBackup(server, { name, ignoredFiles, userId: req.user!.id });

  // Respond immediately with the pending row — the frontend polls until
  // isSuccessful flips. The actual archiving happens on Wings and can take
  // a while, so it isn't awaited here.
  res.status(201).json({ data: backup });
  run();
});

// DELETE /servers/:serverId/backups/:backupId
router.delete('/:backupId', authenticate, requireScope('servers:write'), async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.serverId,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
    include: { node: true },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const backup = await prisma.backup.findFirst({
    where: { id: req.params.backupId, serverId: server.id },
  });

  if (!backup) return res.status(404).json({ message: 'Backup not found' });
  if (backup.isLocked) return res.status(400).json({ message: 'Backup is locked' });

  if (server.node) {
    try {
      await axios.delete(
        `${server.node.scheme}://${server.node.fqdn}:${server.node.daemonPort}/api/servers/${server.uuid}/backups/${backup.uuid}`,
        { headers: { Authorization: `Bearer ${server.node.token}` }, timeout: 15000 }
      );
    } catch (err) {
      logger.warn(`Could not delete backup file for ${backup.uuid}: ${(err as Error).message}`);
    }
  }

  if (backup.disk !== 'local' && backup.remotePath) {
    const conf = await getStorageConf();
    if (conf['storage.provider'] !== backup.disk) {
      logger.warn(`Skipping cloud delete of backup ${backup.uuid}: stored on ${backup.disk}, active destination is ${conf['storage.provider'] || 'none'}`);
    } else {
      const adapter = buildAdapter(conf);
      if (adapter) {
        await adapter.delete(backup.remotePath).catch((err) => {
          logger.warn(`Could not delete cloud copy of backup ${backup.uuid}: ${(err as Error).message}`);
        });
      }
    }
  }

  await prisma.backup.delete({ where: { id: backup.id } });

  return res.status(204).send();
});

// POST /servers/:serverId/backups/:backupId/restore
router.post('/:backupId/restore', authenticate, requireScope('servers:write'), async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const ctx = await getWingsClient(req.params.serverId, req.user!.id, isAdmin);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  const { server } = ctx;

  const backup = await prisma.backup.findFirst({
    where: { id: req.params.backupId, serverId: server.id, isSuccessful: true },
  });

  if (!backup) return res.status(404).json({ message: 'Backup not found or not successful' });

  let adapter = null;
  if (backup.disk !== 'local') {
    if (!backup.remotePath) return res.status(422).json({ message: 'Backup has no stored remote path' });
    const conf = await getStorageConf();
    if (conf['storage.provider'] !== backup.disk) {
      return res.status(409).json({
        message: `This backup was stored on "${backup.disk}" but the panel's active cloud destination is now "${conf['storage.provider'] || 'none'}". Restore the original destination settings to recover it.`,
      });
    }
    adapter = buildAdapter(conf);
    if (!adapter) return res.status(500).json({ message: 'Cloud destination is misconfigured' });
  }

  await prisma.server.update({
    where: { id: server.id },
    data: { status: 'RESTORING_BACKUP' },
  });

  res.json({ message: 'Restore initiated' });

  try {
    if (adapter && backup.remotePath) {
      // Cloud-backed: pull the archive down and hand it to Wings' existing
      // upload endpoint, which already writes it to disk and restores it as
      // a side effect (the same endpoint cross-node migration/clone use) —
      // no new Wings route needed.
      const stream = await adapter.download(backup.remotePath);
      await ctx.client.post(`/servers/${server.uuid}/backups/${backup.uuid}/upload`, stream, {
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: BACKUP_TIMEOUT_MS,
      });
    } else {
      await ctx.client.post(`/servers/${server.uuid}/backups/${backup.uuid}/restore`, {}, { timeout: BACKUP_TIMEOUT_MS });
    }
    await logActivity({ userId: req.user!.id, serverId: server.id, event: 'server:backup.restore', properties: JSON.stringify({ name: backup.name }), ip: req.ip });
  } catch (err) {
    logger.warn(`Restore of backup ${backup.uuid} failed for server ${server.uuid}: ${(err as Error).message}`);
  } finally {
    await prisma.server.update({ where: { id: server.id }, data: { status: 'OFFLINE' } });
  }
});

export default router;
