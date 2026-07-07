import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { prisma } from '../utils/prisma';
import {
  verifyTebexSignature, verifyCraftingStoreSignature, parseStorePayload, handleStorePurchase,
  getConnectedStripeClient, getPaytrConf, verifyPaytrCallback, PaytrCallbackBody,
} from '../services/storeIntegrationService';
import { logger } from '../utils/logger';

// Deliberately unauthenticated — the store platform can't present a Kretase
// session or API key, only the shared secret configured on both sides.
// Every request is verified against that secret before anything runs.
const router = Router();

// PayTR is unlike every other provider here: its notify_url is a single
// account-wide setting in the merchant's own PayTR panel, not something
// passed per-transaction or registered per-integration (confirmed against
// PayTR's real request contract — merchant_ok_url/merchant_fail_url are
// browser-redirect targets, there's no separate per-request notify_url
// field at all). So this can't be scoped by a :id path param the way
// Tebex/CraftingStore/Stripe are — one Kretase install has exactly one
// PayTR callback URL, and every callback carries only a merchant_oid,
// which PayTrOrder resolves back to the actual integration it belongs to.
// Registered before the generic /:id route below so Express doesn't treat
// "paytr" as an :id value.
router.post('/paytr', async (req: Request, res: Response) => {
  const conf = await getPaytrConf();
  if (!conf) return res.status(404).json({ message: 'PayTR is not configured' });

  const body = req.body as PaytrCallbackBody;
  if (!verifyPaytrCallback(body, conf.merchantKey, conf.merchantSalt)) {
    logger.warn('Rejected PayTR webhook: invalid hash');
    return res.status(401).send('Invalid hash');
  }

  const order = await prisma.payTrOrder.findUnique({ where: { merchantOid: body.merchant_oid! } });
  if (!order) {
    logger.warn(`PayTR webhook for unknown merchant_oid ${body.merchant_oid}`);
    return res.type('text').send('OK'); // hash-valid but nothing to retry
  }

  if (body.status === 'success') {
    handleStorePurchase(order.integrationId, order.packageId, null).catch((err) => {
      logger.error(`Store webhook handling failed for ${order.integrationId}: ${(err as Error).message}`);
    });
  }

  // PayTR's documented contract requires the literal plaintext body "OK" —
  // never JSON — on any hash-valid notification, or it retries indefinitely.
  return res.type('text').send('OK');
});

router.post('/:id', async (req: Request, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Unknown integration' });
  if (!integration.enabled) return res.status(403).json({ message: 'Integration disabled' });

  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';

  // Stripe's SDK verifies and parses in one call (constructEvent throws on a
  // bad signature) — doesn't fit the verify()-then-parseStorePayload() shape
  // the other two providers use, so it gets its own branch entirely.
  if (integration.provider === 'stripe') {
    const stripe = await getConnectedStripeClient();
    const signature = req.header('Stripe-Signature');
    if (!stripe || !signature) return res.status(401).json({ message: 'Invalid signature' });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, integration.webhookSecret);
    } catch (err) {
      logger.warn(`Rejected Stripe webhook for integration ${integration.id}: ${(err as Error).message}`);
      return res.status(401).json({ message: 'Invalid signature' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const packageId = session.metadata?.packageId || null;
      const username = session.customer_details?.email || null;
      handleStorePurchase(integration.id, packageId, username).catch((err) => {
        logger.error(`Store webhook handling failed for ${integration.id}: ${(err as Error).message}`);
      });
    }
    return res.json({ received: true });
  }

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
