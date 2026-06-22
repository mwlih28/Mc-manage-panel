import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendPowerAction, sendCommand as wingsSendCommand, createServerOnNode, getServerResources } from '../services/wingsClient';
import { logger } from '../utils/logger';

async function getWingsClient(serverId: string, userId: string, isAdmin: boolean) {
  const server = await prisma.server.findFirst({
    where: { id: serverId, ...(isAdmin ? {} : { userId }) },
    include: { node: true },
  });
  if (!server || !server.node) return null;
  const { node } = server;
  const client = axios.create({
    baseURL: `${node.scheme}://${node.fqdn}:${node.daemonPort}/api`,
    headers: { Authorization: `Bearer ${node.token}` },
    timeout: 15000,
  });
  return { server, client };
}

const router = Router();

function generateShortUuid() {
  return uuidv4().replace(/-/g, '').slice(0, 8);
}

// GET /servers - Admin sees all, user sees own
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 20;
  const search = req.query.search as string;

  const isAdmin = req.user!.role === 'ADMIN';

  const where: Record<string, unknown> = isAdmin ? {} : { userId: req.user!.id };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { uuidShort: { contains: search } },
    ];
  }

  const [servers, total] = await Promise.all([
    prisma.server.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, username: true } },
        node: { select: { id: true, name: true, fqdn: true } },
        egg: { select: { id: true, name: true } },
        allocation: true,
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.server.count({ where }),
  ]);

  return res.json({
    data: servers,
    meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
  });
});

// GET /servers/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';

  const server = await prisma.server.findFirst({
    where: {
      OR: [{ id: req.params.id }, { uuid: req.params.id }, { uuidShort: req.params.id }],
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
    include: {
      user: { select: { id: true, email: true, username: true } },
      node: { select: { id: true, name: true, fqdn: true, scheme: true, daemonPort: true } },
      egg: { include: { variables: true } },
      allocation: true,
      _count: { select: { backups: true, databases: true } },
    },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });
  return res.json({ data: server });
});

// POST /servers - Admin only
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().trim(),
    body('userId').notEmpty(),
    body('nodeId').notEmpty(),
    body('eggId').notEmpty(),
    body('memory').isInt({ min: 1 }),
    body('disk').isInt({ min: 1 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const {
      name, description, userId, nodeId, eggId, allocationId,
      memory, swap, disk, io, cpu, startup, image, env,
      databaseLimit, allocationLimit, backupLimit,
    } = req.body;

    // Verify user, node, egg exist
    const [user, node, egg] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.node.findUnique({ where: { id: nodeId } }),
      prisma.egg.findUnique({ where: { id: eggId }, include: { variables: true } }),
    ]);

    if (!user) return res.status(422).json({ message: 'User not found' });
    if (!node) return res.status(422).json({ message: 'Node not found' });
    if (!egg) return res.status(422).json({ message: 'Egg not found' });

    // Handle allocation — pick a free one, or auto-create if none exist
    let finalAllocationId = allocationId;
    if (!finalAllocationId) {
      let freeAlloc = await prisma.allocation.findFirst({
        where: { nodeId, assigned: false },
        orderBy: { port: 'asc' },
      });
      if (!freeAlloc) {
        // Auto-generate next available port starting from 25565
        const highest = await prisma.allocation.findFirst({
          where: { nodeId },
          orderBy: { port: 'desc' },
        });
        const nextPort = highest ? highest.port + 1 : 25565;
        const nodeRecord = await prisma.node.findUnique({ where: { id: nodeId } });
        freeAlloc = await prisma.allocation.create({
          data: { nodeId, ip: nodeRecord?.fqdn || '0.0.0.0', port: nextPort },
        });
      }
      finalAllocationId = freeAlloc.id;
    }

    const server = await prisma.server.create({
      data: {
        uuid: uuidv4(),
        uuidShort: generateShortUuid(),
        name, description, userId, nodeId, eggId,
        allocationId: finalAllocationId,
        memory: parseInt(memory),
        swap: parseInt(swap) || 0,
        disk: parseInt(disk),
        io: parseInt(io) || 500,
        cpu: parseInt(cpu) || 0,
        startup: startup || egg.startup,
        image: image || egg.dockerImage,
        env: JSON.stringify({ ...Object.fromEntries((egg.variables || []).map(v => [v.envVariable, v.defaultValue])), ...(env || {}) }),
        databaseLimit: parseInt(databaseLimit) || 0,
        allocationLimit: parseInt(allocationLimit) || 0,
        backupLimit: parseInt(backupLimit) || 0,
        status: 'INSTALLING',
      },
      include: {
        user: { select: { id: true, email: true, username: true } },
        node: { select: { id: true, name: true, fqdn: true } },
        egg: { select: { id: true, name: true } },
        allocation: true,
      },
    });

    // Mark allocation as assigned
    await prisma.allocation.update({
      where: { id: finalAllocationId },
      data: { assigned: true },
    });

    await prisma.activity.create({
      data: {
        userId: req.user!.id,
        serverId: server.id,
        event: 'server:create',
        properties: JSON.stringify({ name }),
        ip: req.ip,
      },
    });

    // Notify Wings to load the new server
    try {
      const fullServer = await prisma.server.findUnique({
        where: { id: server.id },
        include: {
          node: { select: { id: true, fqdn: true, daemonPort: true, scheme: true, token: true } },
          egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
        },
      });
      if (fullServer?.node) {
        await createServerOnNode(fullServer as Parameters<typeof createServerOnNode>[0]);
      }
    } catch (err) {
      logger.warn(`Failed to register server with Wings: ${(err as Error).message}`);
    }

    return res.status(201).json({ data: server });
  }
);

