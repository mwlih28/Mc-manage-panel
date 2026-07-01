import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendPowerAction, sendCommand as wingsSendCommand, createServerOnNode, getServerResources, buildWingsConfig } from '../services/wingsClient';
import { fetchPaperVersions, fetchPaperBuildDetails } from '../services/paperApi';
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

    // EULA is accepted by the server's owner on first start, not by whoever
    // (often an admin) provisions the server on their behalf — see
    // POST /servers/:id/accept-eula.
    const isBedrockEgg = egg.name.toLowerCase().includes('bedrock') || egg.startup.includes('bedrock_server');

    // Handle allocation + server creation atomically — claiming a "free" port
    // and creating the server must happen in the same transaction, otherwise
    // two concurrent requests can both read the same allocation as free
    // before either one marks it assigned, handing out the same port twice.
    let server;
    try {
      server = await prisma.$transaction(async (tx) => {
        let finalAllocationId = allocationId;
        if (finalAllocationId) {
          const requested = await tx.allocation.findUnique({ where: { id: finalAllocationId } });
          if (!requested) throw new Error('ALLOCATION_NOT_FOUND');
          if (requested.assigned) throw new Error('ALLOCATION_IN_USE');
          await tx.allocation.update({ where: { id: finalAllocationId }, data: { assigned: true } });
        } else {
          const freeAlloc = await tx.allocation.findFirst({
            where: { nodeId, assigned: false },
            orderBy: { port: 'asc' },
          });
          if (freeAlloc) {
            await tx.allocation.update({ where: { id: freeAlloc.id }, data: { assigned: true } });
            finalAllocationId = freeAlloc.id;
          } else {
            // Auto-generate the next available port starting from 25565
            const highest = await tx.allocation.findFirst({
              where: { nodeId },
              orderBy: { port: 'desc' },
            });
            const basePort = isBedrockEgg ? 19132 : 25565;
            const nextPort = highest ? highest.port + 1 : basePort;
            const nodeRecord = await tx.node.findUnique({ where: { id: nodeId } });
            const created = await tx.allocation.create({
              data: { nodeId, ip: nodeRecord?.fqdn || '0.0.0.0', port: nextPort, assigned: true },
            });
            finalAllocationId = created.id;
          }
        }

        return tx.server.create({
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
            env: JSON.stringify({
              // Always seed the two variables the JVM startup template depends on
              SERVER_MEMORY: String(parseInt(memory)),
              SERVER_JARFILE: 'server.jar',
              ...Object.fromEntries((egg.variables || []).map(v => [v.envVariable, v.defaultValue])),
              ...(env || {}),
            }),
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
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'ALLOCATION_NOT_FOUND') return res.status(422).json({ message: 'Allocation not found' });
      if (msg === 'ALLOCATION_IN_USE') return res.status(422).json({ message: 'Allocation already in use' });
      throw err;
    }

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

  const { name, description, mcVersion } = req.body;
  const updateData: Record<string, unknown> = {};

  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  if (mcVersion) {
    let currentEnv: Record<string, string> = {};
    try { currentEnv = JSON.parse(server.env as string) || {}; } catch { /* use empty */ }
    if (!currentEnv.SERVER_MEMORY) currentEnv.SERVER_MEMORY = String(server.memory);
    if (!currentEnv.SERVER_JARFILE) currentEnv.SERVER_JARFILE = 'server.jar';
    updateData.env = JSON.stringify({ ...currentEnv, MC_VERSION: mcVersion });
  }

  if (isAdmin) {
    const { memory, swap, disk, io, cpu, startup, image, suspended, userId, allocationId, backupLimit, databaseLimit } = req.body;
    if (memory) updateData.memory = parseInt(memory);
    if (swap !== undefined) updateData.swap = parseInt(swap);
    if (disk) updateData.disk = parseInt(disk);
    if (io) updateData.io = parseInt(io);
    if (cpu !== undefined) updateData.cpu = parseInt(cpu);
    if (startup) updateData.startup = startup;
    if (image) updateData.image = image;
    if (typeof suspended === 'boolean') updateData.suspended = suspended;
    if (backupLimit !== undefined) updateData.backupLimit = parseInt(backupLimit);
    if (databaseLimit !== undefined) updateData.databaseLimit = parseInt(databaseLimit);

    // Owner change
    if (userId && userId !== server.userId) {
      const newOwner = await prisma.user.findUnique({ where: { id: userId } });
      if (!newOwner) return res.status(422).json({ message: 'User not found' });
      updateData.userId = userId;
    }

    // Allocation change — claim the new allocation and free the old one
    // atomically so a concurrent request can't grab the same port in between.
    if (allocationId && allocationId !== server.allocationId) {
      try {
        await prisma.$transaction(async (tx) => {
          const newAlloc = await tx.allocation.findUnique({ where: { id: allocationId } });
          if (!newAlloc) throw new Error('ALLOCATION_NOT_FOUND');
          if (newAlloc.assigned && newAlloc.id !== server.allocationId) throw new Error('ALLOCATION_IN_USE');
          if (server.allocationId) {
            await tx.allocation.update({ where: { id: server.allocationId }, data: { assigned: false } });
          }
          await tx.allocation.update({ where: { id: allocationId }, data: { assigned: true } });
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'ALLOCATION_NOT_FOUND') return res.status(422).json({ message: 'Allocation not found' });
        if (msg === 'ALLOCATION_IN_USE') return res.status(422).json({ message: 'Allocation already in use' });
        throw err;
      }
      updateData.allocationId = allocationId;
    }
  }

  const updated = await prisma.server.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      user: { select: { id: true, email: true, username: true } },
      node: { select: { id: true, name: true } },
      allocation: true,
    },
  });

  return res.json({ data: updated });
});

