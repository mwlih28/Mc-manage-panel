import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export const API_KEY_PREFIX = 'kre_';

// Every permission scope an admin API key can be granted. "*" grants every
// scope below — checked as a wildcard in hasScope(), not stored expanded.
export const API_KEY_SCOPES = [
  'servers:read', 'servers:write',
  'users:read', 'users:write',
  'nodes:read', 'nodes:write',
  'eggs:read', 'eggs:write',
] as const;
export type ApiKeyScope = typeof API_KEY_SCOPES[number];

export function hasScope(granted: string[], required: ApiKeyScope): boolean {
  return granted.includes('*') || granted.includes(required);
}

interface GeneratedKey {
  identifier: string;
  secret: string;
  fullKey: string;
  tokenHash: string;
}

// Generates a fresh identifier+secret pair. The secret is only ever
// returned to the caller once, at creation time — only its bcrypt hash is
// persisted, exactly like a password.
export async function generateApiKey(): Promise<GeneratedKey> {
  const identifier = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const fullKey = `${API_KEY_PREFIX}${identifier}.${secret}`;
  const tokenHash = await bcrypt.hash(secret, 12);
  return { identifier, secret, fullKey, tokenHash };
}

// Parses "kre_<identifier>.<secret>" and validates it against the database:
// looks up the key by identifier, checks it hasn't expired, and verifies
// the secret against the stored bcrypt hash. Updates lastUsedAt on success.
// Returns null for any failure (unknown key, expired, bad secret) without
// distinguishing which — same principle as a failed password login.
export async function verifyApiKey(presented: string) {
  if (!presented.startsWith(API_KEY_PREFIX)) return null;
  const withoutPrefix = presented.slice(API_KEY_PREFIX.length);
  const dotIndex = withoutPrefix.indexOf('.');
  if (dotIndex === -1) return null;
  const identifier = withoutPrefix.slice(0, dotIndex);
  const secret = withoutPrefix.slice(dotIndex + 1);

  const key = await prisma.apiKey.findUnique({ where: { identifier }, include: { user: true } });
  if (!key) return null;
  if (key.expiresAt && key.expiresAt < new Date()) return null;

  const valid = await bcrypt.compare(secret, key.token);
  if (!valid) return null;

  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  let permissions: string[] = [];
  try { permissions = JSON.parse(key.permissions); } catch { /* default to no scopes */ }

  return { key, user: key.user, permissions };
}
