import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

const DEFAULTS: Record<string, string> = {
  'app.name': 'MC Manage Panel',
  'app.title': 'MC Manage Panel',
  'app.logo': '',
  'app.description': 'High-performance game server management',
};

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.setting.findMany();
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) settings[r.key] = r.value;
    return res.json(settings);
  } catch {
    return res.json(DEFAULTS);
  }
});

router.put('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const allowed = [
    'app.name', 'app.title', 'app.logo', 'app.description',
    'smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from', 'smtp.owner_email',
  ];
  const updates: Array<{ key: string; value: string }> = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push({ key, value: String(req.body[key]) });
    }
  }
  for (const u of updates) {
    await prisma.setting.upsert({
      where: { key: u.key },
      update: { value: u.value },
      create: { key: u.key, value: u.value },
    });
  }
  return res.json({ message: 'Settings saved' });
});

export default router;
