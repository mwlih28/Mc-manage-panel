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
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { startDiscordBot } from './services/discordBot';

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
import apiKeyRoutes from './routes/apiKeys';
import docsRoutes from './routes/docs';
import webhookRoutes from './routes/webhooks';
import storageRoutes from './routes/storage';
import migrationRoutes from './routes/migrations';
import pushRoutes from './routes/push';
import storeIntegrationRoutes from './routes/storeIntegrations';
import storeWebhookRoutes from './routes/storeWebhooks';
import planRoutes from './routes/plans';
import eggStoreRoutes from './routes/eggStore';

const app = express();
const httpServer = http.createServer(app);

const PORT = parseInt(process.env.PORT || '3001', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// We always run behind the nginx reverse proxy in production. Without this,
// Express sees every request as coming from nginx's own IP (127.0.0.1) —
// req.ip is wrong for every login/audit-log entry, and express-rate-limit
// throttles the whole site as a single client instead of per real visitor.
app.set('trust proxy', 1);

// Security & middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // React is bundled with no inline <script>, so no 'unsafe-inline' needed here.
      scriptSrc: ["'self'"],
      // Tailwind's compiled CSS is a single stylesheet, but React sets some
      // inline style attributes at runtime — style-src-attr covers those
      // without weakening script-src.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://api.fontshare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://api.fontshare.com', 'https://cdn.fontshare.com'],
      // Admin-set panel logo can be any external URL.
      imgSrc: ["'self'", 'data:', 'https:'],
      // Browser only ever talks to this same origin (REST + WebSocket) —
      // tightened so a successful XSS can't exfiltrate data to arbitrary hosts.
      connectSrc: ["'self'", 'wss:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
// Coarse, app-wide backstop — the auth/2FA/public routes already have their
// own tighter, endpoint-specific limiters for brute-force protection.
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));
// Stashes the exact raw bytes alongside the parsed body — needed by the
// Tebex/CraftingStore webhook receivers, which verify an HMAC signature
// computed over the raw request body, not the re-serialized JSON object.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev', { stream: { write: (msg) => logger.http(msg.trim()) } }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: process.env.PANEL_VERSION || '1.0.0', timestamp: new Date().toISOString() });
});

// Branded install-script endpoints — serves the same scripts/*.sh files from
// this deployment's own checkout, so `curl https://get.kretase.com/panel`
// works like Pterodactyl's installer without ever touching github.com.
// Meant to be reached via a dedicated subdomain (e.g. get.kretase.com)
// pointed at this API, but harmless to expose on the main domain too since
// the scripts are already fully public on GitHub.
const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'scripts');
function serveInstallScript(fileName: string) {
  return (_req: express.Request, res: express.Response) => {
    const scriptPath = path.join(SCRIPTS_DIR, fileName);
    if (!fs.existsSync(scriptPath)) return res.status(404).send('Script not found');
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.sendFile(scriptPath);
  };
}
app.get('/panel', serveInstallScript('install-panel.sh'));
app.get('/wings', serveInstallScript('install-wings.sh'));
app.get('/update-panel', serveInstallScript('update-panel.sh'));
app.get('/update-wings', serveInstallScript('update-wings.sh'));
app.get('/uninstall-panel', serveInstallScript('uninstall-panel.sh'));

// Downloadable WHMCS/Blesta provisioning modules, served from this
// deployment's own checkout so admins can grab them straight from the
// panel instead of hunting through the GitHub repo.
const INTEGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'integrations');
app.get('/integrations/whmcs', (_req, res) => {
  const filePath = path.join(INTEGRATIONS_DIR, 'whmcs', 'kretase', 'kretase.php');
  if (!fs.existsSync(filePath)) return res.status(404).send('Module not found');
  res.download(filePath, 'kretase.php');
});
app.get('/integrations/blesta', (_req, res) => {
  const filePath = path.join(INTEGRATIONS_DIR, 'blesta', 'kretase', 'kretase_module.php');
  if (!fs.existsSync(filePath)) return res.status(404).send('Module not found');
  res.download(filePath, 'kretase_module.php');
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
api.use('/api-keys', apiKeyRoutes);
api.use('/docs', docsRoutes);
api.use('/webhooks', webhookRoutes);
api.use('/storage', storageRoutes);
api.use('/migrations', migrationRoutes);
api.use('/push', pushRoutes);
api.use('/store-integrations', storeIntegrationRoutes);
api.use('/store-webhooks', storeWebhookRoutes);
api.use('/plans', planRoutes);
api.use('/egg-store', eggStoreRoutes);

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
  startDiscordBot().catch((err) => logger.warn(`Discord bot startup failed: ${err.message}`));
});

export { app, io };
