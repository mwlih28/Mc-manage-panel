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
import { readPlayerDat, readPlayerLocation, readPlayerStats, removeInventoryItem } from '../services/nbtReader';
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

// Reinstall server — body may contain ServerConfig from the panel
router.post('/:uuid/reinstall', async (req: Request, res: Response) => {
  const externalConfig: ServerConfig | undefined = req.body?.uuid ? req.body as ServerConfig : undefined;
  serverManager.reinstallServer(req.params.uuid, externalConfig)
    .catch(err => logger.error(`Reinstall failed for ${req.params.uuid}: ${err.message}`));
  return res.json({ message: 'Reinstall initiated' });
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

// Get online players via log-based session tracking
router.get('/:uuid/players', (req: Request, res: Response) => {
  const players = serverManager.getOnlinePlayers(req.params.uuid);
  return res.json({ players, count: players.length });
});

// Get ALL players who ever joined (history + usercache.json)
router.get('/:uuid/players/all', (req: Request, res: Response) => {
  const { uuid } = req.params;
  const cfg = getConfig();
  const dataPath = path.join(cfg.system.data, uuid);
  const history = serverManager.getAllPlayerHistory(uuid);
  const historyMap = new Map(history.map(e => [e.name, e]));

  // Merge usercache.json so we also surface players who joined before this process started
  const usercachePath = path.join(dataPath, 'usercache.json');
  if (fs.existsSync(usercachePath)) {
    try {
      const cache: { name: string; uuid: string }[] = JSON.parse(fs.readFileSync(usercachePath, 'utf8'));
      for (const entry of cache) {
        if (!historyMap.has(entry.name)) {
          historyMap.set(entry.name, {
            name: entry.name, uuid: entry.uuid,
            firstSeen: new Date(0), lastSeen: new Date(0),
            joinCount: 0, online: false,
          });
        } else {
          const e = historyMap.get(entry.name)!;
          if (!e.uuid) e.uuid = entry.uuid;
        }
      }
    } catch { /* ignore */ }
  }

  // Final pass: mark currently-online players (handles case where usercache added them without online flag)
  const onlineNow = serverManager.getOnlinePlayers(uuid);
  for (const op of onlineNow) {
    const entry = historyMap.get(op.name);
    if (entry) {
      entry.online = true;
      if (!entry.uuid && op.uuid) entry.uuid = op.uuid;
    } else {
      historyMap.set(op.name, { name: op.name, uuid: op.uuid, firstSeen: new Date(0), lastSeen: new Date(), joinCount: 0, online: true });
    }
  }

  const players = [...historyMap.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  return res.json({ players, count: players.length });
});

// Get full player details: stats, location, inventory, ban status
router.get('/:uuid/players/:playerUuid/details', (req: Request, res: Response) => {
  const { uuid, playerUuid } = req.params;
  const cfg = getConfig();
  const dataPath = path.join(cfg.system.data, uuid);
  const datFile = path.join(dataPath, 'world', 'playerdata', `${playerUuid}.dat`);
  const statsFile = path.join(dataPath, 'world', 'stats', `${playerUuid}.json`);

  const stats    = readPlayerStats(statsFile);
  const location = readPlayerLocation(datFile);
  const inv      = readPlayerDat(datFile);

  let ban: { banned: boolean; reason: string; expires: string; bannedBy: string } | null = null;
  const bannedPath = path.join(dataPath, 'banned-players.json');
  if (fs.existsSync(bannedPath)) {
    try {
      const bans: Array<{ uuid: string; source: string; expires: string; reason: string }> = JSON.parse(fs.readFileSync(bannedPath, 'utf8'));
      const entry = bans.find(b => b.uuid === playerUuid);
      if (entry) ban = { banned: true, reason: entry.reason, expires: entry.expires, bannedBy: entry.source };
    } catch { /* ignore */ }
  }

  return res.json({ stats, location, inventory: inv.inventory, enderChest: inv.enderChest, ban });
});

// Ban a player
router.post('/:uuid/players/:playerUuid/ban', async (req: Request, res: Response) => {
  const { uuid, playerUuid } = req.params;
  const { reason = 'Banned by admin', name } = req.body as { reason?: string; name?: string };
  const cfg = getConfig();
  const dataPath = path.join(cfg.system.data, uuid);
  const bannedPath = path.join(dataPath, 'banned-players.json');

  let bans: Array<{ uuid: string; name: string; created: string; source: string; expires: string; reason: string }> = [];
  if (fs.existsSync(bannedPath)) {
    try { bans = JSON.parse(fs.readFileSync(bannedPath, 'utf8')); } catch { /* ignore */ }
  }
  bans = bans.filter(b => b.uuid !== playerUuid);
  bans.push({
    uuid: playerUuid, name: name || 'Unknown',
    created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000',
    source: 'Kretase', expires: 'forever', reason,
  });
  fs.writeFileSync(bannedPath, JSON.stringify(bans, null, 2));
  if (name && serverManager.getStatus(uuid) === 'running') {
    await serverManager.sendCommand(uuid, `ban ${name} ${reason}`).catch(() => {});
  }
  return res.json({ message: 'Player banned' });
});

// Unban a player
router.delete('/:uuid/players/:playerUuid/ban', (req: Request, res: Response) => {
  const { uuid, playerUuid } = req.params;
  const { name } = req.query as { name?: string };
  const cfg = getConfig();
  const bannedPath = path.join(cfg.system.data, uuid, 'banned-players.json');
  if (!fs.existsSync(bannedPath)) return res.json({ message: 'Not banned' });
  try {
    const bans: Array<{ uuid: string }> = JSON.parse(fs.readFileSync(bannedPath, 'utf8'));
    fs.writeFileSync(bannedPath, JSON.stringify(bans.filter(b => b.uuid !== playerUuid), null, 2));
    if (name && serverManager.getStatus(uuid) === 'running') {
      serverManager.sendCommand(uuid, `pardon ${name}`).catch(() => {});
    }
    return res.json({ message: 'Player unbanned' });
  } catch { return res.status(500).json({ message: 'Failed to unban' }); }
});

// Kick a player (must be online)
router.post('/:uuid/players/:playerUuid/kick', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { name, reason = 'Kicked by admin' } = req.body as { name: string; reason?: string };
  if (!name) return res.status(422).json({ message: 'Player name required' });
  if (serverManager.getStatus(uuid) !== 'running') return res.status(400).json({ message: 'Server not running' });
  await serverManager.sendCommand(uuid, `kick ${name} ${reason}`);
  return res.json({ message: `${name} kicked` });
});

// IP ban
router.post('/:uuid/players/:playerUuid/ipban', (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { name, ip, reason = 'IP banned by admin' } = req.body as { name?: string; ip?: string; reason?: string };
  const cfg = getConfig();
  const dataPath = path.join(cfg.system.data, uuid);
  if (ip) {
    const ipBanPath = path.join(dataPath, 'banned-ips.json');
    let bans: Array<{ ip: string; created: string; source: string; expires: string; reason: string }> = [];
    if (fs.existsSync(ipBanPath)) {
      try { bans = JSON.parse(fs.readFileSync(ipBanPath, 'utf8')); } catch { /* ignore */ }
    }
    bans = bans.filter(b => b.ip !== ip);
    bans.push({ ip, created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000', source: 'Kretase', expires: 'forever', reason });
    fs.writeFileSync(ipBanPath, JSON.stringify(bans, null, 2));
  }
  if (name && serverManager.getStatus(uuid) === 'running') {
    serverManager.sendCommand(uuid, `ban-ip ${name} ${reason}`).catch(() => {});
  }
  return res.json({ message: 'IP banned' });
});

// Delete inventory item (NBT edit)
router.delete('/:uuid/players/:playerUuid/inventory/:slot', (req: Request, res: Response) => {
  const { uuid, playerUuid } = req.params;
  const slot = parseInt(req.params.slot);
  const fromEnderChest = req.query.from === 'ender';
  const cfg = getConfig();
  const datFile = path.join(cfg.system.data, uuid, 'world', 'playerdata', `${playerUuid}.dat`);
  const removed = removeInventoryItem(datFile, slot, fromEnderChest);
  if (!removed) return res.status(404).json({ message: 'Item not found at slot' });
  return res.json({ message: 'Item removed' });
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

    // Copy the specific file (not the directory) to avoid trailing-slash ambiguity.
    // docker cp works on both running and stopped containers via the Docker daemon (root).
    try {
      await execFileAsync('docker', ['cp', tmpFile, `${containerName}:/home/container/${type}/${safeFilename}`]);
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

// PaperMC's old api.papermc.io/v2 was sunset (HTTP 410 as of mid-2026). The
// new API lives at fill.papermc.io/v3, returns different shapes, and
// requires a real, identifying User-Agent header or requests get rejected.
const PAPER_API_BASE = 'https://fill.papermc.io/v3/projects/paper';
const PAPER_USER_AGENT = 'Kretase-Wings/1.0 (+https://kretase.com)';

// GET /api/servers/:uuid/versions — list Paper MC versions
router.get('/:uuid/versions', async (_req: Request, res: Response) => {
  try {
    const { data } = await axios.get(PAPER_API_BASE, { timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT } });
    const versions: string[] = Object.values(data.versions as Record<string, string[]>).flat();
    return res.json({ versions });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch Paper versions' });
  }
});

// GET /api/servers/:uuid/versions/:version/builds
router.get('/:uuid/versions/:version/builds', async (req: Request, res: Response) => {
  const { version } = req.params;
  try {
    const { data } = await axios.get(`${PAPER_API_BASE}/versions/${version}/builds`, {
      timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT },
    });
    const builds: number[] = (data as { id: number }[]).map((b) => b.id);
    return res.json({ builds, latestBuild: builds[0] });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch builds' });
  }
});

// POST /api/servers/:uuid/version — download and install specific Paper version
router.post('/:uuid/version', async (req: Request, res: Response) => {
  const { uuid } = req.params;
  const { version, build } = req.body as { version: string; build?: number };
  if (!version) return res.status(422).json({ message: 'version required' });

  const cfg = getConfig();
  const dataPath = path.join(cfg.system.data, uuid);
  const tmpDir = path.join(os.tmpdir(), `mc_ver_${Date.now()}_${uuid}`);
  const tmpFile = path.join(tmpDir, 'paper.jar');

  try {
    const buildPath = build ? String(build) : 'latest';
    const { data: buildData } = await axios.get(
      `${PAPER_API_BASE}/versions/${version}/builds/${buildPath}`,
      { timeout: 15000, headers: { 'User-Agent': PAPER_USER_AGENT } }
    );
    const downloadUrl: string | undefined = buildData.downloads?.['server:default']?.url;
    if (!downloadUrl) throw new Error(`No download URL for Paper ${version} build ${buildPath}`);
    const targetBuild = buildData.id as number;

    logger.info(`Downloading Paper ${version}-${targetBuild} for ${uuid}`);

    fs.mkdirSync(tmpDir, { recursive: true });
    const response = await axios.get<NodeJS.ReadableStream>(downloadUrl, {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
      headers: { 'User-Agent': PAPER_USER_AGENT },
    });
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tmpFile);
      (response.data as NodeJS.ReadableStream).pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const containerName = `mc_${uuid}`;
    try {
      await execFileAsync('docker', ['cp', tmpFile, `${containerName}:/home/container/server.jar`]);
      await execFileAsync('docker', ['exec', containerName, 'chown', '1000:1000', '/home/container/server.jar']).catch(() => {});
    } catch {
      await execFileAsync('docker', [
        'run', '--rm',
        '-v', `${dataPath}:/vol`,
        '-v', `${tmpDir}:/src:ro`,
        'alpine', 'sh', '-c',
        'cp /src/paper.jar /vol/server.jar && chown 1000:1000 /vol/server.jar && chmod 666 /vol/server.jar',
      ]);
    }

    logger.info(`Paper ${version}-${targetBuild} installed for ${uuid}`);
    return res.json({ message: `Paper ${version} build ${targetBuild} installed`, version, build: targetBuild });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Get player inventory / ender chest (NBT reader)
router.get('/:uuid/players/:playerUuid/inventory', (req: Request, res: Response) => {
  const { uuid, playerUuid } = req.params;
  const cfg = getConfig();
  const dataPath = path.join(cfg.system.data, uuid);
  try {
    const result = readPlayerDat(path.join(dataPath, 'world', 'playerdata', `${playerUuid}.dat`));
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
});

export default router;
