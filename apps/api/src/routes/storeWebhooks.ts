import { Router, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import {
  verifyTebexSignature, verifyCraftingStoreSignature, parseStorePayload, handleStorePurchase,
} from '../services/storeIntegrationService';
import { logger } from '../utils/logger';

// Deliberately unauthenticated — the store platform can't present a Kretase
// session or API key, only the shared secret configured on both sides.
// Every request is verified against that secret before anything runs.
const router = Router();

router.post('/:id', async (req: Request, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Unknown integration' });
  if (!integration.enabled) return res.status(403).json({ message: 'Integration disabled' });

  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';
  const verify = integration.provider === 'tebex' ? verifyTebexSignature : verifyCraftingStoreSignature;
  const signature = req.header('X-Signature') || req.header('X-Webhook-Signature');
  if (!verify(rawBody, integration.webhookSecret, signature)) {
    logger.warn(`Rejected store webhook for integration ${integration.id}: invalid signature`);
    return res.status(401).json({ message: 'Invalid signature' });
  }

  const { packageId, username } = parseStorePayload(integration.provider, req.body || {});
  handleStorePurchase(integration.id, packageId, username).catch((err) => {
    logger.error(`Store webhook handling failed for ${integration.id}: ${(err as Error).message}`);
  });

  // Respond immediately — the actual command dispatch is fire-and-forget,
  // matching this codebase's established webhook-processing posture.
  return res.json({ received: true });
});

export default router;
