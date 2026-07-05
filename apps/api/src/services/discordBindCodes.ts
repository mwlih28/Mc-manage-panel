import crypto from 'crypto';

interface BindCodeEntry {
  serverId: string;
  expiresAt: number;
}

// Short-lived, in-memory (not persisted — a single API process, restarts are
// rare and a stale code just needs regenerating). Proves the Discord operator
// running /bind actually has panel access to the server they're binding,
// without needing a Discord-account-to-Kretase-user identity link.
const CODE_TTL_MS = 10 * 60 * 1000;
const codes = new Map<string, BindCodeEntry>();

export function createBindCode(serverId: string): string {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  codes.set(code, { serverId, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

// Consumes the code on success (single use) so it can't be replayed against
// a different channel/guild.
export function consumeBindCode(code: string): string | null {
  const entry = codes.get(code.toUpperCase());
  if (!entry) return null;
  codes.delete(code.toUpperCase());
  if (entry.expiresAt < Date.now()) return null;
  return entry.serverId;
}
