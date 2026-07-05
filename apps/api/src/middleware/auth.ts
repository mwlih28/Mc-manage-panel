import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';
import { API_KEY_PREFIX, ApiKeyScope, hasScope, verifyApiKey } from '../utils/apiKeys';

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  // Admin API keys (Authorization: Bearer kre_<identifier>.<secret>) are a
  // separate credential type from session JWTs — route to key verification
  // instead of trying (and failing) to decode it as a JWT.
  if (token.startsWith(API_KEY_PREFIX)) {
    const result = await verifyApiKey(token);
    if (!result) {
      return res.status(401).json({ message: 'Invalid or expired API key' });
    }
    req.user = result.user;
    req.apiKeyScopes = result.permissions;
    return next();
  }

  try {
    const payload = verifyAccessToken(token);

    // The pending-2FA token from POST /auth/login is signed with the same
    // secret as a real access token but only proves the password step —
    // it must never grant access beyond POST /auth/2fa/verify.
    if (payload.pending) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

// Gates a route behind a specific API key scope (or any one of several —
// e.g. a power-action route accepts the narrow servers:power scope OR the
// broader servers:write). Only meaningful for requests authenticated via an
// admin API key (req.apiKeyScopes set) — a normal session-authenticated
// admin already has full rights for their role and passes through
// untouched, since session logins aren't scoped.
export function requireScope(scope: ApiKeyScope | ApiKeyScope[]) {
  const required = Array.isArray(scope) ? scope : [scope];
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.apiKeyScopes) return next();
    if (!required.some((s) => hasScope(req.apiKeyScopes!, s))) {
      return res.status(403).json({ message: `API key is missing required scope: ${required.join(' or ')}` });
    }
    next();
  };
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return next();
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.pending) return next();
    prisma.user.findUnique({ where: { id: payload.userId } }).then((user) => {
      if (user) req.user = user;
      next();
    });
  } catch {
    next();
  }
}
