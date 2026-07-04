import { Router, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { sendUpdateNotification } from '../services/emailService';

const router = Router();

// POST /api/v1/installer/test-smtp — admin only: send a test email to
// whichever admin clicked the button, using the panel SMTP config they
// just entered (not yet saved to the Setting table at this point, so this
// exercises whatever is currently persisted).
router.post('/test-smtp', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const to = req.user!.email;
  const ok = await sendUpdateNotification(to, 'TEST — SMTP is working!').catch(() => false);
  if (!ok) return res.status(500).json({ message: 'SMTP send failed — check host/port/credentials.' });
  return res.json({ message: `Test email sent to ${to}.` });
});

export default router;
