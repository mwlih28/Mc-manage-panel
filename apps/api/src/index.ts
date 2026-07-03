import 'dotenv/config';

// Fail fast on missing required env vars — better to crash on startup than silently use weak defaults
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Required environment variable "${key}" is not set. Exiting.`);
    process.exit(1);
  }
}

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import compression from 'compression';

// Prisma returns BigInt for Backup.bytes (needed since real backup sizes can
// exceed a 32-bit int), but JSON.stringify throws on BigInt by default —
// res.json() would 500 on every response containing a backup. Real-world
// backup sizes never come close to Number.MAX_SAFE_INTEGER (9 PB).
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

import { logger } from './utils/logger';
import { errorHandler, notFound } from './middleware/errorHandler';
import { initSocketServer } from './services/socketService';
import { startScheduler } from './services/scheduler';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import serverRoutes from './routes/servers';
import nodeRoutes from './routes/nodes';
import eggRoutes from './routes/eggs';
import backupRoutes from './routes/backups';
import statsRoutes from './routes/stats';
import wingsRoutes from './routes/wings';
import settingsRoutes from './routes/settings';
import installerRoutes from './routes/installer';
import aiRoutes from './routes/ai';
import curseforgeRoutes from './routes/curseforge';
import modrinthRoutes from './routes/modrinth';
import publicRoutes from './routes/public';

const app = express();
const httpServer = http.createServer(app);

const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Security & middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: process.env.PANEL_VERSION || '1.0.0', timestamp: new Date().toISOString() });
});

// Templates endpoint
import serverTemplates from './data/serverTemplates.json';
import { fetchPaperVersions } from './services/paperApi';
import { authenticate as requireAuth } from './middleware/auth';

// API routes
const api = express.Router();
api.use('/auth', authRoutes);
api.use('/users', userRoutes);
api.use('/servers', serverRoutes);
api.get('/templates', (_req, res) => res.json({ data: serverTemplates }));
// Server-independent Paper version lookup, used by the Create Server modal
// before a server (and therefore a Wings proxy target) exists yet.
api.get('/paper/versions', requireAuth, async (_req, res) => {
  try {
    const versions = await fetchPaperVersions();
    return res.json({ versions });
  } catch {
    return res.status(502).json({ message: 'Failed to fetch Paper versions' });
  }
});
api.use('/servers/:serverId/backups', backupRoutes);
api.use('/nodes', nodeRoutes);
api.use('/eggs', eggRoutes);
api.use('/stats', statsRoutes);
api.use('/wings', wingsRoutes);
api.use('/settings', settingsRoutes);
api.use('/installer', installerRoutes);
api.use('/ai', aiRoutes);
api.use('/curseforge', curseforgeRoutes);
api.use('/modrinth', modrinthRoutes);
api.use('/public', publicRoutes);

app.use('/api/v1', api);

// Socket.io
const io = initSocketServer(httpServer, CORS_ORIGIN);
app.set('io', io);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`Kretase API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`CORS Origin: ${CORS_ORIGIN}`);
  startScheduler();
});

export { app, io };
