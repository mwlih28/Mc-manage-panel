import { Router, Response } from 'express';
import { authenticate, requireAdmin, requireScope } from '../middleware/auth';
import { AuthRequest } from '../types';
import { EGG_STORE_CATEGORIES, listCategoryEggs, importStoreEgg, importStoreEggsBulk } from '../services/eggStore';

const router = Router();

router.use(authenticate, requireAdmin);

// GET /egg-store/categories — the fixed list of community categories.
router.get('/categories', requireScope('eggs:read'), async (_req: AuthRequest, res: Response) => {
  return res.json({ data: EGG_STORE_CATEGORIES.map(({ slug, label }) => ({ slug, label })) });
});

// GET /egg-store/categories/:slug — the eggs in one category, fetched live
// (and cached briefly) from the community repo.
router.get('/categories/:slug', requireScope('eggs:read'), async (req: AuthRequest, res: Response) => {
  try {
    const entries = await listCategoryEggs(req.params.slug);
    return res.json({ data: entries });
  } catch (err) {
    return res.status(502).json({ message: (err as Error).message || 'Failed to load category' });
  }
});

// POST /egg-store/import — import a single egg by its path within a category.
router.post('/import', requireScope('eggs:write'), async (req: AuthRequest, res: Response) => {
  const { slug, path, nestId, nestName } = req.body as { slug?: string; path?: string; nestId?: string; nestName?: string };
  if (!slug || !path) return res.status(422).json({ message: 'slug and path are required' });

  try {
    const egg = await importStoreEgg(slug, path, { nestId, nestName });
    return res.status(201).json({ data: egg });
  } catch (err) {
    return res.status(422).json({ message: (err as Error).message || 'Import failed' });
  }
});

// POST /egg-store/import-bulk — import many eggs from the same category at
// once (e.g. "import all SteamCMD games"). Always 200s with a per-item
// results array — a handful of failures (a since-renamed file, a transient
// fetch error) shouldn't fail the whole batch when most items succeeded.
router.post('/import-bulk', requireScope('eggs:write'), async (req: AuthRequest, res: Response) => {
  const { slug, paths, nestId, nestName } = req.body as { slug?: string; paths?: string[]; nestId?: string; nestName?: string };
  if (!slug || !Array.isArray(paths) || paths.length === 0) {
    return res.status(422).json({ message: 'slug and a non-empty paths array are required' });
  }
  if (paths.length > 150) {
    return res.status(422).json({ message: 'Import at most 150 eggs at a time' });
  }

  try {
    const results = await importStoreEggsBulk(slug, paths, { nestId, nestName });
    return res.json({ data: results });
  } catch (err) {
    return res.status(422).json({ message: (err as Error).message || 'Bulk import failed' });
  }
});

export default router;
