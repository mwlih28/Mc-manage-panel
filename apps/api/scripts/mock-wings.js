// Throwaway local stand-in for a real Wings daemon, used only to record a
// product-walkthrough demo video against a fully "live-looking" panel
// without needing an actual game server node. Not part of the shipped app.
const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');

const PORT = 8080;
const SERVER_UUID = process.env.DEMO_SERVER_UUID || '00000000-0000-0000-0000-000000000003';
const MEMORY_LIMIT = 1024 * 1024 * 1024; // 1024MB

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/servers', (_req, res) => res.json({ ok: true }));
app.delete('/api/servers/:uuid', (_req, res) => res.json({ ok: true }));
app.post('/api/servers/:uuid/power', (_req, res) => res.json({ ok: true }));
app.post('/api/servers/:uuid/command', (_req, res) => res.json({ ok: true }));

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
function currentResources() {
  const t = (Date.now() - startedAt) / 1000;
  const cpu = 14 + Math.abs(Math.sin(t / 6)) * 18;
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
