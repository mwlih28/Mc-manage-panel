import crypto from 'crypto';
import Stripe from 'stripe';
import { prisma } from '../utils/prisma';
import { sendCommand, updateServerBuild } from './wingsClient';
import { logger } from '../utils/logger';
import { getApiBaseUrl } from '../routes/auth';

// Stripe Connect Standard's OAuth access token IS itself a live secret key
// scoped to the connected account (per Stripe's own docs: "Use it as you
// would any Stripe secret API key") — no platform secret and no
// {stripeAccount: ...} request option needed here, unlike Express/Custom
// Connect. This is exactly what keeps money flowing straight to the
// admin's own account: this install authenticates AS that account, not as
// a platform acting on its behalf.
export async function getConnectedStripeClient(): Promise<Stripe | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'stripe.connect.accessToken' } });
  return row?.value ? new Stripe(row.value) : null;
}

function stripeWebhookUrl(integrationId: string): string {
  return `${getApiBaseUrl()}/api/v1/store-webhooks/${integrationId}`;
}

// Stripe's own webhook signing secret (whsec_...) only exists once a
// Webhook Endpoint is registered on the connected account — a random hex
// string (fine for Tebex/CraftingStore's simple HMAC-over-shared-secret
// scheme) would never actually verify against Stripe's signatures. This
// auto-creates the endpoint so the admin never has to touch Stripe's own
// dashboard, matching the auto-created Product/Price above.
export async function ensureStripeWebhookEndpoint(integrationId: string): Promise<string | null> {
  const stripe = await getConnectedStripeClient();
  if (!stripe) return null;
  const endpoint = await stripe.webhookEndpoints.create({
    url: stripeWebhookUrl(integrationId),
    enabled_events: ['checkout.session.completed'],
  });
  return endpoint.secret || null;
}

// Best-effort cleanup on delete/secret-rotation — looked up by URL rather
// than a stored endpoint id, since StoreIntegration has no field for it and
// a connected account will only ever have a handful of these endpoints.
export async function deleteStripeWebhookEndpoint(integrationId: string): Promise<void> {
  const stripe = await getConnectedStripeClient();
  if (!stripe) return;
  const url = stripeWebhookUrl(integrationId);
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = list.data.find((e) => e.url === url);
  if (match) await stripe.webhookEndpoints.del(match.id).catch(() => {});
}

export interface CommandMapping {
  packageId: string;
  // Either or both may be set: command runs a console command (e.g. grant a
  // rank), planId applies a resource-plan upgrade to the server. Neither is
  // required to be present on its own — a purely resource-upgrade package
  // needs no command, and a rank-grant package needs no plan.
  command?: string;
  planId?: string;
  // Stripe-only, used once when the mapping is first created (see
  // resolveStripeMapping below) to create the Product/Price that becomes
  // this mapping's packageId. Ignored for tebex/craftingstore, whose
  // packages already carry their own price on the store's own dashboard.
  // Stripe Prices are immutable — changing the charged amount means adding
  // a new mapping (a fresh Price), not editing an existing one.
  unitAmount?: number; // smallest currency unit, e.g. cents for USD
  currency?: string; // ISO 4217, lowercase, e.g. "usd"
}

// Auto-creates a Stripe Product+Price on the connected account for a
// newly-added Stripe mapping so the Price always matches what the admin
// configured, instead of admins hand-copying Price IDs from their own
// Stripe dashboard (and them silently drifting out of sync with the Plan).
// A mapping that already has a packageId is left untouched — see the
// immutability note on CommandMapping above.
export async function resolveStripeMapping(mapping: CommandMapping): Promise<CommandMapping> {
  // A Stripe mapping always needs a Price to sell, whether or not it also
  // applies a resource Plan — a command-only mapping (e.g. grant a rank) is
  // just as valid over Stripe as a plan-upgrade one, it just prices
  // differently. Only skip work once a Price has actually been created.
  if (mapping.packageId) return mapping;

  const stripe = await getConnectedStripeClient();
  if (!stripe) throw new Error('Stripe is not connected — connect it from Admin → Billing & Store first');
  if (!mapping.unitAmount || !mapping.currency) {
    throw new Error('A Stripe mapping needs both a price (unitAmount) and a currency');
  }

  let productName = 'Kretase Purchase';
  if (mapping.planId) {
    const plan = await prisma.plan.findUnique({ where: { id: mapping.planId } });
    if (!plan) throw new Error(`Plan ${mapping.planId} not found`);
    productName = `Kretase — ${plan.name}`;
  }

  const product = await stripe.products.create({ name: productName });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: mapping.unitAmount,
    currency: mapping.currency,
  });

  return { ...mapping, packageId: price.id };
}

