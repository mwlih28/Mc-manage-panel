import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

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

  const base = {
    name: server.name,
    description: server.description || null,
    online: false as boolean,
    playerCount: 0,
    maxPlayers: null as number | null,
    motd: null as string | null,
    address: server.allocation ? `${server.node?.fqdn}:${server.allocation.port}` : null,
    accentColor: server.publicStatusAccentColor || null,
    banner: server.publicStatusBanner || null,
  };

  if (!server.node) return res.json(base);

  const client = axios.create({
    baseURL: `${server.node.scheme}://${server.node.fqdn}:${server.node.daemonPort}/api`,
    headers: { Authorization: `Bearer ${server.node.token}` },
    timeout: 5000,
  });

  try {
    const [statusRes, playersRes, propsRes] = await Promise.allSettled([
      client.get(`/servers/${server.uuid}/status`),
      client.get(`/servers/${server.uuid}/players`),
      client.get(`/servers/${server.uuid}/files/contents`, { params: { file: 'server.properties' } }),
    ]);

    if (statusRes.status === 'fulfilled') {
      base.online = statusRes.value.data.status === 'running';
    }
    if (playersRes.status === 'fulfilled') {
      base.playerCount = playersRes.value.data.count ?? playersRes.value.data.players?.length ?? 0;
    }
    if (propsRes.status === 'fulfilled') {
      const content: string = propsRes.value.data.content || '';
      const motdMatch = content.match(/^motd=(.*)$/m);
      const maxMatch = content.match(/^max-players=(\d+)$/m);
      if (motdMatch) base.motd = motdMatch[1].replace(/\\u00a7[0-9a-fk-or]/gi, '').trim();
      if (maxMatch) base.maxPlayers = parseInt(maxMatch[1], 10);
    }
  } catch (err) {
    logger.warn(`Public status lookup failed for ${server.uuid}: ${(err as Error).message}`);
  }

  return res.json(base);
});

export default router;
