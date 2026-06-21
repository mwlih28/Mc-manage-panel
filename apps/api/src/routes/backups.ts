import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router({ mergeParams: true });

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
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

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

  // Simulate backup completion after creation
  setTimeout(async () => {
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        isSuccessful: true,
        bytes: Math.floor(Math.random() * 104857600) + 1048576,
        completedAt: new Date(),
        checksum: uuidv4().replace(/-/g, ''),
      },
    });
  }, 3000);

  await prisma.activity.create({
    data: {
      userId: req.user!.id,
      serverId: server.id,
      event: 'server:backup.start',
      ip: req.ip,
    },
  });

  return res.status(201).json({ data: backup });
});

// DELETE /servers/:serverId/backups/:backupId
router.delete('/:backupId', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.serverId,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const backup = await prisma.backup.findFirst({
    where: { id: req.params.backupId, serverId: server.id },
  });

  if (!backup) return res.status(404).json({ message: 'Backup not found' });
  if (backup.isLocked) return res.status(400).json({ message: 'Backup is locked' });

  await prisma.backup.delete({ where: { id: backup.id } });

  return res.status(204).send();
});

// POST /servers/:serverId/backups/:backupId/restore
router.post('/:backupId/restore', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.serverId,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const backup = await prisma.backup.findFirst({
    where: { id: req.params.backupId, serverId: server.id, isSuccessful: true },
  });

  if (!backup) return res.status(404).json({ message: 'Backup not found or not successful' });

  await prisma.server.update({
    where: { id: server.id },
    data: { status: 'RESTORING_BACKUP' },
  });

  return res.json({ message: 'Restore initiated' });
});

export default router;
