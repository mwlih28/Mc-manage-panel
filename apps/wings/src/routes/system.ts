import { Router, Request, Response } from 'express';
import si from 'systeminformation';
import { getConfig } from '../config';
import { serverManager } from '../services/serverManager';

const router = Router();

// Heartbeat / health
router.get('/health', async (_req: Request, res: Response) => {
  const cfg = getConfig();
  return res.json({
    status: 'ok',
    version: '1.0.0',
    uuid: cfg.uuid,
    timestamp: new Date().toISOString(),
  });
});

// System info
router.get('/system', async (_req: Request, res: Response) => {
  const [cpu, mem, disk, os] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
  ]);

  return res.json({
    cpu: {
      model: (await si.cpu()).brand,
      cores: (await si.cpu()).cores,
      usage: parseFloat(cpu.currentLoad.toFixed(2)),
    },
    memory: {
      total: mem.total,
      used: mem.active,
      free: mem.free,
    },
    disk: disk.map(d => ({
      fs: d.fs,
      size: d.size,
      used: d.used,
      available: d.available,
      mount: d.mount,
    })),
    os: {
      platform: os.platform,
      distro: os.distro,
      release: os.release,
      hostname: os.hostname,
    },
  });
});

// List servers managed by this daemon
router.get('/servers', (_req: Request, res: Response) => {
  const servers = serverManager.getServerList();
  return res.json({ servers });
});

export default router;