// Tebex signs the raw request body with HMAC-SHA256 using the store's
// webhook secret, sent in the X-Signature header — this is the documented
// format as of writing (docs.tebex.io/plugin/other/webhooks). Verify against
// Tebex's current docs before relying on this in production; webhook
// contracts on third-party platforms can change without notice.
export function verifyTebexSignature(rawBody: string, secret: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false; // length mismatch — timingSafeEqual throws rather than returning false
  }
}

// CraftingStore's webhook signing scheme was not independently verifiable
// against live documentation at implementation time — this mirrors the same
// HMAC-SHA256-over-raw-body-in-a-header convention Tebex and most storefront
// webhooks use, but confirm the exact header name and algorithm against
// CraftingStore's current docs before going live.
export function verifyCraftingStoreSignature(rawBody: string, secret: string, signatureHeader: string | undefined): boolean {
  return verifyTebexSignature(rawBody, secret, signatureHeader);
}

export interface PaytrConf {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  testMode: boolean;
}

// Feature no-ops when unconfigured, same pattern as getConnectedStripeClient
// above and getStorageConf() in services/storage/index.ts.
export async function getPaytrConf(): Promise<PaytrConf | null> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'paytr.' } } });
  const conf: Record<string, string> = {};
  for (const r of rows) conf[r.key] = r.value;
  if (!conf['paytr.merchantId'] || !conf['paytr.merchantKey'] || !conf['paytr.merchantSalt']) return null;
  return {
    merchantId: conf['paytr.merchantId'],
    merchantKey: conf['paytr.merchantKey'],
    merchantSalt: conf['paytr.merchantSalt'],
    testMode: conf['paytr.testMode'] === 'true',
  };
}

export interface PaytrTokenFields {
  merchantId: string;
  userIp: string;
  merchantOid: string;
  email: string;
  paymentAmount: number; // kuruş — lira × 100, same "smallest unit" convention as Stripe's unitAmount
  userBasketBase64: string; // base64(JSON.stringify(basket)), computed by the caller
  noInstallment: number;
  maxInstallment: number;
  currency: string; // PayTR's own convention is the literal string "TL", not ISO "TRY"
  testMode: number;
}

// Verified against two independent, code-level PayTR reference
// implementations (a PHP client and the node-paytr npm package's compiled
// source) that agree exactly on field order and algorithm — not guessed.
// merchant_key/merchant_salt are never sent to PayTR over the wire; they
// only ever feed this local HMAC computation.
export function computePaytrToken(fields: PaytrTokenFields, merchantKey: string, merchantSalt: string): string {
  const hashStr = [
    fields.merchantId, fields.userIp, fields.merchantOid, fields.email, fields.paymentAmount,
    fields.userBasketBase64, fields.noInstallment, fields.maxInstallment, fields.currency, fields.testMode,
  ].join('');
  return crypto.createHmac('sha256', merchantKey).update(hashStr + merchantSalt).digest('base64');
}

export interface PaytrCallbackBody {
  merchant_oid?: string;
  status?: string;
  total_amount?: string | number;
  hash?: string;
}

// Same verified contract as computePaytrToken above, but PayTR's own
// documented field order for callbacks (merchant_oid + salt + status +
// total_amount) differs from the token request's order — don't conflate them.
export function verifyPaytrCallback(body: PaytrCallbackBody, merchantKey: string, merchantSalt: string): boolean {
  if (!body.hash || !body.merchant_oid || body.status === undefined || body.total_amount === undefined) return false;
  const hashStr = `${body.merchant_oid}${merchantSalt}${body.status}${body.total_amount}`;
  const expected = crypto.createHmac('sha256', merchantKey).update(hashStr).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(body.hash), Buffer.from(expected));
  } catch {
    return false; // length mismatch — timingSafeEqual throws rather than returning false
  }
}

// Extracts { packageId, username, eventId } from a store's webhook payload.
// Providers nest this differently — kept isolated here so a real payload
// shape mismatch only needs a fix in one place. eventId feeds the dedup
// check in handleStorePurchase below; when a provider's payload shape isn't
// confirmed to carry one, this returns null rather than guessing, which
// just means that call falls back to today's no-dedup behavior.
export function parseStorePayload(provider: string, body: Record<string, unknown>): { packageId: string | null; username: string | null; eventId: string | null } {
  if (provider === 'tebex') {
    const p = body as { id?: string | number; package?: { id?: number | string }; player?: { username?: string } };
    return {
      packageId: p.package?.id != null ? String(p.package.id) : null,
      username: p.player?.username || null,
      eventId: p.id != null ? String(p.id) : null,
    };
  }
  // CraftingStore's actual field names should be confirmed against their
  // current webhook payload docs — this is a best-effort mapping.
  const p = body as {
    id?: string | number; transaction_id?: string | number;
    package_id?: number | string; packageId?: number | string;
    username?: string; player_name?: string;
  };
  const packageId = p.package_id ?? p.packageId;
  const eventId = p.transaction_id ?? p.id;
  return {
    packageId: packageId != null ? String(packageId) : null,
    username: p.username || p.player_name || null,
    eventId: eventId != null ? String(eventId) : null,
  };
}

