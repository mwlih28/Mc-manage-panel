import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../utils/prisma';
import { getLiveServerStatus } from '../services/serverStatus';

const router = Router();

// Unauthenticated endpoint — protect against scraping/abuse the same way
// login is protected, just with a looser limit since this is read-only.
const publicStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, slow down.' },
});

// GET /public/status/:slug — no auth. Only returns what the owner opted
// into sharing (publicStatusEnabled) and never anything beyond basic join
// info — no owner identity, no internal IDs, no file/console access.
router.get('/status/:slug', publicStatusLimiter, async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { publicSlug: req.params.slug, publicStatusEnabled: true },
    include: { node: true, allocation: true },
  });
  if (!server) return res.status(404).json({ message: 'Not found' });

  const live = await getLiveServerStatus(server);

  return res.json({
    name: server.name,
    description: server.description || null,
    ...live,
    accentColor: server.publicStatusAccentColor || null,
    banner: server.publicStatusBanner || null,
    logo: server.publicStatusLogo || null,
    announcement: server.publicStatusAnnouncement || null,
    customCss: server.publicStatusCustomCss || null,
  });
});

export default router;
