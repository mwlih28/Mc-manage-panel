import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { buildAdapter, getStorageConf } from '../services/storage';

const router = Router();

// Cloud backup destinations are a system-level, panel-wide config — same
// admin-only posture as webhooks and API keys.
router.use(authenticate, requireAdmin);

// POST /storage/test — verifies the already-saved settings, mirroring the
// existing /installer/test-smtp and /webhooks/:id/test pattern (save first,
// then test what's saved, rather than a second "test unsaved form" path).
router.post('/test', async (_req: AuthRequest, res: Response) => {
  const conf = await getStorageConf();
  if (!conf['storage.provider'] || conf['storage.provider'] === 'none') {
    return res.status(422).json({ message: 'No cloud destination is configured' });
  }
  const adapter = buildAdapter(conf);
  if (!adapter) {
    return res.status(422).json({ message: 'Cloud destination is missing required fields' });
  }
  try {
    await adapter.testConnection();
    return res.json({ message: 'Connection succeeded' });
  } catch (err) {
    return res.status(502).json({ message: `Connection failed: ${(err as Error).message}` });
  }
});

export default router;