// Atomically claims a provider event for this integration so a redelivered
// webhook (Stripe and PayTR both guarantee at-least-once delivery) can't run
// fulfillment twice. Returns false if this event was already claimed
// (either a genuine retry, or a concurrent duplicate delivery losing the
// race against the unique constraint). eventId is null for providers/paths
// where no stable per-event identifier is available — those fall back to
// the pre-existing no-dedup behavior rather than blocking on it.
async function claimStoreEvent(integrationId: string, eventId: string | null): Promise<boolean> {
  if (!eventId) return true;
  try {
    await prisma.storeEventLog.create({ data: { integrationId, eventId } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false;
    throw err;
  }
}

export async function handleStorePurchase(integrationId: string, packageId: string | null, username: string | null, eventId: string | null = null): Promise<void> {
  if (!(await claimStoreEvent(integrationId, eventId))) {
    logger.warn(`Skipping duplicate store webhook event ${eventId} for integration ${integrationId}`);
    return;
  }

  const integration = await prisma.storeIntegration.findUnique({
    where: { id: integrationId },
    include: { server: { include: { node: true } } },
  });
  if (!integration || !integration.enabled) return;

  let mappings: CommandMapping[] = [];
  try { mappings = JSON.parse(integration.commandMappings); } catch { /* treat as no mappings */ }
  const mapping = mappings.find((m) => m.packageId === packageId);

  if (!mapping) {
    await prisma.storeIntegration.update({
      where: { id: integrationId },
      data: { lastTriggeredAt: new Date(), lastStatus: 'skipped', lastError: `No command mapped for package ${packageId}` },
    });
    return;
  }

  if (!mapping.command && !mapping.planId) {
    await prisma.storeIntegration.update({
      where: { id: integrationId },
      data: { lastTriggeredAt: new Date(), lastStatus: 'skipped', lastError: `Mapping for package ${packageId} has neither a command nor a plan` },
    });
    return;
  }

  try {
    if (!integration.server.node) throw new Error('Server has no assigned node');

    if (mapping.command) {
      const command = mapping.command.replace(/\{username\}/g, username || 'unknown');
      await sendCommand(integration.server as Parameters<typeof sendCommand>[0], command);
    }

    if (mapping.planId) {
      await applyPlanToServer(integration.serverId, mapping.planId);
    }

    await prisma.storeIntegration.update({
      where: { id: integrationId },
      data: { lastTriggeredAt: new Date(), lastStatus: 'success', lastError: null },
    });
  } catch (err) {
    logger.warn(`Store integration ${integrationId} failed to apply purchase: ${(err as Error).message}`);
    await prisma.storeIntegration.update({
      where: { id: integrationId },
      data: { lastTriggeredAt: new Date(), lastStatus: 'failed', lastError: (err as Error).message.slice(0, 500) },
    });
  }
}

// Updates a server's resource limits to match a Plan and, when the node is
// online, pushes the change live via Wings (no restart required). Throws on
// failure so the caller's existing lastStatus/lastError bookkeeping covers
// this the same way it already covers the console-command path.
export async function applyPlanToServer(serverId: string, planId: string): Promise<void> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const updated = await prisma.server.update({
    where: { id: serverId },
    data: {
      memory: plan.memory, swap: plan.swap, disk: plan.disk, io: plan.io, cpu: plan.cpu,
      databaseLimit: plan.databaseLimit, allocationLimit: plan.allocationLimit, backupLimit: plan.backupLimit,
    },
    include: { node: true },
  });

  if (updated.node) {
    // Best-effort — the DB update above is the source of truth (the plan is
    // applied either way, live now or on the server's next restart), so a
    // node being offline shouldn't make the whole purchase look "failed".
    try {
      await updateServerBuild(updated as Parameters<typeof updateServerBuild>[0], {
        memory_limit: plan.memory, swap: plan.swap, disk_space: plan.disk,
        io_weight: plan.io, cpu_limit: plan.cpu,
      });
    } catch (err) {
      logger.warn(`Live build push failed for server ${serverId} after plan upgrade: ${(err as Error).message}`);
    }
  }
}
