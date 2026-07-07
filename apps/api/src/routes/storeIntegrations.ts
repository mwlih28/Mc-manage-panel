import crypto from 'crypto';
import axios from 'axios';
import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { prisma } from '../utils/prisma';
import {
  CommandMapping, resolveStripeMapping, getConnectedStripeClient,
  ensureStripeWebhookEndpoint, deleteStripeWebhookEndpoint,
  getPaytrConf, computePaytrToken,
} from '../services/storeIntegrationService';
import { getFrontendOrigin } from './auth';
import { logger } from '../utils/logger';

const PROVIDERS = new Set(['tebex', 'craftingstore', 'stripe', 'paytr']);
const PROVIDERS_MESSAGE = 'provider must be "tebex", "craftingstore", "stripe", or "paytr"';

// Stripe mappings don't arrive with a packageId (the admin picks a Plan +
// price, not a pre-existing external package) — this fills it in by
// creating the matching Stripe Product/Price. PayTR mappings also arrive
// without one (same "admin picks a price, not an external package" UX) but
// need no network call — PayTR has no Product/Price API, so a locally
// generated id is all a mapping needs. Left as a no-op for
// tebex/craftingstore, whose mappings already carry a real packageId.
async function resolveMappings(provider: string, mappings: CommandMapping[]): Promise<CommandMapping[]> {
  if (provider === 'stripe') return Promise.all(mappings.map(resolveStripeMapping));
  if (provider === 'paytr') {
    return mappings.map((m) => {
      if (m.packageId) return m;
      if (!m.unitAmount || !m.currency) {
        throw new Error('A PayTR mapping needs both a price (unitAmount) and a currency');
      }
      return { ...m, packageId: crypto.randomBytes(8).toString('hex') };
    });
  }
  return mappings;
}

const router = Router();

