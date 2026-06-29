import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import {
  sendThankYouEmail,
  sendOwnerNotification,
  sendUpdateNotification,
} from '../services/emailService';

const router = Router();

// Simple in-memory rate limit: 1 registration per IP per hour
const recentIps = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [ip, ts] of recentIps) {
    if (ts < cutoff) recentIps.delete(ip);
  }
}, 600_000);

// POST /api/v1/installer/register — called by install script, no auth
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('serverIp').notEmpty().isString(),
    body('name').optional().isString().trim(),
    body('panelDomain').optional().isString(),
    body('panelVersion').optional().isString(),
    body('notifyUpdates').optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const ip = (req.ip || '127.0.0.1').replace('::ffff:', '');
    const now = Date.now();
    if (recentIps.has(ip) && (now - recentIps.get(ip)!) < 3_600_000) {
      return res.status(429).json({ message: 'Rate limit: one registration per hour per IP.' });
    }
    recentIps.set(ip, now);

    const { email, name = '', serverIp, panelDomain = '', panelVersion = '', notifyUpdates = false } = req.body;

    const existing = await prisma.installerRegistration.findFirst({ where: { serverIp } });
    if (existing) {
      await prisma.installerRegistration.update({
        where: { id: existing.id },
        data: { email, name, panelDomain, panelVersion, notifyUpdates },
      });
      return res.json({ message: 'Registration updated.' });
    }

    await prisma.installerRegistration.create({
      data: { email, name, serverIp, panelDomain, panelVersion, notifyUpdates },
    });

    // Fire-and-forget: thank-you email to installer + owner notification
    sendThankYouEmail(email, name, serverIp).catch(() => {});
    sendOwnerNotification(name, email, serverIp, panelDomain).catch(() => {});

    return res.status(201).json({ message: 'Registered. Thank-you email queued.' });
  }
);

// GET /api/v1/installer/registrations — admin only
router.get('/registrations', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const list = await prisma.installerRegistration.findMany({ orderBy: { installedAt: 'desc' } });
  return res.json(list);
});

// GET /api/v1/installer/registrations/stats — admin only
router.get('/registrations/stats', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const total = await prisma.installerRegistration.count();
  const withNotify = await prisma.installerRegistration.count({ where: { notifyUpdates: true } });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayCount = await prisma.installerRegistration.count({ where: { installedAt: { gte: today } } });
  return res.json({ total, withNotify, today: todayCount });
});

// POST /api/v1/installer/notify-updates
// Accepts either:
//   - JWT admin auth (from the Admin UI)
//   - X-Notify-Secret header matching NOTIFY_WEBHOOK_SECRET env var (for GitHub Actions / CI)
async function notifyUpdatesHandler(req: Request, res: Response) {
  const { version = 'latest', changelogUrl } = req.body;
  if (!version || version === 'latest') {
    return res.status(400).json({ message: 'Provide a version string, e.g. "v1.2.0"' });
  }
  const registrations = await prisma.installerRegistration.findMany({ where: { notifyUpdates: true } });
  if (registrations.length === 0) {
    return res.json({ sent: 0, failed: 0, total: 0, message: 'No opted-in subscribers.' });
  }
  let sent = 0; let failed = 0;
  for (const reg of registrations) {
    const ok = await sendUpdateNotification(reg.email, version, changelogUrl);
    if (ok) sent++; else failed++;
  }
  return res.json({ sent, failed, total: registrations.length });
}

function webhookSecretAuth(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.NOTIFY_WEBHOOK_SECRET;
  if (secret && req.headers['x-notify-secret'] === secret) return next();
  return res.status(401).json({ message: 'Unauthorized' });
}

router.post(
  '/notify-updates',
  (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env.NOTIFY_WEBHOOK_SECRET;
    // Allow webhook secret auth as alternative to JWT
    if (secret && req.headers['x-notify-secret'] === secret) return next();
    // Otherwise require JWT admin
    return authenticate(req as AuthRequest, res, (err?: unknown) => {
      if (err) return next(err);
      return requireAdmin(req as AuthRequest, res, next);
    });
  },
  notifyUpdatesHandler
);
void webhookSecretAuth;

// POST /api/v1/installer/test-smtp — admin only: send test email to owner
router.post('/test-smtp', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  // Resolve owner email: registry env var takes priority, then DB setting
  const ownerEmail = process.env.REGISTRY_SMTP_OWNER
    || await prisma.setting.findUnique({ where: { key: 'smtp.owner_email' } }).then(r => r?.value || '');
  if (!ownerEmail) {
    return res.status(400).json({ message: 'No owner email configured. Set REGISTRY_SMTP_OWNER in .env or smtp.owner_email in Settings.' });
  }
  const ok = await sendUpdateNotification(ownerEmail, 'TEST — SMTP is working!').catch(() => false);
  if (!ok) return res.status(500).json({ message: 'SMTP send failed — check host/port/credentials.' });
  return res.json({ message: `Test email sent to ${ownerEmail}.` });
});

// DELETE /api/v1/installer/registrations/:id — admin only
router.delete('/registrations/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  await prisma.installerRegistration.delete({ where: { id: req.params.id } });
  return res.json({ message: 'Deleted.' });
});

export default router;
