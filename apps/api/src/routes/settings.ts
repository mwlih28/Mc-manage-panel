import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, optionalAuth } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

const DEFAULTS: Record<string, string> = {
  'app.name': 'Kretase',
  'app.title': 'Kretase',
  'app.logo': '',
  'app.description': 'High-performance game server management',
  'features.aiTools': 'true',
};

// Keys safe to expose without authentication (sidebar/login branding, public
// feature flags). Everything else (SMTP creds, AI provider keys) is stripped
// out below unless the request comes from a logged-in admin.
const PUBLIC_KEYS = new Set(['app.name', 'app.title', 'app.logo', 'app.description', 'features.aiTools', 'ai.openaiConfigured']);

router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.setting.findMany();
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) settings[r.key] = r.value;
    settings['ai.openaiConfigured'] = settings['ai.openaiKey'] ? 'true' : 'false';

    if (req.user?.role !== 'ADMIN') {
      for (const key of Object.keys(settings)) {
        if (!PUBLIC_KEYS.has(key)) delete settings[key];
      }
    }
    return res.json(settings);
  } catch {
    return res.json(DEFAULTS);
  }
});

router.put('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const allowed = [
    'app.name', 'app.title', 'app.logo', 'app.description',
    'smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from', 'smtp.owner_email',
    'features.aiTools', 'ai.openaiKey',
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