// POST /servers/:id/reinstall - Admin only
router.post('/:id/reinstall', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const server = await prisma.server.findFirst({
      where: { id: req.params.id },
      include: {
        node: true,
        egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
      },
    });
    if (!server) return res.status(404).json({ message: 'Server not found' });

    await prisma.server.update({ where: { id: server.id }, data: { status: 'INSTALLING' } });

    if (server.node?.status === 'ONLINE') {
      const wingsConfig = buildWingsConfig(server as Parameters<typeof buildWingsConfig>[0]);
      const client = axios.create({
        baseURL: `${server.node.scheme}://${server.node.fqdn}:${server.node.daemonPort}/api`,
        headers: { Authorization: `Bearer ${server.node.token}` },
        timeout: 10000,
      });
      client.post(`/servers/${server.uuid}/reinstall`, wingsConfig)
        .catch(err => logger.warn(`Wings reinstall request failed: ${(err as Error).message}`));
    }

    await prisma.activity.create({
      data: { userId: req.user!.id, serverId: server.id, event: 'server:reinstall', ip: req.ip },
    });

    return res.json({ message: 'Reinstall initiated' });
  } catch (err) {
    logger.error('Reinstall error:', err);
    return res.status(500).json({ message: 'Internal server error during reinstall' });
  }
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
    include: { node: true, egg: true },
  });

  if (!server) return res.status(404).json({ message: 'Server not found' });

  const { action } = req.body;
  if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
    return res.status(422).json({ message: 'Invalid power action' });
  }

  const isBedrockEgg = server.egg.name.toLowerCase().includes('bedrock') || server.egg.startup.includes('bedrock_server');
  if (action === 'start' && !isBedrockEgg && !server.eulaAccepted) {
    return res.status(409).json({ message: 'EULA_NOT_ACCEPTED', code: 'EULA_NOT_ACCEPTED' });
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

// POST /servers/:id/accept-eula — the server's owner (or an admin) accepts the
// Minecraft EULA on first start. Writes eula.txt directly via Wings so it's
// in place before the start command is ever sent.
router.post('/:id/accept-eula', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });

  try {
    await ctx.client.post(`/servers/${ctx.server.uuid}/files/write`, { file: 'eula.txt', content: 'eula=true\n' });
    await prisma.server.update({ where: { id: ctx.server.id }, data: { eulaAccepted: true } });
    return res.json({ message: 'EULA accepted' });
  } catch (err) {
    return res.status(502).json({ message: `Could not write eula.txt: ${(err as Error).message}` });
  }
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

