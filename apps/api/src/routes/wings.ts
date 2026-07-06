import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma';
import { getNodeServers } from '../services/wingsClient';
import { logger } from '../utils/logger';

const router = Router();

// A node's SFTP server relays every login attempt from every one of its
// SFTP clients here — this is the real brute-force choke point, on top of
// whatever Wings itself does at the SSH layer.
const sftpAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

// Wings daemon authenticates to get node info
// POST /api/v1/wings/auth
router.post('/auth', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Token required' });

  const node = await prisma.node.findUnique({ where: { token } });
  if (!node) return res.status(401).json({ message: 'Invalid token' });

  // Mark node as online
  await prisma.node.update({
    where: { id: node.id },
    data: { status: 'ONLINE' },
  });

  logger.info(`Node authenticated: ${node.name} (${node.fqdn})`);
  return res.json({ uuid: node.id, name: node.name, nodeId: node.id });
});

// Wings daemon pulls server list
// GET /api/v1/wings/servers
router.get('/servers', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Token required' });

  const node = await prisma.node.findUnique({ where: { token } });
  if (!node) return res.status(401).json({ message: 'Invalid token' });

  const servers = await getNodeServers(node.id);
  return res.json({ servers });
});

// Wings daemon reports server status
// POST /api/v1/wings/servers/:uuid/status
router.post('/servers/:uuid/status', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Token required' });

  const node = await prisma.node.findUnique({ where: { token } });
  if (!node) return res.status(401).json({ message: 'Invalid token' });

  const { uuid } = req.params;
  const { status } = req.body;

  const validStatuses = [
    'OFFLINE', 'STARTING', 'RUNNING', 'STOPPING',
    'INSTALLING', 'INSTALL_FAILED', 'SUSPENDED'
  ];

  if (!validStatuses.includes(status?.toUpperCase())) {
    return res.status(422).json({ message: 'Invalid status' });
  }

  await prisma.server.updateMany({
    where: { uuid, nodeId: node.id },
    data: { status: status.toUpperCase() },
  });

  // Broadcast to connected clients via socket
  const io = req.app.get('io');
  const server = await prisma.server.findFirst({ where: { uuid } });
  if (io && server) {
    io.to(`server:${server.id}`).emit('server:status', {
      serverId: server.id,
      status: status.toUpperCase(),
      timestamp: Date.now(),
    });
  }

  return res.json({ message: 'Status updated' });
});

// Wings daemon heartbeat
// POST /api/v1/wings/heartbeat
router.post('/heartbeat', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Token required' });

  const node = await prisma.node.findUnique({ where: { token } });
  if (!node) return res.status(401).json({ message: 'Invalid token' });

  await prisma.node.update({
    where: { id: node.id },
    data: { status: 'ONLINE', updatedAt: new Date() },
  });

  return res.json({ message: 'ok' });
});

// Wings' SFTP server relays every login attempt here for validation.
// Username convention (matches Pterodactyl for familiarity): <panelUsername>.<serverUuidShort>
// Split on the LAST '.' — panel usernames are validated as ^[a-zA-Z0-9_]+$ at
// registration and can never contain a literal dot, so this is unambiguous.
// POST /api/v1/wings/sftp-auth
router.post('/sftp-auth', sftpAuthLimiter, async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false, message: 'Token required' });

  const node = await prisma.node.findUnique({ where: { token } });
  if (!node) return res.status(401).json({ ok: false, message: 'Invalid token' });

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(401).json({ ok: false, message: 'Invalid credentials' });
  }

  const dotIndex = username.lastIndexOf('.');
  if (dotIndex === -1) {
    return res.status(401).json({ ok: false, message: 'Invalid credentials' });
  }
  const panelUsername = username.slice(0, dotIndex);
  const serverUuidShort = username.slice(dotIndex + 1);

  const server = await prisma.server.findFirst({
    where: { uuidShort: serverUuidShort, nodeId: node.id },
  });
  if (!server) return res.status(401).json({ ok: false, message: 'Invalid credentials' });

  const user = await prisma.user.findFirst({ where: { username: panelUsername } });
  if (!user) return res.status(401).json({ ok: false, message: 'Invalid credentials' });

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) return res.status(401).json({ ok: false, message: 'Invalid credentials' });

  const authorized = server.userId === user.id || user.role === 'ADMIN';
  if (!authorized) return res.status(403).json({ ok: false, message: 'Access denied' });

  logger.info(`SFTP login: ${user.username} -> server ${server.uuidShort} on node ${node.name}`);
  return res.json({ ok: true, serverUuid: server.uuid });
});

export default router;
