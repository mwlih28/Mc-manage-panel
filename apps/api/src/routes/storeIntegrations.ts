import crypto from 'crypto';
import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { prisma } from '../utils/prisma';

const router = Router();

// Config/management is admin-only, same posture as Webhooks/API keys. The
// actual inbound webhook receiver (routes/storeWebhooks.ts) is deliberately
// a separate, unauthenticated router — the store itself can't present a
// Kretase session or API key, only the shared secret in the payload.
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
    provider?: string; name?: string; serverId?: string; commandMappings?: { packageId: string; command: string }[];
  };
  if (provider !== 'tebex' && provider !== 'craftingstore') {
    return res.status(422).json({ message: 'provider must be "tebex" or "craftingstore"' });
  }
  if (!name?.trim()) return res.status(422).json({ message: 'Name is required' });
  if (!serverId) return res.status(422).json({ message: 'serverId is required' });
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) return res.status(422).json({ message: 'Server not found' });

  const webhookSecret = crypto.randomBytes(32).toString('hex');
  const created = await prisma.storeIntegration.create({
    data: {
      provider, name: name.trim(), serverId, webhookSecret,
      commandMappings: JSON.stringify(commandMappings || []),
    },
  });
  return res.status(201).json({ data: { ...created, commandMappings: JSON.parse(created.commandMappings) } });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Integration not found' });

  const { name, serverId, commandMappings, enabled, regenerateSecret } = req.body as {
    name?: string; serverId?: string; commandMappings?: { packageId: string; command: string }[];
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
  if (commandMappings !== undefined) data.commandMappings = JSON.stringify(commandMappings);
  if (typeof enabled === 'boolean') data.enabled = enabled;
  if (regenerateSecret) data.webhookSecret = crypto.randomBytes(32).toString('hex');

  const updated = await prisma.storeIntegration.update({ where: { id: integration.id }, data });
  return res.json({ data: { ...updated, commandMappings: JSON.parse(updated.commandMappings) } });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const integration = await prisma.storeIntegration.findUnique({ where: { id: req.params.id } });
  if (!integration) return res.status(404).json({ message: 'Integration not found' });
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
