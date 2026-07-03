import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendPowerAction, sendCommand as wingsSendCommand, createServerOnNode, getServerResources, buildWingsConfig } from '../services/wingsClient';
import { fetchPaperVersions, fetchPaperBuildDetails } from '../services/paperApi';
import { resolveModpackInstall as resolveCurseForgeModpack, matchFilesByFingerprint, CurseForgeFileMatch } from '../services/curseforgeApi';
import { resolveModpackInstall as resolveModrinthModpack, matchFilesBySha1, ModrinthFileMatch } from '../services/modrinthApi';
import { ResolvedModpack } from '../services/modpackTypes';
import { computeNextRun } from '../services/scheduler';
import { logger } from '../utils/logger';

export async function getWingsClient(serverId: string, userId: string, isAdmin: boolean) {
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

// Migration touches two Wings daemons (snapshot on source, stream + extract
// on destination) — generous enough not to abort on a large world.
const MIGRATION_TIMEOUT_MS = 15 * 60 * 1000;

function generateShortUuid() {
  return uuidv4().replace(/-/g, '').slice(0, 8);
}

// Belt-and-braces guard for the file-manager routes below — traversal
// protection is expected to live in Wings too, but the API shouldn't
// forward an obviously malicious path just because Wings is trusted to
// catch it.
function hasPathTraversal(value: unknown): boolean {
  if (typeof value === 'string') return value.split(/[/\\]/).includes('..') || value.includes('\0');
  if (Array.isArray(value)) return value.some(hasPathTraversal);
  if (value && typeof value === 'object') return Object.values(value).some(hasPathTraversal);
  return false;
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

  const { name, description, mcVersion, crashDetectionEnabled, autoOptimizeEnabled } = req.body;
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

  // Behavior toggles, not resource allocation — the owning user can flip
  // these on their own server, unlike memory/disk/etc. below which stay
  // admin-only.
  if (typeof crashDetectionEnabled === 'boolean') updateData.crashDetectionEnabled = crashDetectionEnabled;
  if (typeof autoOptimizeEnabled === 'boolean') updateData.autoOptimizeEnabled = autoOptimizeEnabled;

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

// POST /servers/:id/modpack/install — Admin only. Reinstalls the server
// onto the Fabric egg with the modpack's exact MC/loader version, then
// pushes the pack's mods (downloaded straight to Wings, never through the
// panel) and bundled overrides (small config files, base64'd through the
// panel since they come from inside the pack's zip). Only Fabric packs are
// supported today — Forge/NeoForge/Quilt have no matching egg yet.
router.post('/:id/modpack/install', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { source, packName, modId, fileId, versionId } = req.body as {
    source?: 'curseforge' | 'modrinth'; packName?: string;
    modId?: number; fileId?: number; versionId?: string;
  };
  if (source !== 'curseforge' && source !== 'modrinth') {
    return res.status(422).json({ message: 'source must be "curseforge" or "modrinth"' });
  }

  const server = await prisma.server.findUnique({ where: { id: req.params.id }, include: { node: true } });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  if (!server.node) return res.status(422).json({ message: 'Server has no assigned node' });
  if (['MIGRATING', 'INSTALLING', 'RESTORING_BACKUP', 'REINSTALLING'].includes(server.status)) {
    return res.status(400).json({ message: 'Server has another operation in progress' });
  }

  let resolved: ResolvedModpack;
  try {
    if (source === 'curseforge') {
      if (!modId || !fileId) return res.status(422).json({ message: 'modId and fileId are required' });
      resolved = await resolveCurseForgeModpack(modId, fileId);
    } else {
      if (!versionId) return res.status(422).json({ message: 'versionId is required' });
      resolved = await resolveModrinthModpack(versionId);
    }
  } catch (err) {
    return res.status(502).json({ message: (err as Error).message || 'Failed to resolve modpack' });
  }

  if (resolved.loader.type !== 'fabric') {
    return res.status(422).json({
      message: `This pack uses ${resolved.loader.type === 'unknown' ? 'an unrecognized loader' : resolved.loader.type}. Only Fabric modpacks can be auto-installed right now — Forge/NeoForge/Quilt support is coming soon.`,
    });
  }
  if (resolved.mods.length === 0 && resolved.overrides.length === 0) {
    return res.status(422).json({ message: 'This pack has no installable files' });
  }

  const fabricEgg = await prisma.egg.findFirst({
    where: { name: 'Fabric' },
    select: { id: true, startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true },
  });
  if (!fabricEgg) return res.status(500).json({ message: 'Fabric egg not found on this panel' });

  let env: Record<string, string> = {};
  try { env = JSON.parse(server.env); } catch { /* ignore */ }
  env.MC_VERSION = resolved.loader.minecraftVersion;
  env.FABRIC_LOADER_VERSION = resolved.loader.loaderVersion || 'latest';

  await prisma.server.update({
    where: { id: server.id },
    data: {
      eggId: fabricEgg.id,
      startup: fabricEgg.startup,
      image: fabricEgg.dockerImage,
      env: JSON.stringify(env),
      status: 'INSTALLING',
    },
  });

  res.json({ message: 'Modpack install started — this reinstalls the server onto Fabric first, then adds the pack files' });

  const node = server.node;
  const client = axios.create({
    baseURL: `${node.scheme}://${node.fqdn}:${node.daemonPort}/api`,
    headers: { Authorization: `Bearer ${node.token}` },
    timeout: MIGRATION_TIMEOUT_MS,
  });

  try {
    logger.info(`Modpack install: reinstalling ${server.uuid} onto Fabric ${env.MC_VERSION}`);
    await client.post(`/servers/${server.uuid}/reinstall`, {
      uuid: server.uuid,
      suspended: server.suspended,
      environment: env,
      invocation: fabricEgg.startup,
      image: fabricEgg.dockerImage,
      installScript: fabricEgg.scriptInstall ?? undefined,
      scriptContainer: fabricEgg.scriptContainer ?? undefined,
      crashDetectionEnabled: server.crashDetectionEnabled,
      build: {
        memory_limit: server.memory, swap: server.swap, disk_space: server.disk,
        io_weight: server.io, cpu_limit: server.cpu, oom_disabled: server.oomDisabled,
      },
      mounts: [],
      egg: { id: fabricEgg.id, file_denylist: [] },
      container: { image: fabricEgg.dockerImage, requires_rebuild: false },
    });

    // Wings flips status back to 'offline' once the reinstall (loader
    // download/install) finishes — wait for that before adding pack files,
    // since reinstall wipes the data directory first.
    let reinstalled = false;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      reinstalled = await client.get(`/servers/${server.uuid}/status`).then((r) => r.data.status === 'offline').catch(() => false);
      if (reinstalled) break;
    }
    if (!reinstalled) throw new Error('Timed out waiting for Fabric install to finish');

    if (resolved.overrides.length > 0) {
      logger.info(`Modpack install: writing ${resolved.overrides.length} override file(s) for ${server.uuid}`);
      await client.post(`/servers/${server.uuid}/modpack/overrides`, { files: resolved.overrides });
    }
    if (resolved.mods.length > 0) {
      logger.info(`Modpack install: downloading ${resolved.mods.length} mod(s) for ${server.uuid}`);
      const { data } = await client.post(`/servers/${server.uuid}/modpack/mods`, { mods: resolved.mods }, { timeout: MIGRATION_TIMEOUT_MS });
      if (data.failed?.length) {
        logger.warn(`Modpack install: ${data.failed.length} mod(s) failed to download for ${server.uuid}`);
      }
    }

    await prisma.server.update({ where: { id: server.id }, data: { status: 'OFFLINE' } });
    await prisma.activity.create({
      data: {
        userId: req.user!.id,
        serverId: server.id,
        event: 'server:modpack-install',
        properties: JSON.stringify({ source, packName: packName || null, mcVersion: env.MC_VERSION }),
        ip: req.ip,
      },
    });
    logger.info(`Modpack install complete for ${server.uuid}`);
  } catch (err) {
    logger.error(`Modpack install failed for server ${server.uuid}: ${(err as Error).message}`);
    await prisma.server.update({ where: { id: server.id }, data: { status: 'INSTALL_FAILED' } }).catch(() => {});
  }
});

