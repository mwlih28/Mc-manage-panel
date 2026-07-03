import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
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
