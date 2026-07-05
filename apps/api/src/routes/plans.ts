import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { prisma } from '../utils/prisma';

const router = Router();

// Admin-only, same posture as Webhooks/API keys/Store integrations — Plans
// are a billing/provisioning primitive, not something a regular user picks.
router.use(authenticate, requireAdmin);

router.get('/', async (_req: AuthRequest, res: Response) => {
  const plans = await prisma.plan.findMany({ orderBy: { memory: 'asc' } });
  return res.json({ data: plans });
});

function parsePlanBody(body: Record<string, unknown>) {
  const { name, memory, swap, disk, io, cpu, databaseLimit, allocationLimit, backupLimit } = body as Record<string, unknown>;
  return { name, memory, swap, disk, io, cpu, databaseLimit, allocationLimit, backupLimit };
}

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, memory, swap, disk, io, cpu, databaseLimit, allocationLimit, backupLimit } = parsePlanBody(req.body);
  if (typeof name !== 'string' || !name.trim()) return res.status(422).json({ message: 'Name is required' });
  if (!Number.isInteger(memory) || (memory as number) < 1) return res.status(422).json({ message: 'memory must be a positive integer (MB)' });
  if (!Number.isInteger(disk) || (disk as number) < 1) return res.status(422).json({ message: 'disk must be a positive integer (MB)' });

  const plan = await prisma.plan.create({
    data: {
      name: (name as string).trim(),
      memory: memory as number,
      disk: disk as number,
      swap: typeof swap === 'number' ? swap : 0,
      io: typeof io === 'number' ? io : 500,
      cpu: typeof cpu === 'number' ? cpu : 0,
      databaseLimit: typeof databaseLimit === 'number' ? databaseLimit : 0,
      allocationLimit: typeof allocationLimit === 'number' ? allocationLimit : 0,
      backupLimit: typeof backupLimit === 'number' ? backupLimit : 0,
    },
  });
  return res.status(201).json({ data: plan });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: 'Plan not found' });

  const { name, memory, swap, disk, io, cpu, databaseLimit, allocationLimit, backupLimit } = parsePlanBody(req.body);
  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(422).json({ message: 'Name is required' });
    data.name = name.trim();
  }
  if (memory !== undefined) {
    if (!Number.isInteger(memory) || (memory as number) < 1) return res.status(422).json({ message: 'memory must be a positive integer (MB)' });
    data.memory = memory;
  }
  if (disk !== undefined) {
    if (!Number.isInteger(disk) || (disk as number) < 1) return res.status(422).json({ message: 'disk must be a positive integer (MB)' });
    data.disk = disk;
  }
  if (typeof swap === 'number') data.swap = swap;
  if (typeof io === 'number') data.io = io;
  if (typeof cpu === 'number') data.cpu = cpu;
  if (typeof databaseLimit === 'number') data.databaseLimit = databaseLimit;
  if (typeof allocationLimit === 'number') data.allocationLimit = allocationLimit;
  if (typeof backupLimit === 'number') data.backupLimit = backupLimit;

  const updated = await prisma.plan.update({ where: { id: existing.id }, data });
  return res.json({ data: updated });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: 'Plan not found' });
  await prisma.plan.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

export default router;
