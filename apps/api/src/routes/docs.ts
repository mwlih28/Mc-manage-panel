import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { API_MANIFEST } from '../utils/apiManifest';

const router = Router();

router.use(authenticate, requireAdmin);

// Hand-curated list of API routes meant for third-party integration, so
// hosting companies building billing/automation tooling against a scoped
// API key know what's available without reading the source.
router.get('/manifest', (_req: AuthRequest, res: Response) => {
  return res.json({ data: API_MANIFEST });
});

export default router;
