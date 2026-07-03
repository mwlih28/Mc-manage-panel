import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { searchModpacks, getModpackVersions } from '../services/modrinthApi';
import { logger } from '../utils/logger';

const router = Router();

function describeError(err: unknown): string {
  const e = err as { message?: string; response?: { status?: number; data?: unknown } };
  if (e.response) return `HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`;
  return e.message || 'Unknown error';
}

// GET /modrinth/modpacks/search?query=&offset=&limit=
router.get('/modpacks/search', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const query = (req.query.query as string) || '';
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const result = await searchModpacks(query, offset, limit);
    return res.json(result);
  } catch (err) {
    logger.error(`Modrinth modpack search failed: ${describeError(err)}`);
    return res.status(502).json({ message: 'Modrinth search failed' });
  }
});

// GET /modrinth/modpacks/:projectId/versions
router.get('/modpacks/:projectId/versions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const versions = await getModpackVersions(req.params.projectId);
    return res.json({ versions });
  } catch (err) {
    logger.error(`Modrinth version fetch failed: ${describeError(err)}`);
    return res.status(502).json({ message: 'Failed to fetch modpack versions' });
  }
});

export default router;
