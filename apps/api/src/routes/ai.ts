import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { prisma } from '../utils/prisma';
import { generateMotdWithAi, generateLogoWithAi } from '../services/aiService';

const router = Router();

// Each AI call costs the panel owner real money (their own OpenAI key) — keep
// a simple per-user cooldown so one impatient click-spammer can't run up a bill.
const COOLDOWN_MS = 15_000;
const lastRequestAt = new Map<string, number>();

function checkCooldown(userId: string): boolean {
  const last = lastRequestAt.get(userId) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  lastRequestAt.set(userId, Date.now());
  return true;
}

async function aiToolsEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'features.aiTools' } });
  return row ? row.value === 'true' : true;
}

router.post('/motd', authenticate, async (req: AuthRequest, res: Response) => {
  if (!(await aiToolsEnabled())) return res.status(403).json({ message: 'AI Tools disabled by administrator' });
  if (!checkCooldown(req.user!.id)) return res.status(429).json({ message: 'Please wait a few seconds before generating again' });

  const { serverName = '', theme = 'random' } = req.body;
  try {
    const results = await generateMotdWithAi(serverName, theme);
    return res.json({ results });
  } catch (err) {
    return res.status(502).json({ message: (err as Error).message || 'AI generation failed' });
  }
});

router.post('/logo', authenticate, async (req: AuthRequest, res: Response) => {
  if (!(await aiToolsEnabled())) return res.status(403).json({ message: 'AI Tools disabled by administrator' });
  if (!checkCooldown(req.user!.id)) return res.status(429).json({ message: 'Please wait a few seconds before generating again' });

  const { serverName = '' } = req.body;
  try {
    const images = await generateLogoWithAi(serverName);
    return res.json({ images });
  } catch (err) {
    return res.status(502).json({ message: (err as Error).message || 'AI generation failed' });
  }
});

export default router;
