import { Router, Response } from 'express';
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