// POST /servers/:id/migrate — Admin only. Moves a server to a different
// node: snapshots it on the source node, streams that snapshot straight
// into the destination node's upload-and-restore endpoint (never lands on
// the panel's own disk), tears down the source copy, then repoints the DB
// row. Pterodactyl has no equivalent of this — moving a server between
// nodes there means manually re-uploading files.
router.post('/:id/migrate', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const server = await prisma.server.findUnique({
    where: { id: req.params.id },
    include: {
      node: true,
      egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
    },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  if (!server.node) return res.status(422).json({ message: 'Server has no assigned node' });

  const { targetNodeId, allocationId } = req.body as { targetNodeId?: string; allocationId?: string };
  if (!targetNodeId) return res.status(422).json({ message: 'targetNodeId is required' });
  if (targetNodeId === server.nodeId) return res.status(422).json({ message: 'Server is already on that node' });
  if (['MIGRATING', 'INSTALLING', 'RESTORING_BACKUP', 'REINSTALLING'].includes(server.status)) {
    return res.status(400).json({ message: 'Server has another operation in progress' });
  }

  const targetNode = await prisma.node.findUnique({ where: { id: targetNodeId } });
  if (!targetNode) return res.status(422).json({ message: 'Target node not found' });

  let finalAllocationId: string;
  try {
    finalAllocationId = await prisma.$transaction(async (tx) => {
      if (allocationId) {
        const requested = await tx.allocation.findUnique({ where: { id: allocationId } });
        if (!requested || requested.nodeId !== targetNodeId) throw new Error('ALLOCATION_INVALID');
        if (requested.assigned) throw new Error('ALLOCATION_IN_USE');
        await tx.allocation.update({ where: { id: allocationId }, data: { assigned: true } });
        return allocationId;
      }
      const freeAlloc = await tx.allocation.findFirst({
        where: { nodeId: targetNodeId, assigned: false },
        orderBy: { port: 'asc' },
      });
      if (!freeAlloc) throw new Error('NO_FREE_ALLOCATION');
      await tx.allocation.update({ where: { id: freeAlloc.id }, data: { assigned: true } });
      return freeAlloc.id;
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'NO_FREE_ALLOCATION') return res.status(422).json({ message: 'Target node has no free allocations' });
    if (msg === 'ALLOCATION_IN_USE') return res.status(422).json({ message: 'Allocation already in use' });
    if (msg === 'ALLOCATION_INVALID') return res.status(422).json({ message: 'Allocation does not belong to the target node' });
    throw err;
  }

  const sourceNode = server.node;
  const oldAllocationId = server.allocationId;
  const wasRunning = server.status === 'RUNNING' || server.status === 'STARTING';
  const migrationUuid = uuidv4();

  await prisma.server.update({ where: { id: server.id }, data: { status: 'MIGRATING' } });
  res.json({ message: 'Migration started' });

  const sourceClient = axios.create({
    baseURL: `${sourceNode.scheme}://${sourceNode.fqdn}:${sourceNode.daemonPort}/api`,
    headers: { Authorization: `Bearer ${sourceNode.token}` },
    timeout: MIGRATION_TIMEOUT_MS,
  });
  const destClient = axios.create({
    baseURL: `${targetNode.scheme}://${targetNode.fqdn}:${targetNode.daemonPort}/api`,
    headers: { Authorization: `Bearer ${targetNode.token}` },
    timeout: MIGRATION_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  try {
    // Stop first so the snapshot captures a consistent world, not one mid-write.
    if (wasRunning) {
      await sourceClient.post(`/servers/${server.uuid}/power`, { action: 'stop' }).catch(() => {});
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const stopped = await sourceClient
          .get(`/servers/${server.uuid}/status`)
          .then((r) => r.data.status === 'offline')
          .catch(() => false);
        if (stopped) break;
      }
    }

    logger.info(`Migration: snapshotting ${server.uuid} on ${sourceNode.name}`);
    await sourceClient.post(`/servers/${server.uuid}/backups`, { backupUuid: migrationUuid, ignoredFiles: [] });

    logger.info(`Migration: registering ${server.uuid} on ${targetNode.name}`);
    await destClient.post('/servers', buildWingsConfig(server as Parameters<typeof buildWingsConfig>[0]));

    logger.info(`Migration: transferring snapshot for ${server.uuid}`);
    const download = await sourceClient.get(`/servers/${server.uuid}/backups/${migrationUuid}/download`, {
      responseType: 'stream',
    });
    await destClient.post(`/servers/${server.uuid}/backups/${migrationUuid}/upload`, download.data, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    await sourceClient.delete(`/servers/${server.uuid}`)
      .catch((err) => logger.warn(`Migration cleanup: could not remove source server: ${(err as Error).message}`));
    await sourceClient.delete(`/servers/${server.uuid}/backups/${migrationUuid}`).catch(() => {});
    await destClient.delete(`/servers/${server.uuid}/backups/${migrationUuid}`).catch(() => {});

    await prisma.$transaction(async (tx) => {
      await tx.server.update({
        where: { id: server.id },
        data: { nodeId: targetNodeId, allocationId: finalAllocationId, status: 'OFFLINE' },
      });
      if (oldAllocationId) {
        await tx.allocation.update({ where: { id: oldAllocationId }, data: { assigned: false } });
      }
    });

    // Prior backups live on the source node's disk, which the destination
    // Wings can't reach — restoring one would 404. Drop them rather than
    // leave a backup entry that looks fine but silently can't be restored.
    await prisma.backup.deleteMany({ where: { serverId: server.id } });

    await prisma.activity.create({
      data: {
        userId: req.user!.id,
        serverId: server.id,
        event: 'server:migrate',
        properties: JSON.stringify({ from: sourceNode.name, to: targetNode.name }),
        ip: req.ip,
      },
    });
    logger.info(`Migration complete: ${server.uuid} moved from ${sourceNode.name} to ${targetNode.name}`);
  } catch (err) {
    logger.error(`Migration failed for server ${server.uuid}: ${(err as Error).message}`);
    await prisma.allocation.update({ where: { id: finalAllocationId }, data: { assigned: false } }).catch(() => {});
    await prisma.server.update({ where: { id: server.id }, data: { status: 'MIGRATION_FAILED' } }).catch(() => {});
    await destClient.delete(`/servers/${server.uuid}`).catch(() => {});
    await destClient.delete(`/servers/${server.uuid}/backups/${migrationUuid}`).catch(() => {});
    await sourceClient.delete(`/servers/${server.uuid}/backups/${migrationUuid}`).catch(() => {});
  }
});

// POST /servers/:id/clone — Admin only. Unlike migrate, the source server
// is never stopped or touched beyond a normal hot backup — this creates a
// brand-new server (its own id/uuid/allocation) that's a snapshot copy,
// for testing a plugin/mod update or config change without risking the
// live one. Reuses the same snapshot+stream+restore primitives as migrate.
router.post('/:id/clone', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const source = await prisma.server.findUnique({
    where: { id: req.params.id },
    include: { node: true, egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } } },
  });
  if (!source) return res.status(404).json({ message: 'Server not found' });
  if (!source.node) return res.status(422).json({ message: 'Server has no assigned node' });

  const { targetNodeId, allocationId, name } = req.body as { targetNodeId?: string; allocationId?: string; name?: string };
  const destNodeId = targetNodeId || source.nodeId;

  const destNode = await prisma.node.findUnique({ where: { id: destNodeId } });
  if (!destNode) return res.status(422).json({ message: 'Target node not found' });

  let finalAllocationId: string;
  try {
    finalAllocationId = await prisma.$transaction(async (tx) => {
      if (allocationId) {
        const requested = await tx.allocation.findUnique({ where: { id: allocationId } });
        if (!requested || requested.nodeId !== destNodeId) throw new Error('ALLOCATION_INVALID');
        if (requested.assigned) throw new Error('ALLOCATION_IN_USE');
        await tx.allocation.update({ where: { id: allocationId }, data: { assigned: true } });
        return allocationId;
      }
      const freeAlloc = await tx.allocation.findFirst({
        where: { nodeId: destNodeId, assigned: false },
        orderBy: { port: 'asc' },
      });
      if (!freeAlloc) throw new Error('NO_FREE_ALLOCATION');
      await tx.allocation.update({ where: { id: freeAlloc.id }, data: { assigned: true } });
      return freeAlloc.id;
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'NO_FREE_ALLOCATION') return res.status(422).json({ message: 'Target node has no free allocations' });
    if (msg === 'ALLOCATION_IN_USE') return res.status(422).json({ message: 'Allocation already in use' });
    if (msg === 'ALLOCATION_INVALID') return res.status(422).json({ message: 'Allocation does not belong to the target node' });
    throw err;
  }

  const clone = await prisma.server.create({
    data: {
      uuid: uuidv4(),
      uuidShort: generateShortUuid(),
      name: name || `${source.name} (Clone)`,
      description: source.description,
      userId: source.userId,
      nodeId: destNodeId,
      eggId: source.eggId,
      allocationId: finalAllocationId,
      memory: source.memory,
      swap: source.swap,
      disk: source.disk,
      io: source.io,
      cpu: source.cpu,
      startup: source.startup,
      image: source.image,
      env: source.env,
      eulaAccepted: source.eulaAccepted,
      databaseLimit: source.databaseLimit,
      allocationLimit: source.allocationLimit,
      backupLimit: source.backupLimit,
      crashDetectionEnabled: source.crashDetectionEnabled,
      autoOptimizeEnabled: source.autoOptimizeEnabled,
      status: 'CLONING',
    },
    include: {
      user: { select: { id: true, email: true, username: true } },
      node: { select: { id: true, name: true, fqdn: true } },
      egg: { select: { id: true, name: true } },
      allocation: true,
    },
  });

  res.status(201).json({ data: clone, message: 'Clone started — files are being copied in the background' });

  const cloneUuid = uuidv4();
  const sourceClient = axios.create({
    baseURL: `${source.node.scheme}://${source.node.fqdn}:${source.node.daemonPort}/api`,
    headers: { Authorization: `Bearer ${source.node.token}` },
    timeout: MIGRATION_TIMEOUT_MS,
  });
  const destClient = axios.create({
    baseURL: `${destNode.scheme}://${destNode.fqdn}:${destNode.daemonPort}/api`,
    headers: { Authorization: `Bearer ${destNode.token}` },
    timeout: MIGRATION_TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  try {
    logger.info(`Clone: snapshotting ${source.uuid} on ${source.node.name} for new server ${clone.uuid}`);
    await sourceClient.post(`/servers/${source.uuid}/backups`, { backupUuid: cloneUuid, ignoredFiles: [] });

    logger.info(`Clone: registering ${clone.uuid} on ${destNode.name}`);
    await destClient.post('/servers', buildWingsConfig({ ...clone, egg: source.egg } as Parameters<typeof buildWingsConfig>[0]));

    logger.info(`Clone: transferring snapshot into ${clone.uuid}`);
    const download = await sourceClient.get(`/servers/${source.uuid}/backups/${cloneUuid}/download`, { responseType: 'stream' });
    await destClient.post(`/servers/${clone.uuid}/backups/${cloneUuid}/upload`, download.data, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    await sourceClient.delete(`/servers/${source.uuid}/backups/${cloneUuid}`).catch(() => {});
    await destClient.delete(`/servers/${clone.uuid}/backups/${cloneUuid}`).catch(() => {});

    await prisma.server.update({ where: { id: clone.id }, data: { status: 'OFFLINE' } });
    await prisma.activity.create({
      data: {
        userId: req.user!.id,
        serverId: clone.id,
        event: 'server:clone',
        properties: JSON.stringify({ sourceServerId: source.id, sourceName: source.name }),
        ip: req.ip,
      },
    });
    logger.info(`Clone complete: ${clone.uuid} is a copy of ${source.uuid}`);
  } catch (err) {
    logger.error(`Clone failed for new server ${clone.uuid} (source ${source.uuid}): ${(err as Error).message}`);
    await prisma.allocation.update({ where: { id: finalAllocationId }, data: { assigned: false } }).catch(() => {});
    await prisma.server.update({ where: { id: clone.id }, data: { status: 'CLONE_FAILED' } }).catch(() => {});
    await destClient.delete(`/servers/${clone.uuid}`).catch(() => {});
    await destClient.delete(`/servers/${clone.uuid}/backups/${cloneUuid}`).catch(() => {});
    await sourceClient.delete(`/servers/${source.uuid}/backups/${cloneUuid}`).catch(() => {});
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
  if (hasPathTraversal(req.query)) return res.status(400).json({ message: 'Invalid path' });
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

// GET /servers/:id/files/detect?directory=/plugins — identifies installed
// jars against Modrinth/CurseForge by file hash, for ones that don't have
// a Kretase-written manifest entry (manually uploaded, predate the
// manifest, or dropped in by the modpack installer). Filename-independent,
// unlike the manifest-based update check the plugin/mod managers already do.
router.get('/:id/files/detect', authenticate, async (req: AuthRequest, res: Response) => {
  if (hasPathTraversal(req.query)) return res.status(400).json({ message: 'Invalid path' });
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  const directory = (req.query.directory as string) || '/plugins';

  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/files/hashes`, { params: { directory }, timeout: 30000 });
    const files: { name: string; size: number; sha1: string; murmur2: number }[] = data.files || [];
    if (files.length === 0) return res.json({ data: [] });

    const [modrinthMatches, curseforgeMatches] = await Promise.all([
      matchFilesBySha1(files.map((f) => f.sha1)).catch((err) => {
        logger.warn(`Modrinth hash lookup failed: ${(err as Error).message}`);
        return new Map<string, ModrinthFileMatch>();
      }),
      matchFilesByFingerprint(files.map((f) => f.murmur2)).catch((err) => {
        logger.warn(`CurseForge fingerprint lookup failed: ${(err as Error).message}`);
        return new Map<number, CurseForgeFileMatch>();
      }),
    ]);

    const result = files.map((f) => ({
      name: f.name,
      size: f.size,
      modrinth: modrinthMatches.get(f.sha1) || null,
      curseforge: curseforgeMatches.get(f.murmur2) || null,
    }));
    return res.json({ data: result });
  } catch (err) {
    logger.warn(`File detection failed for server ${req.params.id}: ${(err as Error).message}`);
    return res.status(502).json({ message: 'Failed to detect installed files' });
  }
});

// GET /servers/:id/files/contents?file=path
router.get('/:id/files/contents', authenticate, async (req: AuthRequest, res: Response) => {
  if (hasPathTraversal(req.query)) return res.status(400).json({ message: 'Invalid path' });
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
  if (hasPathTraversal(req.body)) return res.status(400).json({ message: 'Invalid path' });
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
  if (hasPathTraversal(req.body)) return res.status(400).json({ message: 'Invalid path' });
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
  if (hasPathTraversal(req.body)) return res.status(400).json({ message: 'Invalid path' });
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
  if (hasPathTraversal(req.body)) return res.status(400).json({ message: 'Invalid path' });
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

// GET /servers/:id/players/leaderboard
router.get('/:id/players/leaderboard', authenticate, async (req: AuthRequest, res: Response) => {
  const ctx = await getWingsClient(req.params.id, req.user!.id, req.user!.role === 'ADMIN');
  if (!ctx) return res.status(404).json({ message: 'Server not found' });
  try {
    const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/leaderboard`, { timeout: 10000 });
    return res.json(data);
  } catch { return res.json({ players: [] }); }
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
  const nextRun = computeNextRun(cronExpression);
  if (!nextRun) return res.status(422).json({ message: 'Invalid cron expression' });
  const task = await prisma.scheduledTask.create({
    data: { serverId: server.id, name, cronExpression, action, payload: JSON.stringify(payload || {}), enabled: enabled !== false, nextRun },
  });
  return res.json(task);
});

router.put('/:id/schedules/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  // Confirm the task actually belongs to this server before touching it —
  // otherwise owning any server would let you edit any other server's tasks.
  const existing = await prisma.scheduledTask.findFirst({ where: { id: req.params.taskId, serverId: server.id } });
  if (!existing) return res.status(404).json({ message: 'Scheduled task not found' });
  const { name, cronExpression, action, payload, enabled } = req.body;
  // Recompute nextRun whenever the schedule itself could have changed —
  // a stale nextRun from before the edit would fire at the wrong time.
  const nextRun = computeNextRun(cronExpression || existing.cronExpression);
  if (!nextRun) return res.status(422).json({ message: 'Invalid cron expression' });
  const task = await prisma.scheduledTask.update({
    where: { id: req.params.taskId },
    data: {
      name, cronExpression, action,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      nextRun,
    },
  });
  return res.json(task);
});

router.delete('/:id/schedules/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });
  const existing = await prisma.scheduledTask.findFirst({ where: { id: req.params.taskId, serverId: server.id } });
  if (!existing) return res.status(404).json({ message: 'Scheduled task not found' });
  await prisma.scheduledTask.delete({ where: { id: req.params.taskId } });
  return res.json({ ok: true });
});

// ─── Stats History (for graphs) ───────────────────────────────────────────────

const HISTORY_RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};
const HISTORY_MAX_POINTS = 300;

router.get('/:id/stats/history', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });

  const range = req.query.range as string | undefined;
  if (!range || range === 'live') {
    const { statsBuffer } = await import('../services/wingsRelay');
    const history = statsBuffer.get(server.uuid) ?? [];
    return res.json({ data: history });
  }

  const windowMs = HISTORY_RANGE_MS[range];
  if (!windowMs) return res.status(422).json({ message: 'range must be "live", "1h", "24h", or "7d"' });

  const samples = await prisma.serverStatSample.findMany({
    where: { serverId: server.id, timestamp: { gte: new Date(Date.now() - windowMs) } },
    orderBy: { timestamp: 'asc' },
  });

  // Thin out to a chart-friendly point count instead of shipping thousands
  // of 1-per-minute rows for the 7-day range.
  const step = Math.max(1, Math.ceil(samples.length / HISTORY_MAX_POINTS));
  const data = samples
    .filter((_, i) => i % step === 0)
    .map((s) => ({
      cpuAbsolute: s.cpu,
      memoryBytes: Number(s.memoryBytes),
      memoryLimitBytes: Number(s.memoryLimitBytes),
      diskBytes: Number(s.diskBytes),
      timestamp: s.timestamp.getTime(),
    }));

  return res.json({ data });
});

