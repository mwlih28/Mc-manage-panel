import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendUpdateNotification } from '../services/emailService';

const router = Router();

// POST /api/v1/installer/test-smtp — admin only: send test email to owner
router.post('/test-smtp', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const ownerEmail = process.env.REGISTRY_SMTP_OWNER
    || await prisma.setting.findUnique({ where: { key: 'smtp.owner_email' } }).then(r => r?.value || '');
  if (!ownerEmail) {
    return res.status(400).json({ message: 'No owner email configured. Set REGISTRY_SMTP_OWNER in .env or smtp.owner_email in Settings.' });
  }
  const ok = await sendUpdateNotification(ownerEmail, 'TEST — SMTP is working!').catch(() => false);
  if (!ok) return res.status(500).json({ message: 'SMTP send failed — check host/port/credentials.' });
  return res.json({ message: `Test email sent to ${ownerEmail}.` });
});

export default router;