// PATCH /servers/:id
router.patch('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';

  const server = await prisma.server.findFirst({
    where: {
      id: req.params.id,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const { name, description } = req.body;
  const updateData: Record<string, unknown> = {};

  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  if (isAdmin) {
    const { memory, swap, disk, io, cpu, startup, image, suspended } = req.body;
    if (memory) updateData.memory = parseInt(memory);
    if (swap !== undefined) updateData.swap = parseInt(swap);
    if (disk) updateData.disk = parseInt(disk);
    if (io) updateData.io = parseInt(io);
    if (cpu) updateData.cpu = parseInt(cpu);
    if (startup) updateData.startup = startup;
    if (image) updateData.image = image;
    if (typeof suspended === 'boolean') updateData.suspended = suspended;
  }

  const updated = await prisma.server.update({
    where: { id: req.params.id },
    data: updateData,
  });

  return res.json({ data: updated });
});

// DELETE /servers/:id
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const server = await prisma.server.findUnique({ where: { id: req.params.id } });
  if (!server) return res.status(404).json({ message: 'Server not found' });

  if (server.allocationId) {
    await prisma.allocation.update({
      where: { id: server.allocationId },
      data: { assigned: false },
    });
  }

  await prisma.server.delete({ where: { id: req.params.id } });

  await prisma.activity.create({
    data: {
      userId: req.user!.id,
      event: 'server:delete',
      properties: JSON.stringify({ name: server.name }),
      ip: req.ip,
    },
  });

  return res.status(204).send();
});

// POST /servers/:id/power - Power actions (real Wings integration)
router.post('/:id/power', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.id,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
    include: { node: true },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const { action } = req.body;
  if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
    return res.status(422).json({ message: 'Invalid power action' });
  }

  const statusMap: Record<string, string> = {
    start: 'STARTING',
    stop: 'STOPPING',
    restart: 'STOPPING',
    kill: 'OFFLINE',
  };

  // Update status optimistically
  await prisma.server.update({
    where: { id: server.id },
    data: { status: statusMap[action] as 'STARTING' | 'STOPPING' | 'OFFLINE' },
  });

  // Send to Wings daemon (non-blocking)
  if (server.node?.status === 'ONLINE') {
    sendPowerAction(server as Parameters<typeof sendPowerAction>[0], action as 'start' | 'stop' | 'restart' | 'kill')
      .catch(err => logger.warn(`Wings power action failed for ${server.uuid}: ${err.message}`));
  } else {
    logger.warn(`Node is offline, power action queued for ${server.uuid}`);
  }

  await prisma.activity.create({
    data: {
      userId: req.user!.id,
      serverId: server.id,
      event: `server:power.${action}`,
      ip: req.ip,
    },
  });

  return res.json({ message: `Server ${action} command sent` });
});

// POST /servers/:id/command - Send console command
router.post('/:id/command', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.id,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
    include: { node: true },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });
  const { command } = req.body;
  if (!command) return res.status(422).json({ message: 'Command required' });

  if (server.node?.status === 'ONLINE') {
    await wingsSendCommand(server as Parameters<typeof wingsSendCommand>[0], command)
      .catch(err => logger.warn(`Wings command failed: ${err.message}`));
  }

  return res.json({ message: 'Command sent' });
});

// GET /servers/:id/resources - Real resource data from Wings
router.get('/:id/resources', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.id,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
    include: { node: true },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  if (!server.node || server.node.status !== 'ONLINE') {
    return res.json({ resources: { state: 'offline', cpu_absolute: 0, memory_bytes: 0, disk_bytes: 0 } });
  }

  const resources = await getServerResources(server as Parameters<typeof getServerResources>[0])
    .catch(() => ({ state: 'offline', cpu_absolute: 0, memory_bytes: 0, disk_bytes: 0 }));

  return res.json({ resources });
});

// GET /servers/:id/activity
router.get('/:id/activity', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: {
      id: req.params.id,
      ...(isAdmin ? {} : { userId: req.user!.id }),
    },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const activities = await prisma.activity.findMany({
    where: { serverId: server.id },
    include: { user: { select: { id: true, username: true, email: true } } },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  return res.json({ data: activities });
});

// ──────────────────────────────────────────────────────
// File Manager (proxy to Wings)
// ──────────────────────────────────────────────────────

// GET /servers/:id/files?directory=/
router.get('/:id/files', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/files`, { params: { directory: req.query.directory || '/' } });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// GET /servers/:id/files/contents?file=path
router.get('/:id/files/contents', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/files/contents`, { params: { file: req.query.file } });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// POST /servers/:id/files/write
router.post('/:id/files/write', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/files/write`, req.body);
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// POST /servers/:id/files/delete
router.post('/:id/files/delete', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/files/delete`, req.body);
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// POST /servers/:id/files/create-folder
router.post('/:id/files/create-folder', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/files/create-folder`, req.body);
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// PUT /servers/:id/files/rename
router.put('/:id/files/rename', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.put(`/servers/${ctx.server.uuid}/files/rename`, req.body);
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

export default router;
