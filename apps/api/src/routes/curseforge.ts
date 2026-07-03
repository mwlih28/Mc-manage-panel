import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { searchWorlds, getWorldFiles, isCurseForgeConfigured, searchModpacks, getModpackFiles } from '../services/curseforgeApi';
import { logger } from '../utils/logger';

const router = Router();

function describeError(err: unknown): string {
  const e = err as { message?: string; response?: { status?: number; data?: unknown } };
  if (e.response) return `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`;
  return e.message || 'Unknown error';
}

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
    logger.error(`CurseForge world search failed: ${describeError(err)}`);
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
    logger.error(`CurseForge world files fetch failed: ${describeError(err)}`);
    return res.status(502).json({ message: (err as Error).message || 'Failed to fetch world files' });
  }
});

// GET /curseforge/modpacks/search?query=&index=&pageSize=
router.get('/modpacks/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const index = parseInt(req.query.index as string) || 0;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);
    const result = await searchModpacks(query, index, pageSize);
    return res.json(result);
  } catch (err) {
    logger.error(`CurseForge modpack search failed: ${describeError(err)}`);
    return res.status(502).json({ message: (err as Error).message || 'CurseForge search failed' });
  }
});

// GET /curseforge/modpacks/:modId/files
router.get('/modpacks/:modId/files', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const modId = parseInt(req.params.modId);
    const files = await getModpackFiles(modId);
    return res.json({ files });
  } catch (err) {
    logger.error(`CurseForge modpack files fetch failed: ${describeError(err)}`);
    return res.status(502).json({ message: (err as Error).message || 'Failed to fetch modpack files' });
  }
});

export default router;
