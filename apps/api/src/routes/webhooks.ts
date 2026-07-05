import crypto from 'crypto';
import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { prisma } from '../utils/prisma';
import { WEBHOOK_EVENTS } from '../utils/webhookEvents';
import { formatDiscordPayload } from '../services/discordFormatter';
import axios from 'axios';
import { logger } from '../utils/logger';

const router = Router();

// Webhooks are a system-level integration point, same posture as admin API
// keys — every route here requires an authenticated admin.
router.use(authenticate, requireAdmin);

router.get('/events', (_req, res) => {
  return res.json({ data: WEBHOOK_EVENTS });
});

router.get('/', async (_req: AuthRequest, res: Response) => {
  const webhooks = await prisma.webhook.findMany({
    orderBy: { createdAt: 'desc' },
    include: { server: { select: { id: true, name: true } } },
  });
  return res.json({
    data: webhooks.map((w) => ({ ...w, events: JSON.parse(w.events) })),
  });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, url, mode, events, serverId } = req.body as {
    name?: string; url?: string; mode?: string; events?: string[]; serverId?: string | null;
  };

  if (!name || !name.trim()) return res.status(422).json({ message: 'Name is required' });
  if (!url || !/^https?:\/\/.{1,2000}$/.test(url)) return res.status(422).json({ message: 'A valid http(s) URL is required' });
  const finalMode = mode === 'discord' ? 'discord' : 'generic';
  if (!Array.isArray(events) || events.length === 0) return res.status(422).json({ message: 'Select at least one event' });

  if (serverId) {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return res.status(422).json({ message: 'Server not found' });
  }

  const secret = finalMode === 'generic' ? crypto.randomBytes(32).toString('hex') : null;

  const created = await prisma.webhook.create({
    data: {
      name: name.trim(),
      url,
      mode: finalMode,
      secret,
      events: JSON.stringify(events),
      serverId: serverId || null,
    },
  });

  return res.status(201).json({ data: { ...created, events: JSON.parse(created.events) } });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const webhook = await prisma.webhook.findUnique({ where: { id: req.params.id } });
  if (!webhook) return res.status(404).json({ message: 'Webhook not found' });

  const { name, url, mode, events, serverId, enabled, regenerateSecret } = req.body as {
    name?: string; url?: string; mode?: string; events?: string[]; serverId?: string | null;
    enabled?: boolean; regenerateSecret?: boolean;
  };

  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name.trim()) return res.status(422).json({ message: 'Name is required' });
    data.name = name.trim();
  }
  if (url !== undefined) {
    if (!/^https?:\/\/.{1,2000}$/.test(url)) return res.status(422).json({ message: 'A valid http(s) URL is required' });
    data.url = url;
  }
  if (mode !== undefined) {
    data.mode = mode === 'discord' ? 'discord' : 'generic';
    if (data.mode === 'generic' && !webhook.secret) data.secret = crypto.randomBytes(32).toString('hex');
  }
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length === 0) return res.status(422).json({ message: 'Select at least one event' });
    data.events = JSON.stringify(events);
  }
  if (serverId !== undefined) {
    if (serverId) {
      const server = await prisma.server.findUnique({ where: { id: serverId } });
      if (!server) return res.status(422).json({ message: 'Server not found' });
    }
    data.serverId = serverId || null;
  }
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (regenerateSecret && (data.mode || webhook.mode) === 'generic') {
    data.secret = crypto.randomBytes(32).toString('hex');
  }

  const updated = await prisma.webhook.update({ where: { id: webhook.id }, data });
  return res.json({ data: { ...updated, events: JSON.parse(updated.events) } });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const webhook = await prisma.webhook.findUnique({ where: { id: req.params.id } });
  if (!webhook) return res.status(404).json({ message: 'Webhook not found' });

  await prisma.webhook.delete({ where: { id: webhook.id } });
  return res.status(204).send();
});

// Synchronously awaited (unlike production dispatch) since the admin is
// deliberately waiting on the result — runs a synthetic sample event
// through the exact same formatter/signing code path as a real delivery.
router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  const webhook = await prisma.webhook.findUnique({ where: { id: req.params.id } });
  if (!webhook) return res.status(404).json({ message: 'Webhook not found' });

  const sampleCtx = {
    server: { id: 'sample', name: 'Sample Server', uuid: 'sample-uuid' },
    user: { id: req.user!.id, username: req.user!.username, email: req.user!.email },
    properties: { note: 'This is a test delivery from Kretase' },
  };

  try {
    if (webhook.mode === 'discord') {
      await axios.post(webhook.url, formatDiscordPayload('server:create', sampleCtx), { timeout: 8000 });
    } else {
      const body = JSON.stringify({ event: 'server:create', timestamp: new Date().toISOString(), ...sampleCtx });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Kretase-Event': 'server:create',
        'X-Kretase-Delivery': crypto.randomUUID(),
      };
      if (webhook.secret) {
        headers['X-Kretase-Signature'] = `sha256=${crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')}`;
      }
      await axios.post(webhook.url, body, { headers, timeout: 8000 });
    }
    await prisma.webhook.update({ where: { id: webhook.id }, data: { lastStatus: 'success', lastTriggeredAt: new Date(), lastError: null } });
    return res.json({ message: 'Test delivery succeeded' });
  } catch (err) {
    const message = (err as Error).message;
    logger.warn(`Webhook test delivery failed (${webhook.id}): ${message}`);
    await prisma.webhook.update({ where: { id: webhook.id }, data: { lastStatus: 'failed', lastTriggeredAt: new Date(), lastError: message.slice(0, 500) } });
    return res.status(502).json({ message: `Test delivery failed: ${message}` });
  }
});

export default router;
