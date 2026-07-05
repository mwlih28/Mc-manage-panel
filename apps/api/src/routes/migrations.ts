import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import {
  testPterodactylConnection, listPterodactylServers, runPterodactylImport,
  ImportSelection, SourceSftpConfig,
} from '../services/pterodactylImport';
import { logger } from '../utils/logger';

const router = Router();

// Importing from another panel touches every server/node/allocation in the
// system — admin-only, same posture as node/egg management.
router.use(authenticate, requireAdmin);

router.post('/pterodactyl/test', async (req: AuthRequest, res: Response) => {
  const { url, apiKey } = req.body as { url?: string; apiKey?: string };
  if (!url || !apiKey) return res.status(422).json({ message: 'url and apiKey are required' });
  try {
    await testPterodactylConnection(url, apiKey);
    return res.json({ message: 'Connection succeeded' });
  } catch (err) {
    return res.status(502).json({ message: `Connection failed: ${(err as Error).message}` });
  }
});

router.post('/pterodactyl/servers', async (req: AuthRequest, res: Response) => {
  const { url, apiKey } = req.body as { url?: string; apiKey?: string };
  if (!url || !apiKey) return res.status(422).json({ message: 'url and apiKey are required' });
  try {
    const servers = await listPterodactylServers(url, apiKey);
    return res.json({ data: servers });
  } catch (err) {
    return res.status(502).json({ message: `Failed to list servers: ${(err as Error).message}` });
  }
});

router.post('/pterodactyl/import', async (req: AuthRequest, res: Response) => {
  const { ssh, selections, ownerUserId } = req.body as { ssh?: SourceSftpConfig; selections?: ImportSelection[]; ownerUserId?: string };
  if (!ssh?.host || !ssh?.username) return res.status(422).json({ message: 'Source SSH host and username are required' });
  if (!Array.isArray(selections) || selections.length === 0) return res.status(422).json({ message: 'Select at least one server to import' });
  if (!ownerUserId) return res.status(422).json({ message: 'ownerUserId is required' });
  const owner = await prisma.user.findUnique({ where: { id: ownerUserId } });
  if (!owner) return res.status(422).json({ message: 'Owner user not found' });

  const job = await prisma.migrationJob.create({ data: { provider: 'pterodactyl' } });

  // Fire-and-forget, same posture as backups/webhooks — the job row is the
  // durable record the admin polls, this HTTP response doesn't wait on it.
  runPterodactylImport(job.id, ssh, selections, ownerUserId).catch((err) => {
    logger.error(`Pterodactyl import job ${job.id} crashed: ${(err as Error).message}`);
  });

  return res.status(201).json({ jobId: job.id });
});

router.get('/', async (_req: AuthRequest, res: Response) => {
  const jobs = await prisma.migrationJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  return res.json({ data: jobs.map((j) => ({ ...j, log: JSON.parse(j.log) })) });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const job = await prisma.migrationJob.findUnique({ where: { id: req.params.id } });
  if (!job) return res.status(404).json({ message: 'Job not found' });
  return res.json({ data: { ...job, log: JSON.parse(job.log) } });
});

export default router;
