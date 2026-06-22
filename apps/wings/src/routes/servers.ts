import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { serverManager } from '../services/serverManager';
import { logger } from '../utils/logger';
import { getConfig } from '../config';
import { pingServer } from '../services/mcPing';
import type { ServerConfig } from '../types';

const execFileAsync = promisify(execFile);

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

// Get online players via Minecraft Server List Ping
router.get('/:uuid/players', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const env = serverManager.getServerEnvironment(uuid);
  const port = parseInt(env['SERVER_PORT'] || env['PORT'] || '25565', 10);
  try {
    const result = await pingServer('127.0.0.1', port, 4000);
    return res.json(result);
  } catch {
    return res.json({ online: 0, max: 0, players: [] });
  }
});

// Install a plugin/mod by downloading from a URL
router.post('/:uuid/plugins/install', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { url, filename, type } = req.body as { url: string; filename: string; type: string };

  if (!url || !filename || !['plugins', 'mods'].includes(type)) {
    return res.status(422).json({ message: 'url, filename, and type (plugins|mods) required' });
  }

  if (!url.startsWith('https://')) {
    return res.status(422).json({ message: 'Only HTTPS URLs are allowed' });
  }

  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeFilename.endsWith('.jar')) {
    return res.status(422).json({ message: 'Only .jar files are supported' });
  }

  const cfg = getConfig();
  const expectedBase = path.resolve(path.join(cfg.system.data, uuid));
  const targetDir = path.resolve(path.join(expectedBase, type));
  if (!targetDir.startsWith(expectedBase)) {
    return res.status(403).json({ message: 'Forbidden path' });
  }

  // Download to a temporary directory, then copy into the container via docker cp.
  // Wings runs as a non-root user (mcwings) that cannot write to the volume dirs
  // owned by uid 1000. docker cp goes through the Docker daemon (root), bypassing
  // this restriction and working on both running and stopped containers.
  const tmpDir = path.join(os.tmpdir(), `mc_install_${Date.now()}_${uuid}`);
  const tmpFile = path.join(tmpDir, safeFilename);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    const response = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: 100 * 1024 * 1024,
    });

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tmpFile);
      (response.data as NodeJS.ReadableStream).pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const containerName = `mc_${uuid}`;

    // Ensure target dir exists inside the container (only works if running; ignore failure)
    await execFileAsync('docker', ['exec', containerName, 'mkdir', '-p', `/home/container/${type}`]).catch(() => {});

    // Copy the temp directory's contents into the container.
    // Using srcDir/ → destDir creates the destination directory if it doesn't exist,
    // and works on stopped containers (Docker daemon handles the copy as root).
    try {
      await execFileAsync('docker', ['cp', tmpDir + '/', `${containerName}:/home/container/${type}`]);
      logger.info(`Plugin installed via docker cp: ${safeFilename}`);
      return res.json({ message: `${safeFilename} installed successfully` });
    } catch {
      // Container doesn't exist yet (never started) — write via a helper container
      // that mounts the volume as root and can set correct ownership.
      const dataPath = path.join(cfg.system.data, uuid);
      await execFileAsync('docker', [
        'run', '--rm',
        '-v', `${dataPath}:/vol`,
        '-v', `${tmpDir}:/src:ro`,
        'alpine',
        'sh', '-c',
        `mkdir -p /vol/${type} && cp /src/${safeFilename} /vol/${type}/${safeFilename} && chown 1000:1000 /vol/${type}/${safeFilename}`,
      ]);
      logger.info(`Plugin installed via helper container: ${safeFilename}`);
      return res.json({ message: `${safeFilename} installed successfully` });
    }
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

export default router;
