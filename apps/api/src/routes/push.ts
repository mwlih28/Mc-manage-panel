import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getVapidPublicKey } from '../services/pushDispatch';

const router = Router();

router.use(authenticate);

router.get('/vapid-public-key', async (_req: AuthRequest, res: Response) => {
  return res.json({ publicKey: await getVapidPublicKey() });
});

router.post('/subscribe', async (req: AuthRequest, res: Response) => {
  const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(422).json({ message: 'endpoint and keys.p256dh/auth are required' });
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.user!.id, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: req.user!.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return res.status(201).json({ message: 'Subscribed' });
});

router.post('/unsubscribe', async (req: AuthRequest, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return res.status(422).json({ message: 'endpoint is required' });
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.id } });
  return res.status(204).send();
});

export default router;
