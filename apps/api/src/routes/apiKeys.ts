import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { API_KEY_SCOPES, generateApiKey } from '../utils/apiKeys';

const router = Router();

// Admin API keys are a system-level credential, not a per-user convenience
// feature — every route here requires an authenticated admin. Keys are
// scoped to the admin who created them; only that admin can view or revoke
// them (any other admin still can't touch it, avoiding accidental cross-
// admin revocation).
router.use(authenticate, requireAdmin);

router.get('/scopes', (_req, res) => {
  return res.json({ scopes: API_KEY_SCOPES });
});

router.get('/', async (req: AuthRequest, res: Response) => {
  const keys = await prisma.apiKey.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, identifier: true, permissions: true,
      expiresAt: true, allowedIps: true, lastUsedAt: true, createdAt: true,
    },
  });
  return res.json({
    data: keys.map((k) => ({
      ...k,
      permissions: JSON.parse(k.permissions),
      expired: k.expiresAt ? k.expiresAt < new Date() : false,
    })),
  });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, permissions, expiresInDays } = req.body as {
    name?: string; permissions?: string[]; expiresInDays?: number | null;
  };

  if (!name || !name.trim()) {
    return res.status(422).json({ message: 'Name is required' });
  }
  const perms = Array.isArray(permissions) ? permissions : [];
  const invalid = perms.filter((p) => p !== '*' && !(API_KEY_SCOPES as readonly string[]).includes(p));
  if (perms.length === 0 || invalid.length > 0) {
    return res.status(422).json({ message: invalid.length > 0 ? `Unknown permission(s): ${invalid.join(', ')}` : 'At least one permission is required' });
  }

  let expiresAt: Date | null = null;
  if (expiresInDays !== undefined && expiresInDays !== null) {
    const days = Number(expiresInDays);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(422).json({ message: 'expiresInDays must be a positive number, or omitted for a key that never expires' });
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  const { identifier, fullKey, tokenHash } = await generateApiKey();

  const created = await prisma.apiKey.create({
    data: {
      userId: req.user!.id,
      name: name.trim(),
      identifier,
      token: tokenHash,
      permissions: JSON.stringify(perms),
      expiresAt,
    },
    select: { id: true, name: true, identifier: true, permissions: true, expiresAt: true, createdAt: true },
  });

  await prisma.activity.create({
    data: { userId: req.user!.id, event: 'apikey:create', properties: JSON.stringify({ name: created.name, identifier }), ip: req.ip },
  }).catch(() => {});

  logger.info(`API key created: ${created.name} (${identifier}) by ${req.user!.email}`);

  // fullKey is the only time the secret is ever visible — it isn't
  // recoverable afterward, only the bcrypt hash is stored.
  return res.status(201).json({
    data: { ...created, permissions: perms, key: fullKey },
  });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!key) return res.status(404).json({ message: 'API key not found' });

  await prisma.apiKey.delete({ where: { id: key.id } });
  await prisma.activity.create({
    data: { userId: req.user!.id, event: 'apikey:revoke', properties: JSON.stringify({ name: key.name, identifier: key.identifier }), ip: req.ip },
  }).catch(() => {});

  return res.status(204).send();
});

export default router;
