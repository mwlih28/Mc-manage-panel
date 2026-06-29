import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Server as SocketServer } from 'socket.io';
import cron from 'node-cron';

import { loadConfig } from './config';
import { logger } from './utils/logger';
import { ensureNetwork } from './services/dockerService';
import { serverManager } from './services/serverManager';
import { panelClient } from './services/panelClient';

import serverRoutes from './routes/servers';
import fileRoutes from './routes/files';
import systemRoutes from './routes/system';

async function main() {
  // Load config
  let cfg: ReturnType<typeof loadConfig>;
  try {
    cfg = loadConfig();
  } catch (err) {
    logger.error((err as Error).message);
    logger.error('Please run: mc-wings configure --panel-url=https://your-panel.com --token=YOUR_TOKEN');
    process.exit(1);
  }

  const app = express();
  const httpServer = http.createServer(app);

  // --- Token auth middleware ---
  app.use((req, res, next) => {
    if (req.path === '/health' || req.path === '/api/health') return next();
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || token !== cfg.token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    next();
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));

  // --- Routes ---
  app.use('/api/servers', serverRoutes);
  app.use('/api/servers/:uuid/files', fileRoutes);
  app.use('/api', systemRoutes);

  // --- Socket.io for console/stats streaming ---
  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });

  serverManager.setSocketServer(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    // Accept panel token OR client JWT (panel proxies with its own token)
    if (token === cfg.token || token?.startsWith('eyJ')) {
      return next();
    }
    next(new Error('Unauthorized'));
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('subscribe', (uuid: string) => {
      socket.join(`server:${uuid}`);
      const status = serverManager.getStatus(uuid);
      socket.emit('server:status', { state: status });
      // Replay buffered log lines so clients recover history after reconnect.
      // Include uuid so the relay can route to the correct server room.
      const history = serverManager.getLogBuffer(uuid);
      if (history.length > 0) {
        socket.emit('server:console:history', {
          uuid,
          lines: history.map((data) => ({ type: 'output' as const, data, timestamp: Date.now() })),
        });
      }
    });

    socket.on('unsubscribe', (uuid: string) => {
      socket.leave(`server:${uuid}`);
    });

    socket.on('power', async ({ uuid, action }: { uuid: string; action: string }) => {
      // Auto-load server from panel if Wings doesn't know about it yet
      if (!serverManager.getServerList().includes(uuid)) {
        try {
          const servers = await panelClient.getServers();
          const cfg = servers.find(s => s.uuid === uuid);
          if (cfg) {
            await serverManager.loadServer(cfg);
            logger.info(`Auto-loaded server ${uuid} from panel`);
          } else {
            logger.warn(`Server ${uuid} not found on panel, cannot start`);
            return;
          }
        } catch (err) {
          logger.warn(`Failed to auto-load server ${uuid}: ${(err as Error).message}`);
          return;
        }
      }
      switch (action) {
        case 'start': await serverManager.startServer(uuid).catch(err => logger.error(err)); break;
        case 'stop': await serverManager.stopServer(uuid).catch(err => logger.error(err)); break;
        case 'restart': await serverManager.restartServer(uuid).catch(err => logger.error(err)); break;
        case 'kill': await serverManager.killServer(uuid).catch(err => logger.error(err)); break;
      }
    });

    socket.on('command', async ({ uuid, command }: { uuid: string; command: string }) => {
      await serverManager.sendCommand(uuid, command);
    });

    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${socket.id}`));
  });

  // --- Ensure Docker network ---
  await ensureNetwork();

  // --- Pull servers from Panel ---
  try {
    logger.info(`Connecting to panel: ${cfg.remote}`);
    const servers = await panelClient.getServers();
    logger.info(`Loading ${servers.length} server(s) from panel...`);
    for (const server of servers) {
      await serverManager.loadServer(server).catch(err =>
        logger.warn(`Failed to load server ${server.uuid}: ${err.message}`)
      );
    }
  } catch (err) {
    logger.warn(`Could not connect to panel: ${(err as Error).message}`);
    logger.warn('Wings will run without panel sync. Check panel URL and token.');
  }

  // --- Heartbeat to panel every 30s ---
  cron.schedule('*/30 * * * * *', async () => {
    import('systeminformation').then(async (si) => {
      const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
      await panelClient.reportHeartbeat({
        cpu: parseFloat(cpu.currentLoad.toFixed(2)),
        memory: Math.round((mem.active / mem.total) * 100),
        disk: 0,
      }).catch(() => {});
    });
  });

  // --- Start server ---
  const port = cfg.api.port || 8080;
  const host = cfg.api.host || '0.0.0.0';

  httpServer.listen(port, host, () => {
    logger.info('================================================');
    logger.info('  Kretase - Wings Daemon');
    logger.info(`  Listening: ${host}:${port}`);
    logger.info(`  Panel: ${cfg.remote}`);
    logger.info(`  Node UUID: ${cfg.uuid}`);
    logger.info('================================================');
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    process.exit(0);
  });
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
