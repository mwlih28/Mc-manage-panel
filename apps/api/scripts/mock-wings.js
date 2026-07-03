// Throwaway local stand-in for a real Wings daemon, used only to record a
// product-walkthrough demo video against a fully "live-looking" panel
// without needing an actual game server node. Not part of the shipped app.
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const tar = require('tar');
const { Server: SocketServer } = require('socket.io');

// Set MOCK_WINGS_PORT / MOCK_WINGS_SUFFIX to run a second instance standing
// in for a second node (e.g. to exercise cross-node migration locally).
const PORT = Number(process.env.MOCK_WINGS_PORT) || 8080;
const SUFFIX = process.env.MOCK_WINGS_SUFFIX || '';
const SERVER_UUID = process.env.DEMO_SERVER_UUID || '00000000-0000-0000-0000-000000000003';
const MEMORY_LIMIT = 1024 * 1024 * 1024; // 1024MB
const DATA_ROOT = path.join(__dirname, `.mock-wings-data${SUFFIX}`);
const BACKUPS_ROOT = path.join(__dirname, `.mock-wings-backups${SUFFIX}`);

// Seed a fake server directory so backup/restore has real files to work
// with — only for the primary (no-suffix) instance. A secondary instance
// standing in for a migration destination should start empty, like a real
// node's data dir does.
if (!SUFFIX) {
  const seedDir = path.join(DATA_ROOT, SERVER_UUID);
  fs.mkdirSync(path.join(seedDir, 'world'), { recursive: true });
  if (!fs.existsSync(path.join(seedDir, 'server.properties'))) {
    fs.writeFileSync(path.join(seedDir, 'server.properties'), 'motd=A Kretase-powered Paper server\n');
    fs.writeFileSync(path.join(seedDir, 'world', 'level.dat'), 'fake-level-data\n');
  }
}

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/servers/:uuid/backups', async (req, res) => {
  const { uuid } = req.params;
  const { backupUuid, ignoredFiles } = req.body;
  const root = path.join(DATA_ROOT, uuid);
  const backupDir = path.join(BACKUPS_ROOT, uuid);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `${backupUuid}.tar.gz`);
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(backupFile);
      const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.glob('**/*', { cwd: root, ignore: [...(ignoredFiles || []), '*.log'] });
      archive.finalize();
    });
    const stat = fs.statSync(backupFile);
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(backupFile));
    res.json({ size: stat.size, checksum: hash.digest('hex') });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/servers/:uuid/backups/:backupUuid/restore', async (req, res) => {
  const { uuid, backupUuid } = req.params;
  const root = path.join(DATA_ROOT, uuid);
  const backupFile = path.join(BACKUPS_ROOT, uuid, `${backupUuid}.tar.gz`);
  if (!fs.existsSync(backupFile)) return res.status(404).json({ message: 'Backup file not found' });
  try {
    await tar.extract({ file: backupFile, cwd: root });
    res.json({ message: 'Restored' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/servers/:uuid/backups/:backupUuid', (req, res) => {
  const { uuid, backupUuid } = req.params;
  const backupFile = path.join(BACKUPS_ROOT, uuid, `${backupUuid}.tar.gz`);
  if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
  res.status(204).send();
});

app.get('/api/servers/:uuid/backups/:backupUuid/download', (req, res) => {
  const { uuid, backupUuid } = req.params;
  const backupFile = path.join(BACKUPS_ROOT, uuid, `${backupUuid}.tar.gz`);
  if (!fs.existsSync(backupFile)) return res.status(404).json({ message: 'Backup file not found' });
  res.download(backupFile, `${backupUuid}.tar.gz`);
});

app.post('/api/servers/:uuid/backups/:backupUuid/upload', express.raw({ type: '*/*', limit: '10gb' }), async (req, res) => {
  const { uuid, backupUuid } = req.params;
  const backupDir = path.join(BACKUPS_ROOT, uuid);
  const root = path.join(DATA_ROOT, uuid);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(root, { recursive: true });
    const backupFile = path.join(backupDir, `${backupUuid}.tar.gz`);
    fs.writeFileSync(backupFile, req.body);
    await tar.extract({ file: backupFile, cwd: root });
    res.json({ message: 'Restored from upload' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/servers', (req, res) => {
  // Registering a server on this mock just means it's ready to receive a
  // restored backup — real Wings creates the data dir here too.
  if (req.body && req.body.uuid) fs.mkdirSync(path.join(DATA_ROOT, req.body.uuid), { recursive: true });
  res.json({ ok: true });
});
app.delete('/api/servers/:uuid', (req, res) => {
  fs.rmSync(path.join(DATA_ROOT, req.params.uuid), { recursive: true, force: true });
  res.json({ ok: true });
});
app.post('/api/servers/:uuid/power', (_req, res) => res.json({ ok: true }));
app.post('/api/servers/:uuid/command', (_req, res) => res.json({ ok: true }));
app.get('/api/servers/:uuid/status', (_req, res) => res.json({ status: 'offline' }));

app.post('/api/servers/:uuid/reinstall', (req, res) => {
  // Real Wings wipes the data dir and reinstalls the loader here — the mock
  // just recreates an empty dir so modpack install has somewhere to write.
  const { uuid } = req.params;
  const root = path.join(DATA_ROOT, uuid);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  res.json({ message: 'Reinstall initiated' });
});

app.post('/api/servers/:uuid/modpack/overrides', (req, res) => {
  const { uuid } = req.params;
  const { files } = req.body;
  const root = path.join(DATA_ROOT, uuid);
  fs.mkdirSync(root, { recursive: true });
  let written = 0;
  const failed = [];
  for (const f of files || []) {
    try {
      const target = path.join(root, f.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(f.contentBase64, 'base64'));
      written++;
    } catch (err) {
      failed.push({ path: f.path, error: err.message });
    }
  }
  res.json({ written, failed });
});

app.post('/api/servers/:uuid/modpack/mods', async (req, res) => {
  const { uuid } = req.params;
  const { mods } = req.body;
  const root = path.join(DATA_ROOT, uuid);
  fs.mkdirSync(root, { recursive: true });
  let installed = 0;
  const failed = [];
  for (const mod of mods || []) {
    try {
      const target = path.join(root, mod.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `mock jar for ${mod.url}`);
      installed++;
    } catch (err) {
      failed.push({ path: mod.path, error: err.message });
    }
  }
  res.json({ installed, failed });
});

app.get('/api/servers/:uuid/resources', (_req, res) => {
  res.json({ resources: currentResources() });
});

const now = Date.now();
const FILES_ROOT = [
  { name: 'plugins', mode: 'drwxr-xr-x', size: 4096, isFile: false, isDir: true, isSymlink: false, modifiedAt: new Date(now - 3600_000).toISOString() },
  { name: 'world', mode: 'drwxr-xr-x', size: 4096, isFile: false, isDir: true, isSymlink: false, modifiedAt: new Date(now - 1800_000).toISOString() },
  { name: 'logs', mode: 'drwxr-xr-x', size: 4096, isFile: false, isDir: true, isSymlink: false, modifiedAt: new Date(now - 60_000).toISOString() },
  { name: 'server.properties', mode: '-rw-r--r--', size: 1372, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 7200_000).toISOString() },
  { name: 'eula.txt', mode: '-rw-r--r--', size: 156, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 86_400_000).toISOString() },
  { name: 'server.jar', mode: '-rw-r--r--', size: 52_428_800, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 86_400_000).toISOString() },
  { name: 'whitelist.json', mode: '-rw-r--r--', size: 24, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 86_400_000).toISOString() },
];
const FILES_PLUGINS = [
  { name: 'Vault.jar', mode: '-rw-r--r--', size: 512_000, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 86_400_000).toISOString() },
  { name: 'LuckPerms.jar', mode: '-rw-r--r--', size: 3_145_728, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 86_400_000).toISOString() },
  { name: 'WorldEdit.jar', mode: '-rw-r--r--', size: 2_097_152, isFile: true, isDir: false, isSymlink: false, modifiedAt: new Date(now - 86_400_000).toISOString() },
];