// Reachable by the server's own owner, not just admins — this is the
// "upgrade my own server" entry point a customer's own server page links
// to, not an admin-management action. Registered before the router-wide
// requireAdmin gate below so it only needs `authenticate`.
router.get('/:id/checkout', authenticate, async (req: AuthRequest, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({
    where: { id: req.params.id },
    include: { server: { include: { user: true } } },
  });
  if (!integration || !integration.enabled) return res.status(404).json({ message: 'Integration not found' });
  if (integration.provider !== 'stripe' && integration.provider !== 'paytr') {
    return res.status(422).json({ message: 'Checkout is only available for Stripe or PayTR integrations' });
  }

  const isAdmin = req.user!.role === 'ADMIN';
  if (!isAdmin && integration.server.userId !== req.user!.id) {
    return res.status(404).json({ message: 'Integration not found' });
  }

  let mappings: CommandMapping[] = [];
  try { mappings = JSON.parse(integration.commandMappings); } catch { /* no mappings configured yet */ }
  const { packageId } = req.query as { packageId?: string };
  const mapping = packageId ? mappings.find((m) => m.packageId === packageId) : mappings[0];
  if (!mapping?.packageId) return res.status(422).json({ message: 'No purchasable package configured for this integration' });

  const frontend = getFrontendOrigin();

  if (integration.provider === 'stripe') {
    const stripe = await getConnectedStripeClient();
    if (!stripe) return res.status(502).json({ message: 'Stripe is not connected on this panel' });
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: mapping.packageId, quantity: 1 }],
        // Read back directly off the webhook event's session object — simpler
        // and more reliable than expanding/re-fetching line_items, since
        // metadata is always present on the base Checkout Session payload.
        metadata: { integrationId: integration.id, packageId: mapping.packageId },
        success_url: `${frontend}/servers/${integration.serverId}?stripeCheckout=success`,
        cancel_url: `${frontend}/servers/${integration.serverId}?stripeCheckout=cancelled`,
      });
      return res.json({ url: session.url });
    } catch (err) {
      return res.status(502).json({ message: `Failed to start checkout: ${(err as Error).message}` });
    }
  }

  // provider === 'paytr'
  const conf = await getPaytrConf();
  if (!conf) return res.status(502).json({ message: 'PayTR is not connected on this panel' });
  if (!mapping.unitAmount) return res.status(422).json({ message: 'This package has no price configured' });

  const buyer = integration.server.user;
  const merchantOid = crypto.randomBytes(16).toString('hex'); // alphanumeric-only per PayTR's requirement
  await prisma.payTrOrder.create({
    data: { merchantOid, integrationId: integration.id, packageId: mapping.packageId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const userIp = req.ip || '127.0.0.1';
  const userBasketBase64 = Buffer.from(JSON.stringify([[integration.name, (mapping.unitAmount / 100).toFixed(2), 1]])).toString('base64');
  const testMode = conf.testMode ? 1 : 0;
  const paytrToken = computePaytrToken(
    {
      merchantId: conf.merchantId, userIp, merchantOid, email: buyer.email, paymentAmount: mapping.unitAmount,
      userBasketBase64, noInstallment: 0, maxInstallment: 0, currency: 'TL', testMode,
    },
    conf.merchantKey, conf.merchantSalt
  );

  try {
    const body = new URLSearchParams({
      merchant_id: conf.merchantId,
      user_ip: userIp,
      merchant_oid: merchantOid,
      email: buyer.email,
      payment_amount: String(mapping.unitAmount),
      paytr_token: paytrToken,
      user_basket: userBasketBase64,
      debug_on: '0',
      no_installment: '0',
      max_installment: '0',
      // Kretase doesn't collect a billing address/phone from users today —
      // PayTR requires non-empty strings here but doesn't hard-reject
      // placeholders for the iframe flow. Worth revisiting if PayTR's own
      // fraud scoring turns out to weight these fields meaningfully.
      user_name: `${buyer.firstName} ${buyer.lastName}`.trim() || buyer.username,
      user_address: 'N/A',
      user_phone: 'N/A',
      merchant_ok_url: `${frontend}/servers/${integration.serverId}?paytrCheckout=success`,
      merchant_fail_url: `${frontend}/servers/${integration.serverId}?paytrCheckout=failed`,
      timeout_limit: '30',
      currency: 'TL',
      test_mode: String(testMode),
    });
    const resp = await axios.post('https://www.paytr.com/odeme/api/get-token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (resp.data?.status !== 'success' || !resp.data?.token) {
      return res.status(502).json({ message: resp.data?.reason || 'PayTR rejected the checkout request' });
    }
    return res.json({ iframeUrl: `https://www.paytr.com/odeme/guvenli/${resp.data.token}` });
  } catch (err) {
    return res.status(502).json({ message: `Failed to start PayTR checkout: ${(err as Error).message}` });
  }
});

// Everything below is config/management, admin-only, same posture as
// Webhooks/API keys. The actual inbound webhook receiver
// (routes/storeWebhooks.ts) is deliberately a separate, unauthenticated
// router — the store itself can't present a Kretase session or API key,
// only the shared secret in the payload.
router.use(authenticate, requireAdmin);

router.get('/', async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.storeIntegration.findMany({
    orderBy: { createdAt: 'desc' },
    include: { server: { select: { id: true, name: true } } },
  });
  return res.json({ data: rows.map((r) => ({ ...r, commandMappings: JSON.parse(r.commandMappings), webhookSecret: undefined })) });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { provider, name, serverId, commandMappings } = req.body as {
    provider?: string; name?: string; serverId?: string; commandMappings?: CommandMapping[];
  };
  if (!provider || !PROVIDERS.has(provider)) {
    return res.status(422).json({ message: PROVIDERS_MESSAGE });
  }
  if (!name?.trim()) return res.status(422).json({ message: 'Name is required' });
  if (!serverId) return res.status(422).json({ message: 'serverId is required' });
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) return res.status(422).json({ message: 'Server not found' });

  let resolvedMappings: CommandMapping[];
  try {
    resolvedMappings = await resolveMappings(provider, commandMappings || []);
  } catch (err) {
    return res.status(422).json({ message: (err as Error).message });
  }

  const webhookSecret = crypto.randomBytes(32).toString('hex');
  let created = await prisma.storeIntegration.create({
    data: {
      provider, name: name.trim(), serverId, webhookSecret,
      commandMappings: JSON.stringify(resolvedMappings),
    },
  });

  if (provider === 'stripe') {
    // Real Stripe webhook signing secret, replacing the random placeholder
    // above — see ensureStripeWebhookEndpoint's comment for why this can't
    // just reuse the generic random-hex-secret scheme the other providers use.
    try {
      const realSecret = await ensureStripeWebhookEndpoint(created.id);
      if (realSecret) created = await prisma.storeIntegration.update({ where: { id: created.id }, data: { webhookSecret: realSecret } });
    } catch (err) {
      logger.warn(`Failed to auto-create Stripe webhook endpoint for integration ${created.id}: ${(err as Error).message}`);
    }
  }

  return res.status(201).json({ data: { ...created, commandMappings: JSON.parse(created.commandMappings) } });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Integration not found' });

  const { name, serverId, commandMappings, enabled, regenerateSecret } = req.body as {
    name?: string; serverId?: string; commandMappings?: CommandMapping[];
    enabled?: boolean; regenerateSecret?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name.trim()) return res.status(422).json({ message: 'Name is required' });
    data.name = name.trim();
  }
  if (serverId !== undefined) {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return res.status(422).json({ message: 'Server not found' });
    data.serverId = serverId;
  }
  if (commandMappings !== undefined) {
    try {
      data.commandMappings = JSON.stringify(await resolveMappings(integration.provider, commandMappings));
    } catch (err) {
      return res.status(422).json({ message: (err as Error).message });
    }
  }
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (regenerateSecret) {
    if (integration.provider === 'stripe') {
      // A random hex string would never verify against Stripe's own
      // signatures — rotate by re-registering the webhook endpoint instead.
      await deleteStripeWebhookEndpoint(integration.id).catch(() => {});
      const realSecret = await ensureStripeWebhookEndpoint(integration.id).catch(() => null);
      if (!realSecret) return res.status(502).json({ message: 'Failed to rotate the Stripe webhook secret — is Stripe still connected?' });
      data.webhookSecret = realSecret;
    } else {
      data.webhookSecret = crypto.randomBytes(32).toString('hex');
    }
  }

  const updated = await prisma.storeIntegration.update({ where: { id: integration.id }, data });
  return res.json({ data: { ...updated, commandMappings: JSON.parse(updated.commandMappings) } });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Integration not found' });
  if (integration.provider === 'stripe') {
    await deleteStripeWebhookEndpoint(integration.id).catch((err) => logger.warn(`Failed to clean up Stripe webhook endpoint for ${integration.id}: ${(err as Error).message}`));
  }
  await prisma.storeIntegration.delete({ where: { id: integration.id } });
  return res.status(204).send();
});

// Reveals the webhook secret once, on demand — mirrors the reveal pattern
// used for SMTP passwords/API secrets elsewhere rather than including it in
// every list/get response.
router.get('/:id/secret', async (req: AuthRequest, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Integration not found' });
  return res.json({ secret: integration.webhookSecret });
});

export default router;