// GET /servers/:id/players - Proxy to Wings for log-based player tracking
router.get('/:id/players', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players`, { timeout: 5000 });
    return res.json(data);
  } catch {
    return res.json({ players: [], count: 0 });
  }
});

// GET /servers/:id/players/:playerUuid/inventory
router.get('/:id/players/:playerUuid/inventory', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/inventory`, { timeout: 10000 });
    return res.json(data);
  } catch {
    return res.status(500).json({ message: 'Could not read inventory' });
  }
});

// GET /servers/:id/players/all — all players who ever joined
router.get('/:id/players/all', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/all`, { timeout: 10000 });
    return res.json(data);
  } catch { return res.json({ players: [], count: 0 }); }
});

// GET /servers/:id/players/:playerUuid/details
router.get('/:id/players/:playerUuid/details', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const ctx = await getWingsClient(req.params.id, req.user!.id, isAdmin);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/details`, { timeout: 10000 });
    return res.json(data);
  } catch { return res.status(500).json({ message: 'Could not read player data' }); }
});

// POST /servers/:id/players/:playerUuid/ban
router.post('/:id/players/:playerUuid/ban', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, true);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/ban`, req.body, { timeout: 10000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Ban failed' });
  }
});

// DELETE /servers/:id/players/:playerUuid/ban
router.delete('/:id/players/:playerUuid/ban', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, true);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.delete(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/ban`, { params: req.query, timeout: 10000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Unban failed' });
  }
});

// POST /servers/:id/players/:playerUuid/kick
router.post('/:id/players/:playerUuid/kick', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, true);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/kick`, req.body, { timeout: 10000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Kick failed' });
  }
});

// POST /servers/:id/players/:playerUuid/ipban
router.post('/:id/players/:playerUuid/ipban', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, true);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/ipban`, req.body, { timeout: 10000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'IP ban failed' });
  }
});

// DELETE /servers/:id/players/:playerUuid/inventory/:slot
router.delete('/:id/players/:playerUuid/inventory/:slot', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, true);
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.delete(
      `/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/inventory/${req.params.slot}`,
      { params: req.query, timeout: 10000 }
    );
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Failed to remove item' });
  }
});

// POST /servers/:id/plugins/install - Proxy to Wings for plugin download
router.post('/:id/plugins/install', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/plugins/install`, req.body, { timeout: 120000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// GET /servers/:id/versions
router.get('/:id/versions', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/versions`, { timeout: 15000 });
    return res.json(data);
  } catch {
    try {
      const versions = await fetchPaperVersions();
      return res.json({ versions });
    } catch {
      return res.status(500).json({ message: 'Failed to fetch versions' });
    }
  }
});

// GET /servers/:id/versions/:version/builds
router.get('/:id/versions/:version/builds', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/versions/${req.params.version}/builds`, { timeout: 15000 });
    return res.json(data);
  } catch {
    try {
      const builds = await fetchPaperBuildDetails(req.params.version);
      return res.json({ builds, latestBuild: builds[0]?.id });
    } catch {
      return res.status(500).json({ message: 'Failed to fetch builds' });
    }
  }
});

// POST /servers/:id/version — install specific Paper version
router.post('/:id/version', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/version`, req.body, { timeout: 180000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Version change failed' });
  }
});

// ─── World Manager ────────────────────────────────────────────────────────────