app.get('/api/servers/:uuid/files', (req, res) => {
  const dir = String(req.query.directory || '/');
  res.json({ files: dir === '/plugins' ? FILES_PLUGINS : FILES_ROOT });
});

// CurseForge fingerprint (murmur2, seed 1, whitespace bytes stripped) —
// duplicated from apps/wings/src/utils/murmur2.ts since this mock is
// plain JS and doesn't share a build with the TS daemon.
function murmur2(data, seed) {
  const m = 0x5bd1e995;
  const r = 24;
  let len = data.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;
  while (len >= 4) {
    let k = (data[i] & 0xff) | ((data[i + 1] & 0xff) << 8) | ((data[i + 2] & 0xff) << 16) | ((data[i + 3] & 0xff) << 24);
    k = Math.imul(k, m) >>> 0;
    k ^= k >>> r;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h ^= k;
    i += 4; len -= 4;
  }
  if (len === 3) h ^= (data[i + 2] & 0xff) << 16;
  if (len >= 2) h ^= (data[i + 1] & 0xff) << 8;
  if (len >= 1) { h ^= (data[i] & 0xff); h = Math.imul(h, m) >>> 0; }
  h ^= h >>> 13;
  h = Math.imul(h, m) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}
function curseForgeFingerprint(buffer) {
  const filtered = Buffer.from([...buffer].filter((b) => b !== 9 && b !== 10 && b !== 13 && b !== 32));
  return murmur2(filtered, 1);
}

