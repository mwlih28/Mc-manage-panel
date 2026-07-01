import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { searchWorlds, getWorldFiles, isCurseForgeConfigured } from '../services/curseforgeApi';

const router = Router();

router.get('/status', authenticate, async (_req: AuthRequest, res: Response) => {
  return res.json({ configured: await isCurseForgeConfigured() });
});

// GET /curseforge/worlds/search?query=&index=&pageSize=
router.get('/worlds/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const index = parseInt(req.query.index as string) || 0;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);
    const result = await searchWorlds(query, index, pageSize);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ message: (err as Error).message || 'CurseForge search failed' });
  }
});

// GET /curseforge/worlds/:modId/files
router.get('/worlds/:modId/files', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const modId = parseInt(req.params.modId);
    const files = await getWorldFiles(modId);
    return res.json({ files });
  } catch (err) {
    return res.status(502).json({ message: (err as Error).message || 'Failed to fetch world files' });
  }
});

export default router;
