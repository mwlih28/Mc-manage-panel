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

  // The filesystem that actually matters is the one server data lives on,
  // not necessarily "/" — pick the disk entry whose mount point is the
  // longest matching prefix of the configured data root (same resolution
  // `df <path>` would give you).
  const dataRoot = getConfig().system.data;
  const primary = disk
    .filter(d => dataRoot === d.mount || dataRoot.startsWith(d.mount.endsWith('/') ? d.mount : `${d.mount}/`) || d.mount === '/')
    .sort((a, b) => b.mount.length - a.mount.length)[0];

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
    // Convenience summary of the disk that holds server data — this is what
    // the panel's disk-usage alerting reads, so it doesn't need to know how
    // to pick a filesystem out of the raw list above.
    primaryDisk: primary ? {
      mount: primary.mount,
      size: primary.size,
      used: primary.used,
      available: primary.available,
      usedPercent: primary.size > 0 ? Math.round((primary.used / primary.size) * 1000) / 10 : 0,
    } : null,
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
