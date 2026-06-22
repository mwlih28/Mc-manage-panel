import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /nodes
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 20;

  const [nodes, total] = await Promise.all([
    prisma.node.findMany({
      include: {
        _count: { select: { servers: true, allocations: true } },
      },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.node.count(),
  ]);

  return res.json({
    data: nodes,
    meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
  });
});

// GET /nodes/:id
router.get('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const node = await prisma.node.findUnique({
    where: { id: req.params.id },
    include: {
      _count: { select: { servers: true, allocations: true } },
      allocations: { take: 50, orderBy: { port: 'asc' } },
    },
  });

  if (!node) return res.status(404).json({ message: 'Node not found' });
  return res.json({ data: node });
});

// POST /nodes
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().trim(),
    body('fqdn').notEmpty().trim(),
    body('memory').isInt({ min: 1 }),
    body('disk').isInt({ min: 1 }),
    body('port').optional().isInt({ min: 1, max: 65535 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const {
      name, description, fqdn, scheme, port, daemonPort, daemonSftp,
      memory, memoryOverallocate, disk, diskOverallocate, uploadSize, behindProxy,
    } = req.body;

    const token = uuidv4().replace(/-/g, '');

    const node = await prisma.node.create({
      data: {
        name, description, fqdn,
        scheme: scheme || 'https',
        port: parseInt(port) || 8080,
        daemonPort: parseInt(daemonPort) || 2022,
        daemonSftp: parseInt(daemonSftp) || 2022,
        memory: parseInt(memory),
        memoryOverallocate: parseInt(memoryOverallocate) || 0,
        disk: parseInt(disk),
        diskOverallocate: parseInt(diskOverallocate) || 0,
        uploadSize: parseInt(uploadSize) || 100,
        behindProxy: behindProxy || false,
        token,
      },
    });

    return res.status(201).json({ data: node });
  }
);

// PATCH /nodes/:id
router.patch('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const {
    name, description, fqdn, scheme, port, daemonPort, daemonSftp,
    memory, memoryOverallocate, disk, diskOverallocate, maintenanceMode,
  } = req.body;

  const node = await prisma.node.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(fqdn && { fqdn }),
      ...(scheme && { scheme }),
      ...(port && { port: parseInt(port) }),
      ...(daemonPort && { daemonPort: parseInt(daemonPort) }),
      ...(daemonSftp && { daemonSftp: parseInt(daemonSftp) }),
      ...(memory && { memory: parseInt(memory) }),
      ...(memoryOverallocate !== undefined && { memoryOverallocate: parseInt(memoryOverallocate) }),
      ...(disk && { disk: parseInt(disk) }),
      ...(diskOverallocate !== undefined && { diskOverallocate: parseInt(diskOverallocate) }),
      ...(typeof maintenanceMode === 'boolean' && { maintenanceMode }),
    },
  });

  return res.json({ data: node });
});

// DELETE /nodes/:id
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const serverCount = await prisma.server.count({ where: { nodeId: req.params.id } });
  if (serverCount > 0) {
    return res.status(400).json({ message: 'Cannot delete node with active servers' });
  }

  await prisma.node.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

// GET /nodes/:id/allocations
router.get('/:id/allocations', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const perPage = parseInt(req.query.perPage as string) || 50;

  const [allocations, total] = await Promise.all([
    prisma.allocation.findMany({
      where: { nodeId: req.params.id },
      include: { server: { select: { id: true, name: true, uuid: true } } },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { port: 'asc' },
    }),
    prisma.allocation.count({ where: { nodeId: req.params.id } }),
  ]);

  return res.json({
    data: allocations,
    meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
  });
});

// POST /nodes/:id/allocations
router.post('/:id/allocations', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { ip, ports } = req.body;

  if (!ip || !Array.isArray(ports) || ports.length === 0) {
    return res.status(422).json({ message: 'IP and ports array required' });
  }

  const created = await prisma.$transaction(
    ports.map((port: number) =>
      prisma.allocation.create({
        data: { nodeId: req.params.id, ip, port },
      })
    )
  );

  return res.status(201).json({ data: created });
});

// DELETE /nodes/:nodeId/allocations/:allocId
router.delete('/:nodeId/allocations/:allocId', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const alloc = await prisma.allocation.findFirst({
    where: { id: req.params.allocId, nodeId: req.params.nodeId },
  });

  if (!alloc) return res.status(404).json({ message: 'Allocation not found' });
  if (alloc.assigned) return res.status(400).json({ message: 'Cannot delete assigned allocation' });

  await prisma.allocation.delete({ where: { id: req.params.allocId } });
  return res.status(204).send();
});

export default router;