// ─── Health score ──────────────────────────────────────────────────────────
// A single number synthesized from data this panel already collects —
// crash events, auto-optimize triggers, backup freshness, sustained CPU —
// instead of one more raw chart to interpret. Every deduction is listed so
// it's inspectable, not a black-box score.
router.get('/:id/health', authenticate, async (req: AuthRequest, res: Response) => {
  const isAdmin = req.user!.role === 'ADMIN';
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user!.id }) },
  });
  if (!server) return res.status(404).json({ message: 'Server not found' });

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [crashCount, optimizeCount, lastBackup, recentStats] = await Promise.all([
    prisma.activity.count({ where: { serverId: server.id, event: 'server:crash', timestamp: { gte: sevenDaysAgo } } }),
    prisma.activity.count({ where: { serverId: server.id, event: 'server:auto-optimize', timestamp: { gte: sevenDaysAgo } } }),
    prisma.backup.findFirst({ where: { serverId: server.id, isSuccessful: true }, orderBy: { completedAt: 'desc' } }),
    prisma.serverStatSample.findMany({ where: { serverId: server.id, timestamp: { gte: oneDayAgo } }, select: { cpu: true } }),
  ]);

  const avgCpu24h = recentStats.length > 0 ? recentStats.reduce((sum, s) => sum + s.cpu, 0) / recentStats.length : null;
  const daysSinceBackup = lastBackup?.completedAt ? Math.floor((now - lastBackup.completedAt.getTime()) / 86400000) : null;

  const factors: { label: string; delta: number }[] = [];
  let score = 100;

  if (crashCount > 0) {
    const delta = -Math.min(crashCount * 15, 60);
    factors.push({ label: `${crashCount} crash${crashCount > 1 ? 'es' : ''} in the last 7 days`, delta });
  }
  if (optimizeCount > 0) {
    const delta = -Math.min(optimizeCount * 10, 30);
    factors.push({ label: `${optimizeCount} auto-optimize trigger${optimizeCount > 1 ? 's' : ''} in the last 7 days (sustained lag)`, delta });
  }
  if (daysSinceBackup === null) {
    factors.push({ label: 'No successful backup yet', delta: -20 });
  } else if (daysSinceBackup > 7) {
    factors.push({ label: `Last backup was ${daysSinceBackup} days ago`, delta: -20 });
  }
  if (avgCpu24h !== null && avgCpu24h > 85) {
    factors.push({ label: `Sustained high CPU over the last 24h (avg ${avgCpu24h.toFixed(0)}%)`, delta: -10 });
  }
  if (['INSTALL_FAILED', 'CLONE_FAILED', 'MIGRATION_FAILED'].includes(server.status)) {
    factors.push({ label: `Server is in a failed state (${server.status})`, delta: -25 });
  }

  score = Math.max(0, Math.min(100, score + factors.reduce((sum, f) => sum + f.delta, 0)));

  return res.json({
    score,
    factors,
    inputs: { crashCount, optimizeCount, daysSinceBackup, avgCpu24h },
  });
});

export default router;