// GET /servers/:id/worlds
router.get('/:id/worlds', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/worlds`, { timeout: 15000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// PUT /servers/:id/worlds/active
router.put('/:id/worlds/active', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.put(`/servers/${ctx.server.uuid}/worlds/active`, req.body, { timeout: 10000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
  }
});

// POST /servers/:id/worlds/install — download a world zip from a URL (e.g. a CurseForge file) and install it
router.post('/:id/worlds/install', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/worlds/install`, req.body, { timeout: 180000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'World install failed' });
  }
});

// GET /servers/:id/worlds/:name/download — stream a world's zip through to the client
router.get('/:id/worlds/:name/download', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const wingsRes = await ctx.client.get(`/servers/${ctx.server.uuid}/worlds/${encodeURIComponent(req.params.name)}/download`, {
      responseType: 'stream', timeout: 300000,
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.zip"`);
    (wingsRes.data as NodeJS.ReadableStream).pipe(res);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Failed to download world' });
  }
});

// DELETE /servers/:id/worlds/:name
router.delete('/:id/worlds/:name', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.delete(`/servers/${ctx.server.uuid}/worlds/${encodeURIComponent(req.params.name)}`, { timeout: 15000 });
    return res.json(data);
  } catch (err) {
    const e = err as { response?: { data?: unknown; status?: number } };
    return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Failed to delete world' });
  }
});

// ─── Server Notes ─────────────────────────────────────────────────────────────

router.get('/:id/notes', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const note = await prisma.serverNote.findUnique({ where: { serverId: server.id } });
  return res.json({ content: note?.content || '' });
});

router.put('/:id/notes', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const note = await prisma.serverNote.upsert({
    where: { serverId: server.id },
    create: { serverId: server.id, content: req.body.content || '' },
    update: { content: req.body.content || '' },
  });
  return res.json({ content: note.content });
});

// ─── Sub-Users ────────────────────────────────────────────────────────────────

router.get('/:id/subusers', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const subUsers = await prisma.serverSubUser.findMany({
    where: { serverId: server.id },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, username: true } } },
  });
  return res.json({ data: subUsers });
});

router.post('/:id/subusers', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const { email, permissions } = req.body;
  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (target.id === server.userId) return res.status(400).json({ message: 'Cannot add server owner as sub-user' });
  const su = await prisma.serverSubUser.upsert({
    where: { serverId_userId: { serverId: server.id, userId: target.id } },
    create: { serverId: server.id, userId: target.id, permissions: JSON.stringify(permissions || []) },
    update: { permissions: JSON.stringify(permissions || []) },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, username: true } } },
  });
  return res.json(su);
});

router.delete('/:id/subusers/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  await prisma.serverSubUser.deleteMany({ where: { serverId: server.id, userId: req.params.userId } });
  return res.json({ ok: true });
});

// ─── Scheduled Tasks ─────────────────────────────────────────────────────────

router.get('/:id/schedules', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const schedules = await prisma.scheduledTask.findMany({ where: { serverId: server.id }, orderBy: { createdAt: 'asc' } });
  return res.json({ data: schedules });
});

router.post('/:id/schedules', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const { name, cronExpression, action, payload, enabled } = req.body;
  const task = await prisma.scheduledTask.create({
    data: { serverId: server.id, name, cronExpression, action, payload: JSON.stringify(payload || {}), enabled: enabled !== false },
  });
  return res.json(task);
});

router.put('/:id/schedules/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const { name, cronExpression, action, payload, enabled } = req.body;
  const task = await prisma.scheduledTask.update({
    where: { id: req.params.taskId },
    data: { name, cronExpression, action, ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}), ...(enabled !== undefined ? { enabled } : {}) },
  });
  return res.json(task);
});

router.delete('/:id/schedules/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  await prisma.scheduledTask.delete({ where: { id: req.params.taskId } });
  return res.json({ ok: true });
});

// ─── Stats History (for graphs) ───────────────────────────────────────────────

router.get('/:id/stats/history', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const { statsBuffer } = await import('../services/wingsRelay');
  const history = statsBuffer.get(server.uuid) ?? [];
  return res.json({ data: history });
});

export default router;