app.get('/api/servers/:uuid/files/hashes', (req, res) => {
  const { uuid } = req.params;
  const dir = String(req.query.directory || '/');
  const target = path.join(DATA_ROOT, uuid, dir);
  if (!fs.existsSync(target)) return res.json({ files: [] });
  const files = fs.readdirSync(target, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.jar'))
    .map((e) => {
      const buf = fs.readFileSync(path.join(target, e.name));
      return { name: e.name, size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex'), murmur2: curseForgeFingerprint(buf) };
    });
  res.json({ files });
});

app.get('/api/servers/:uuid/files/contents', (req, res) => {
  const file = String(req.query.file || '');
  if (file.endsWith('server.properties')) {
    return res.json({
      content:
        '#Minecraft server properties\nmotd=A Kretase-powered Paper server\ndifficulty=normal\ngamemode=survival\nmax-players=20\nonline-mode=true\nview-distance=10\nserver-port=25565\n',
    });
  }
  if (file.endsWith('eula.txt')) {
    return res.json({ content: '#By changing the setting below to TRUE you are indicating your agreement to our EULA\neula=true\n' });
  }
  res.json({ content: '' });
});

const ONLINE_PLAYERS = [
  { name: 'Steve_TR', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5' },
  { name: 'KretaseFan', uuid: 'ec561538-f3fd-461d-aff5-086b22154bce' },
];

app.get('/api/servers/:uuid/players', (_req, res) => {
  res.json({ players: ONLINE_PLAYERS, max: 20 });
});

// Sample NBT-shaped inventory for visually testing the inventory grid UI.
app.get('/api/servers/:uuid/players/:playerUuid/inventory', (_req, res) => {
  res.json({
    inventory: [
      { slot: 0, id: 'diamond_sword', count: 1 },
      { slot: 1, id: 'bow', count: 1 },
      { slot: 8, id: 'shield', count: 1 },
      { slot: 9, id: 'oak_planks', count: 64 },
      { slot: 10, id: 'cobblestone', count: 64 },
      { slot: 11, id: 'torch', count: 32 },
      { slot: 12, id: 'cooked_beef', count: 12 },
      { slot: 13, id: 'golden_apple', count: 3 },
      { slot: 14, id: 'ender_pearl', count: 6 },
      { slot: 20, id: 'diamond', count: 5 },
      { slot: 21, id: 'emerald', count: 2 },
      { slot: 27, id: 'enchanted_book', count: 1 },
      { slot: 28, id: 'potion', count: 2 },
      { slot: 36, id: 'netherite_boots', count: 1 },
      { slot: 37, id: 'diamond_leggings', count: 1 },
      { slot: 38, id: 'iron_chestplate', count: 1 },
      { slot: 39, id: 'netherite_helmet', count: 1 },
    ],
    enderChest: [
      { slot: 0, id: 'shulker_box', count: 1 },
      { slot: 1, id: 'totem_of_undying', count: 1 },
      { slot: 5, id: 'nether_star', count: 1 },
    ],
  });
});

app.get('/api/servers/:uuid/players/leaderboard', (req, res) => {
  const { uuid } = req.params;
  const dataPath = path.join(DATA_ROOT, uuid);
  const statsDir = path.join(dataPath, 'world', 'stats');
  if (!fs.existsSync(statsDir)) return res.json({ players: [] });

  const usercachePath = path.join(dataPath, 'usercache.json');
  const nameByUuid = new Map();
  if (fs.existsSync(usercachePath)) {
    try {
      for (const entry of JSON.parse(fs.readFileSync(usercachePath, 'utf8'))) nameByUuid.set(entry.uuid, entry.name);
    } catch { /* ignore */ }
  }

  const files = fs.readdirSync(statsDir).filter((f) => f.endsWith('.json'));
  const players = files.map((file) => {
    const playerUuid = file.replace(/\.json$/, '');
    let stats = { playTimeTicks: 0, deaths: 0, walkOneCm: 0, sprintOneCm: 0, jumps: 0, playerKills: 0, mobKills: 0, blocksMinedTotal: 0 };
    try {
      const data = JSON.parse(fs.readFileSync(path.join(statsDir, file), 'utf8'));
      const custom = data?.stats?.['minecraft:custom'] ?? {};
      const mined = data?.stats?.['minecraft:mined'] ?? {};
      stats = {
        playTimeTicks: custom['minecraft:play_time'] ?? 0,
        deaths: custom['minecraft:deaths'] ?? 0,
        walkOneCm: custom['minecraft:walk_one_cm'] ?? 0,
        sprintOneCm: custom['minecraft:sprint_one_cm'] ?? 0,
        jumps: custom['minecraft:jump'] ?? 0,
        playerKills: custom['minecraft:player_kills'] ?? 0,
        mobKills: custom['minecraft:mob_kills'] ?? 0,
        blocksMinedTotal: Object.values(mined).reduce((a, v) => a + v, 0),
      };
    } catch { /* ignore malformed file */ }
    return { uuid: playerUuid, name: nameByUuid.get(playerUuid) || playerUuid.slice(0, 8), ...stats };
  });
  res.json({ players });
});

app.get('/api/servers/:uuid/players/all', (_req, res) => {
  res.json({
    players: ONLINE_PLAYERS.map((p, i) => ({
      name: p.name,
      uuid: p.uuid,
      firstSeen: new Date(now - 30 * 86_400_000 + i * 3_600_000).toISOString(),
      lastSeen: new Date(now - i * 600_000).toISOString(),
      joinCount: 14 + i * 6,
      online: true,
    })),
    count: ONLINE_PLAYERS.length,
  });
});

let startedAt = Date.now();
// Set MOCK_HIGH_CPU=1 to simulate a lag spike for testing the panel's
// auto-optimize trigger without needing a real overloaded container.
function currentResources() {
  const t = (Date.now() - startedAt) / 1000;
  const cpu = process.env.MOCK_HIGH_CPU ? 95 : 14 + Math.abs(Math.sin(t / 6)) * 18;
  const mem = MEMORY_LIMIT * (0.42 + Math.abs(Math.sin(t / 15)) * 0.15);
  return {
    cpu_absolute: Number(cpu.toFixed(1)),
    memory_bytes: Math.round(mem),
    memory_limit_bytes: MEMORY_LIMIT,
    disk_bytes: 1_288_490_188,
    network_rx_bytes: Math.round(t * 4200),
    network_tx_bytes: Math.round(t * 1800),
    uptime: Math.round(t * 1000),
    state: 'running',
  };
}

const httpServer = http.createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });

const CONSOLE_SCRIPT = [
  '[Server thread/INFO]: Starting minecraft server version 1.21.4',
  '[Server thread/INFO]: Loading properties',
  '[Server thread/INFO]: Default game type: SURVIVAL',
  '[Server thread/INFO]: Generating keypair',
  '[Server thread/INFO]: Starting Minecraft server on *:25565',
  '[Server thread/INFO]: Using epoll channel type',
  '[Server thread/INFO]: Paper: Using Aikar\'s flags — G1GC tuned for low pause times',
  '[Server thread/INFO]: Preparing level "world"',
  '[Server thread/INFO]: Preparing start region for dimension minecraft:overworld',
  '[Server thread/INFO]: Time elapsed: 1743 ms',
  '[Server thread/INFO]: Done (2.874s)! For help, type "help"',
  '[Server thread/INFO]: Steve_TR joined the game',
  '[Server thread/INFO]: KretaseFan joined the game',
  '[Server thread/INFO]: <Steve_TR> panel gerçekten hızlı çalışıyor',
  '[Server thread/INFO]: [Steve_TR: Teleported Steve_TR to 120.5, 64.0, -32.5]',
  '[Server thread/INFO]: TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0',
  '[Server thread/INFO]: <KretaseFan> tps stabil, hic lag yok',
  '[Server thread/INFO]: Saved the game',
  '[Server thread/INFO]: TPS from last 1m, 5m, 15m: 20.0, 19.98, 20.0',
  '[Server thread/INFO]: Steve_TR lost connection: Disconnected',
  '[Server thread/INFO]: Steve_TR joined the game',
];

io.use((socket, next) => {
  // Any bearer token is accepted — this is a throwaway local mock, not a real daemon.
  void socket.handshake.auth?.token;
  next();
});

io.on('connection', (socket) => {
  console.log('[mock-wings] panel relay connected');
  let statsTimer = null;
  let consoleTimer = null;

  socket.on('subscribe', (uuid) => {
    console.log('[mock-wings] subscribed to', uuid);
    socket.emit('server:status', { uuid, state: 'running' });

    let i = 0;
    if (consoleTimer) clearInterval(consoleTimer);
    consoleTimer = setInterval(() => {
      const line = CONSOLE_SCRIPT[i % CONSOLE_SCRIPT.length];
      socket.emit('server:console', { uuid, type: 'output', data: `[16:${String(32 + i).padStart(2, '0')}:${String(i * 7 % 60).padStart(2, '0')} ${line}`, timestamp: Date.now() });
      i++;
    }, 1200);

    if (statsTimer) clearInterval(statsTimer);
    statsTimer = setInterval(() => {
      const r = currentResources();
      socket.emit('server:stats', {
        uuid,
        cpu_absolute: r.cpu_absolute,
        memory_bytes: r.memory_bytes,
        memory_limit_bytes: r.memory_limit_bytes,
        disk_bytes: r.disk_bytes,
        network_rx_bytes: r.network_rx_bytes,
        network_tx_bytes: r.network_tx_bytes,
        uptime: r.uptime,
      });
    }, 2000);
  });

  socket.on('command', ({ uuid, command }) => {
    socket.emit('server:console', { uuid, type: 'output', data: `[Server thread/INFO]: [${command}] executed successfully`, timestamp: Date.now() });
  });

  socket.on('power', ({ uuid, action }) => {
    socket.emit('server:status', { uuid, state: action === 'stop' || action === 'kill' ? 'offline' : 'running' });
  });

  socket.on('disconnect', () => {
    clearInterval(statsTimer);
    clearInterval(consoleTimer);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[mock-wings] listening on :${PORT}`);
});
