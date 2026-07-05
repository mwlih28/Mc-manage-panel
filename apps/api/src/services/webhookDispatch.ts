import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { eventMatches } from '../utils/webhookEvents';
import { formatDiscordPayload } from './discordFormatter';
import { logger } from '../utils/logger';

const DELIVERY_TIMEOUT_MS = 8000;

interface DispatchContext {
  serverId?: string | null;
  userId?: string | null;
  properties?: string; // JSON-stringified, matches Activity.properties
}

// Fire-and-forget: called from logActivity() after every event is already
// durably recorded, so a failed/slow delivery here never loses data and
// never delays the caller's response. Single attempt, no retry — matches
// the codebase's established fire-and-forget norm for outbound calls.
export async function dispatchWebhooks(event: string, ctx: DispatchContext): Promise<void> {
  try {
    const where = ctx.serverId
      ? { enabled: true, OR: [{ serverId: null }, { serverId: ctx.serverId }] }
      : { enabled: true, serverId: null as string | null };

    const webhooks = await prisma.webhook.findMany({ where });
    const matching = webhooks.filter((w) => {
      let events: string[] = [];
      try { events = JSON.parse(w.events); } catch { /* treat as no events */ }
      return events.some((pattern) => eventMatches(pattern, event));
    });
    if (matching.length === 0) return;

    const [server, user] = await Promise.all([
      ctx.serverId
        ? prisma.server.findUnique({ where: { id: ctx.serverId }, select: { id: true, name: true, uuid: true } })
        : Promise.resolve(null),
      ctx.userId
        ? prisma.user.findUnique({ where: { id: ctx.userId }, select: { id: true, username: true, email: true } })
        : Promise.resolve(null),
    ]);

    let properties: Record<string, unknown> = {};
    if (ctx.properties) {
      try { properties = JSON.parse(ctx.properties); } catch { /* leave empty */ }
    }

    await Promise.all(matching.map((w) => deliverOne(w.id, w.url, w.mode, w.secret, event, { server, user, properties })));
  } catch (err) {
    logger.warn(`Webhook dispatch failed for event "${event}": ${(err as Error).message}`);
  }
}

async function deliverOne(
  id: string,
  url: string,
  mode: string,
  secret: string | null,
  event: string,
  ctx: { server: { id: string; name: string; uuid: string } | null; user: { id: string; username: string; email: string } | null; properties: Record<string, unknown> }
) {
  const client = axios.create({ timeout: DELIVERY_TIMEOUT_MS });
  try {
    if (mode === 'discord') {
      await client.post(url, formatDiscordPayload(event, ctx));
    } else {
      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        server: ctx.server,
        user: ctx.user,
        properties: ctx.properties,
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Kretase-Event': event,
        'X-Kretase-Delivery': crypto.randomUUID(),
      };
      if (secret) {
        const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
        headers['X-Kretase-Signature'] = `sha256=${signature}`;
      }
      await client.post(url, body, { headers });
    }
    await prisma.webhook.update({
      where: { id },
      data: { lastStatus: 'success', lastTriggeredAt: new Date(), lastError: null },
    }).catch(() => {});
  } catch (err) {
    const message = (err as Error).message;
    logger.warn(`Webhook delivery failed (${id}, ${url}): ${message}`);
    await prisma.webhook.update({
      where: { id },
      data: { lastStatus: 'failed', lastTriggeredAt: new Date(), lastError: message.slice(0, 500) },
    }).catch(() => {});
  }
}
