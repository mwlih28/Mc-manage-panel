import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { sendCommand } from './wingsClient';
import { logger } from '../utils/logger';

export interface CommandMapping {
  packageId: string;
  command: string;
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

// Extracts { packageId, username } from a store's webhook payload. Both
// providers nest this differently — kept isolated here so a real payload
// shape mismatch only needs a fix in one place.
export function parseStorePayload(provider: string, body: Record<string, unknown>): { packageId: string | null; username: string | null } {
  if (provider === 'tebex') {
    const p = body as { package?: { id?: number | string }; player?: { username?: string } };
    return { packageId: p.package?.id != null ? String(p.package.id) : null, username: p.player?.username || null };
  }
  // CraftingStore's actual field names should be confirmed against their
  // current webhook payload docs — this is a best-effort mapping.
  const p = body as { package_id?: number | string; packageId?: number | string; username?: string; player_name?: string };
  const packageId = p.package_id ?? p.packageId;
  return { packageId: packageId != null ? String(packageId) : null, username: p.username || p.player_name || null };
}

export async function handleStorePurchase(integrationId: string, packageId: string | null, username: string | null): Promise<void> {
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

  const command = mapping.command.replace(/\{username\}/g, username || 'unknown');

  try {
    if (!integration.server.node) throw new Error('Server has no assigned node');
    await sendCommand(integration.server as Parameters<typeof sendCommand>[0], command);
    await prisma.storeIntegration.update({
      where: { id: integrationId },
      data: { lastTriggeredAt: new Date(), lastStatus: 'success', lastError: null },
    });
  } catch (err) {
    logger.warn(`Store integration ${integrationId} failed to run command: ${(err as Error).message}`);
    await prisma.storeIntegration.update({
      where: { id: integrationId },
      data: { lastTriggeredAt: new Date(), lastStatus: 'failed', lastError: (err as Error).message.slice(0, 500) },
    });
  }
}
