import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, requireScope } from '../middleware/auth';
import { AuthRequest } from '../types';
import { parsePterodactylEgg, resolveNestId, createEggFromParsed, buildEggExportJson, normalizeScript } from '../services/eggImport';

const router = Router();

// GET /nests
router.get('/nests', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const nests = await prisma.nest.findMany({
    include: {
      _count: { select: { eggs: true } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json({ data: nests });
});

// GET /nests/:nestId/eggs
router.get('/nests/:nestId/eggs', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const eggs = await prisma.egg.findMany({
    where: { nestId: req.params.nestId },
    include: { variables: true },
    orderBy: { name: 'asc' },
  });
  return res.json({ data: eggs });
});

// GET /eggs
router.get('/', authenticate, requireAdmin, requireScope('eggs:read'), async (_req: AuthRequest, res: Response) => {
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
router.post('/', authenticate, requireAdmin, requireScope('eggs:write'), async (req: AuthRequest, res: Response) => {
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
      scriptInstall: normalizeScript(scriptInstall),
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

// POST /eggs/import — paste or upload any Pterodactyl-format egg JSON
// (PTDL_v1/v2) and create it directly, exactly like Pterodactyl's own
// "Import Egg" — this is how an admin brings in a fully custom egg of their
// own, not just one from Kretase's bundled catalog or the community store.
router.post('/import', authenticate, requireAdmin, requireScope('eggs:write'), async (req: AuthRequest, res: Response) => {
  const { nestId, nestName, json } = req.body as { nestId?: string; nestName?: string; json?: unknown };
  if (json === undefined || json === null) return res.status(422).json({ message: 'json is required' });

  let parsed;
  try {
    parsed = await parsePterodactylEgg(json);
  } catch (err) {
    return res.status(422).json({ message: (err as Error).message });
  }

  let resolvedNestId: string;
  try {
    resolvedNestId = await resolveNestId({ nestId, nestName });
  } catch (err) {
    return res.status(422).json({ message: (err as Error).message });
  }

  const egg = await createEggFromParsed(parsed, resolvedNestId);
  return res.status(201).json({ data: egg });
});

// PUT /eggs/:id
router.put('/:id', authenticate, requireAdmin, requireScope('eggs:write'), async (req: AuthRequest, res: Response) => {
  try {
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
        ...(scriptInstall !== undefined && { scriptInstall: normalizeScript(scriptInstall) }),
      },
      include: { variables: true, nest: true },
    });

    return res.json({ data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update egg';
    return res.status(500).json({ message });
  }
});

// DELETE /eggs/:id
router.delete('/:id', authenticate, requireAdmin, requireScope('eggs:write'), async (req: AuthRequest, res: Response) => {
  const egg = await prisma.egg.findUnique({ where: { id: req.params.id }, include: { _count: { select: { servers: true } } } });
  if (!egg) return res.status(404).json({ message: 'Egg not found' });
  if (egg._count.servers > 0) return res.status(400).json({ message: 'Cannot delete egg with active servers' });
  await prisma.egg.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

// GET /eggs/:id
router.get('/:id', authenticate, requireAdmin, requireScope('eggs:read'), async (req: AuthRequest, res: Response) => {
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

// GET /eggs/:id/export — download as a Pterodactyl-compatible egg JSON, so
// a custom egg built in Kretase can be shared or re-imported elsewhere.
router.get('/:id/export', authenticate, requireAdmin, requireScope('eggs:read'), async (req: AuthRequest, res: Response) => {
  const egg = await prisma.egg.findUnique({ where: { id: req.params.id }, include: { variables: true } });
  if (!egg) return res.status(404).json({ message: 'Egg not found' });

  const filename = `egg-${egg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export'}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.json(buildEggExportJson(egg));
});

export default router;
