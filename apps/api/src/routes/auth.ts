import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { generateTokenPair, verifyRefreshToken } from '../utils/jwt';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { verify } from 'otplib';
import { sendPasswordResetEmail } from '../services/emailService';
import { logActivity } from '../services/activityService';
import { logger } from '../utils/logger';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET!;

function getFrontendOrigin(): string {
  return process.env.CORS_ORIGIN || 'http://localhost:5173';
}

// The API's own public base URL — Discord redirects the browser back here
// after authorization, so it must be reachable from the outside, not the
// frontend origin. Same domain in the common single-nginx-proxy deploy
// (install-panel.sh sets APP_URL to that domain), separate in a split
// frontend/API deploy.
function getApiBaseUrl(): string {
  return (process.env.APP_URL || getFrontendOrigin()).replace(/\/$/, '');
}

// Brute-force protection: 10 attempts / 15 min per IP on credential-guessing endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

function safeUser(user: Record<string, unknown>) {
  const { password, twoFactorSecret, ...rest } = user;
  void password; void twoFactorSecret;
  return rest;
}

router.post(
  '/login',
  authLimiter,
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

    await logActivity({
      userId: user.id,
      event: 'auth:login',
      ip: req.ip,
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

router.post('/2fa/verify', authLimiter, async (req: Request, res: Response) => {
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
  authLimiter,
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
    const payload = verifyRefreshToken(refreshToken);
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
  await logActivity({
    userId: req.user!.id,
    event: 'auth:logout',
    ip: req.ip,
  }).catch(() => {});
  return res.json({ message: 'Logged out successfully' });
});

// POST /auth/forgot-password — emails a reset link via the panel owner's own SMTP
router.post('/forgot-password', authLimiter, [body('email').isEmail().normalizeEmail()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email } = req.body;
  // Always return the same generic response, whether or not the email exists,
  // so this endpoint can't be used to enumerate registered accounts.
  const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.json(genericResponse);

  const resetToken = crypto.randomBytes(32).toString('hex');
  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const appNameRow = await prisma.setting.findUnique({ where: { key: 'app.name' } });
  const frontendOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const resetUrl = `${frontendOrigin}/reset-password?token=${resetToken}`;
  sendPasswordResetEmail(user.email, resetUrl, appNameRow?.value || 'Kretase').catch(() => {});

  return res.json(genericResponse);
});

// POST /auth/reset-password
router.post(
  '/reset-password',
  [body('token').notEmpty(), body('password').isLength({ min: 8 })],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { token, password } = req.body;
    const user = await prisma.user.findUnique({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpiry: null },
    });

    await logActivity({ userId: user.id, event: 'auth:password_reset', ip: req.ip }).catch(() => {});

    return res.json({ message: 'Password updated — you can now log in' });
  }
);

// GET /auth/discord — kicks off Discord OAuth login. The state param is a
// short-lived signed JWT (not a server-side session — this API is stateless)
// so the callback can prove the request round-tripped through Discord
// rather than being a forged direct hit.
router.get('/discord', async (_req: Request, res: Response) => {
  const frontend = getFrontendOrigin();
  const [clientIdRow, enabledRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'discord.oauth.clientId' } }),
    prisma.setting.findUnique({ where: { key: 'discord.oauth.enabled' } }),
  ]);
  if (enabledRow?.value !== 'true' || !clientIdRow?.value) {
    return res.redirect(`${frontend}/login?error=discord_not_configured`);
  }

  const state = jwt.sign({ nonce: crypto.randomBytes(8).toString('hex') }, JWT_SECRET, { expiresIn: '10m' });
  const redirectUri = `${getApiBaseUrl()}/api/v1/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: clientIdRow.value,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
  });
  return res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// GET /auth/discord/callback — exchanges the code, finds/links/creates the
// user, then hands off to the SPA the same way a normal login would: a
// redirect carrying either a pendingToken (2FA still required — Discord
// login does not bypass it) or a real token pair for the frontend to store.
router.get('/discord/callback', async (req: Request, res: Response) => {
  const frontend = getFrontendOrigin();
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) return res.redirect(`${frontend}/login?error=discord_cancelled`);
  if (!code || !state) return res.redirect(`${frontend}/login?error=discord_invalid`);
  try {
    jwt.verify(state, JWT_SECRET);
  } catch {
    return res.redirect(`${frontend}/login?error=discord_invalid`);
  }

  const [clientIdRow, clientSecretRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'discord.oauth.clientId' } }),
    prisma.setting.findUnique({ where: { key: 'discord.oauth.clientSecret' } }),
  ]);
  if (!clientIdRow?.value || !clientSecretRow?.value) {
    return res.redirect(`${frontend}/login?error=discord_not_configured`);
  }

  try {
    const redirectUri = `${getApiBaseUrl()}/api/v1/auth/discord/callback`;
    const tokenResp = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientIdRow.value,
        client_secret: clientSecretRow.value,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const discordAccessToken = tokenResp.data.access_token as string;
    const meResp = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${discordAccessToken}` },
    });
    const discordUser = meResp.data as { id: string; username: string; global_name?: string; email?: string; verified?: boolean };

    // Discord's `email` scope can still return an unverified address — don't
    // use it to link/create an account, since that would let someone claim
    // an email they don't actually control.
    if (!discordUser.email || !discordUser.verified) {
      return res.redirect(`${frontend}/login?error=discord_email_unverified`);
    }

    let user = await prisma.user.findUnique({ where: { discordId: discordUser.id } });

    if (!user) {
      const existingByEmail = await prisma.user.findUnique({ where: { email: discordUser.email } });
      if (existingByEmail) {
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: { discordId: discordUser.id, discordUsername: discordUser.username },
        });
      }
    }

    if (!user) {
      let username = discordUser.username.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || `user${discordUser.id.slice(-6)}`;
      if (await prisma.user.findUnique({ where: { username } })) {
        username = `${username.slice(0, 14)}${crypto.randomBytes(3).toString('hex')}`;
      }
      // No usable password — this account only ever authenticates via
      // Discord unless the owner sets one through the normal reset flow.
      const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      user = await prisma.user.create({
        data: {
          email: discordUser.email,
          username,
          password: unusablePassword,
          firstName: discordUser.global_name || discordUser.username,
          lastName: '',
          discordId: discordUser.id,
          discordUsername: discordUser.username,
        },
      });
    } else if (user.discordUsername !== discordUser.username) {
      user = await prisma.user.update({ where: { id: user.id }, data: { discordUsername: discordUser.username } });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await logActivity({ userId: user.id, event: 'auth:login', ip: req.ip, properties: JSON.stringify({ via: 'discord' }) }).catch(() => {});

    if (user.twoFactor && user.twoFactorSecret) {
      const pendingToken = jwt.sign({ userId: user.id, pending: true }, JWT_SECRET, { expiresIn: '5m' });
      return res.redirect(`${frontend}/login?requiresTwoFactor=1&pendingToken=${encodeURIComponent(pendingToken)}`);
    }

    const tokens = generateTokenPair({ userId: user.id, email: user.email, role: user.role });
    return res.redirect(`${frontend}/auth/discord/callback?accessToken=${encodeURIComponent(tokens.accessToken)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}`);
  } catch (err) {
    logger.warn(`Discord OAuth callback failed: ${(err as Error).message}`);
    return res.redirect(`${frontend}/login?error=discord_failed`);
  }
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
