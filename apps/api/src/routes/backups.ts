import { Router, Response } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getWingsClient } from './servers';
import { logger } from '../utils/logger';

const router = Router({ mergeParams: true });

// Archiving a large world can take minutes — the panel's own response to
// the frontend doesn't wait on this, but the underlying call to Wings needs
// a timeout generous enough not to abort a legitimately slow backup.
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

// GET /servers/:serverId/backups
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
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
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
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

  const backup = await prisma.backup.create({
    data: {
      serverId: server.id,
      uuid: uuidv4(),
      name: name || `Backup ${new Date().toISOString()}`,
      ignoredFiles: JSON.stringify(ignoredFiles || []),
      isSuccessful: false,
    },
  });

  await prisma.activity.create({
    data: {
      userId: req.user!.id,
      serverId: server.id,
      event: 'server:backup.start',
      properties: JSON.stringify({ name: backup.name }),
      ip: req.ip,
    },
  });

  // Respond immediately with the pending row — the frontend polls until
  // isSuccessful flips. The actual archiving happens on Wings and can take
  // a while, so it isn't awaited here.
  res.status(201).json({ data: backup });

  const node = server.node;
  const client = axios.create({
    baseURL: `${node.scheme}://${node.fqdn}:${node.daemonPort}/api`,
    headers: { Authorization: `Bearer ${node.token}` },
    timeout: BACKUP_TIMEOUT_MS,
  });

  try {
    const { data } = await client.post(`/servers/${server.uuid}/backups`, {
      backupUuid: backup.uuid,
      ignoredFiles: ignoredFiles || [],
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
});

// DELETE /servers/:serverId/backups/:backupId
router.delete('/:backupId', authenticate, async (req: AuthRequest, res: Response) => {
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

  await prisma.backup.delete({ where: { id: backup.id } });

  return res.status(204).send();
});

// POST /servers/:serverId/backups/:backupId/restore
router.post('/:backupId/restore', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const ctx = await getWingsClient(req.params.serverId, req.user!.id, isAdmin);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  const { server } = ctx;

  const backup = await prisma.backup.findFirst({
    where: { id: req.params.backupId, serverId: server.id, isSuccessful: true },
  });

  if (!backup) return res.status(404).json({ message: 'Backup not found or not successful' });

  await prisma.server.update({
    where: { id: server.id },
    data: { status: 'RESTORING_BACKUP' },
  });

  res.json({ message: 'Restore initiated' });

  try {
    await ctx.client.post(`/servers/${server.uuid}/backups/${backup.uuid}/restore`, {}, { timeout: BACKUP_TIMEOUT_MS });
    await prisma.activity.create({
      data: { userId: req.user!.id, serverId: server.id, event: 'server:backup.restore', properties: JSON.stringify({ name: backup.name }), ip: req.ip },
    });
  } catch (err) {
    logger.warn(`Restore of backup ${backup.uuid} failed for server ${server.uuid}: ${(err as Error).message}`);
  } finally {
    await prisma.server.update({ where: { id: server.id }, data: { status: 'OFFLINE' } });
  }
});

export default router;
