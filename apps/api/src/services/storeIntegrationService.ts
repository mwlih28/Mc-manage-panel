import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { sendCommand, updateServerBuild } from './wingsClient';
import { logger } from '../utils/logger';

export interface CommandMapping {
  packageId: string;
  // Either or both may be set: command runs a console command (e.g. grant a
  // rank), planId applies a resource-plan upgrade to the server. Neither is
  // required to be present on its own — a purely resource-upgrade package
  // needs no command, and a rank-grant package needs no plan.
  command?: string;
  planId?: string;
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
