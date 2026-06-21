import { Router, Request, Response } from 'express';
import { serverManager } from '../services/serverManager';
import { logger } from '../utils/logger';
import type { ServerConfig } from '../types';

const router = Router();

// Load/register a server
router.post('/', async (req: Request, res: Response) => {
  const config: ServerConfig = req.body;
  try {
    await serverManager.loadServer(config);
    return res.status(201).json({ message: 'Server loaded' });
  } catch (err) {
    logger.error('Failed to load server:', err);
    return res.status(500).json({ message: (err as Error).message });
  }
});

// Power action
router.post('/:uuid/power', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { action } = req.body;

  if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
    return res.status(422).json({ message: 'Invalid action' });
  }

  try {
    switch (action) {
      case 'start':
        serverManager.startServer(uuid).catch(err => logger.error(`Start failed: ${err.message}`));
        break;
      case 'stop':
        serverManager.stopServer(uuid).catch(err => logger.error(`Stop failed: ${err.message}`));
        break;
      case 'restart':
        serverManager.restartServer(uuid).catch(err => logger.error(`Restart failed: ${err.message}`));
        break;
      case 'kill':
        serverManager.killServer(uuid).catch(err => logger.error(`Kill failed: ${err.message}`));
        break;
    }
    return res.json({ message: `${action} initiated` });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

// Send command
router.post('/:uuid/command', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { command } = req.body;

  if (!command) return res.status(422).json({ message: 'Command required' });

  await serverManager.sendCommand(uuid, command);
  return res.json({ message: 'Command sent' });
});

// Get resources/stats
router.get('/:uuid/resources', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const resources = await serverManager.getResources(uuid);
  return res.json({ resources });
});

// Get status
router.get('/:uuid/status', (req: Request, res: Response) => {
  const status = serverManager.getStatus(req.params.uuid);
  return res.json({ status });
});

// Delete server
router.delete('/:uuid', async (req: Request, res: Response) => {
  try {
    await serverManager.deleteServer(req.params.uuid);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

export default router;
