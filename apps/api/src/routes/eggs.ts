import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /nests
router.get('/nests', authenticate, async (_req: AuthRequest, res: Response) => {
  const nests = await prisma.nest.findMany({
    include: {
      _count: { select: { eggs: true } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json({ data: nests });
});

// GET /nests/:nestId/eggs
router.get('/nests/:nestId/eggs', authenticate, async (req: AuthRequest, res: Response) => {
  const eggs = await prisma.egg.findMany({
    where: { nestId: req.params.nestId },
    include: { variables: true },
    orderBy: { name: 'asc' },
  });
  return res.json({ data: eggs });
});

// GET /eggs
router.get('/', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const eggs = await prisma.egg.findMany({
    include: {
      nest: { select: { id: true, name: true } },
      variables: true,
      _count: { select: { servers: true } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json({ data: eggs });
});

// POST /eggs
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const {
    nestId, nestName, name, description, dockerImage, startup,
    configStop, scriptInstall, variables,
  } = req.body;

  if (!name || !dockerImage || !startup) {
    return res.status(422).json({ message: 'name, dockerImage, and startup are required' });
  }

  // Resolve or create nest
  let resolvedNestId = nestId;
  if (!resolvedNestId) {
    if (!nestName) return res.status(422).json({ message: 'nestId or nestName is required' });
    const existing = await prisma.nest.findFirst({ where: { name: nestName } });
    if (existing) {
      resolvedNestId = existing.id;
    } else {
      const nest = await prisma.nest.create({
        data: { uuid: uuidv4(), author: 'admin@local', name: nestName, description: nestName },
      });
      resolvedNestId = nest.id;
    }
  }

  const egg = await prisma.egg.create({
    data: {
      uuid: uuidv4(),
      author: 'admin@local',
      nestId: resolvedNestId,
      name,
      description: description || '',
      dockerImage,
      startup,
      configStop: configStop || '^C',
      scriptInstall: scriptInstall || null,
      variables: variables?.length
        ? {
            create: variables.map((v: {
              name: string; envVariable: string; defaultValue?: string;
              description?: string; userViewable?: boolean; userEditable?: boolean;
            }) => ({
              name: v.name,
              envVariable: v.envVariable,
              defaultValue: v.defaultValue || '',
              description: v.description || '',
              userViewable: v.userViewable !== false,
              userEditable: v.userEditable !== false,
            })),
          }
        : undefined,
    },
    include: { variables: true, nest: true },
  });

  return res.status(201).json({ data: egg });
});

// PUT /eggs/:id
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const egg = await prisma.egg.findUnique({ where: { id: req.params.id } });
  if (!egg) return res.status(404).json({ message: 'Egg not found' });

  const { name, description, dockerImage, startup, configStop, scriptInstall } = req.body;

  const updated = await prisma.egg.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(dockerImage && { dockerImage }),
      ...(startup && { startup }),
      ...(configStop !== undefined && { configStop }),
      ...(scriptInstall !== undefined && { scriptInstall: scriptInstall || null }),
    },
    include: { variables: true, nest: true },
  });

  return res.json({ data: updated });
});

// DELETE /eggs/:id
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const egg = await prisma.egg.findUnique({ where: { id: req.params.id }, include: { _count: { select: { servers: true } } } });
  if (!egg) return res.status(404).json({ message: 'Egg not found' });
  if (egg._count.servers > 0) return res.status(400).json({ message: 'Cannot delete egg with active servers' });
  await prisma.egg.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

// GET /eggs/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const egg = await prisma.egg.findUnique({
    where: { id: req.params.id },
    include: {
      nest: true,
      variables: true,
    },
  });

  if (!egg) return res.status(404).json({ message: 'Egg not found' });
  return res.json({ data: egg });
});

export default router;
