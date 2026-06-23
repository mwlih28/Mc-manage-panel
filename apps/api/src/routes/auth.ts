import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { generateTokenPair } from '../utils/jwt';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { verify } from 'otplib';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

function safeUser(user: Record<string, unknown>) {
  const { password, twoFactorSecret, smtpPass, ...rest } = user;
  void password; void twoFactorSecret; void smtpPass;
  return rest;
}

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    await prisma.activity.create({
      data: {
        userId: user.id,
        event: 'auth:login',
        ip: req.ip,
      },
    }).catch(() => {});

    // 2FA check
    if (user.twoFactor && user.twoFactorSecret) {
      const pendingToken = jwt.sign({ userId: user.id, pending: true }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ requiresTwoFactor: true, pendingToken });
    }

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json({ ...tokens, user: safeUser(user as unknown as Record<string, unknown>) });
  }
);

router.post('/2fa/verify', async (req: Request, res: Response) => {
  const { pendingToken, code } = req.body;
  if (!pendingToken || !code) return res.status(422).json({ message: 'pendingToken and code required' });
  try {
    const payload = jwt.verify(pendingToken, JWT_SECRET) as { userId: string; pending: boolean };
    if (!payload.pending) return res.status(401).json({ message: 'Invalid token' });
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.twoFactor || !user.twoFactorSecret) return res.status(401).json({ message: 'Invalid state' });
    const result = await verify({ secret: user.twoFactorSecret, token: code });
    const valid = result.valid;
    if (!valid) return res.status(401).json({ message: 'Invalid 2FA code' });

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    return res.json({ ...tokens, user: safeUser(user as unknown as Record<string, unknown>) });
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
});

router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    const { email, username, password, firstName, lastName } = req.body;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existing) {
      return res.status(409).json({ message: 'Email or username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        firstName,
        lastName,
      },
    });

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return res.status(201).json({ ...tokens, user: safeUser(user as unknown as Record<string, unknown>) });
  }
);

router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token required' });
  }

  try {
    const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json(tokens);
  } catch {
    return res.status(401).json({ message: 'Invalid refresh token' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: safeUser(user as unknown as Record<string, unknown>) });
});

router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  await prisma.activity.create({
    data: {
      userId: req.user!.id,
      event: 'auth:logout',
      ip: req.ip,
    },
  }).catch(() => {});
  return res.json({ message: 'Logged out successfully' });
});

// GET /auth/setup/status - check if initial setup is needed
router.get('/setup/status', async (_req, res) => {
  const count = await prisma.user.count();
  return res.json({ needsSetup: count === 0 });
});

// POST /auth/setup - create first admin user (only works if no users exist)
router.post(
  '/setup',
  [
    body('email').isEmail().normalizeEmail(),
    body('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    const count = await prisma.user.count();
    if (count > 0) {
      return res.status(403).json({ message: 'Setup already completed' });
    }

    const { email, username, password, firstName, lastName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        firstName,
        lastName,
        role: 'ADMIN',
        rootAdmin: true,
      },
    });

    const tokens = generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return res.status(201).json({ ...tokens, user: safeUser(user as unknown as Record<string, unknown>) });
  }
);

export default router;
