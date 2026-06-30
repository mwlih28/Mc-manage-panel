"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const socket_io_1 = require("socket.io");
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
const dockerService_1 = require("./services/dockerService");
const serverManager_1 = require("./services/serverManager");
const panelClient_1 = require("./services/panelClient");
const servers_1 = __importDefault(require("./routes/servers"));
const files_1 = __importDefault(require("./routes/files"));
const system_1 = __importDefault(require("./routes/system"));
async function main() {
    // Load config
    let cfg;
    try {
        cfg = (0, config_1.loadConfig)();
    }
    catch (err) {
        logger_1.logger.error(err.message);
        logger_1.logger.error('Please run: mc-wings configure --panel-url=https://your-panel.com --token=YOUR_TOKEN');
        process.exit(1);
    }
    const app = (0, express_1.default)();
    const httpServer = http_1.default.createServer(app);
    // --- Token auth middleware ---
    app.use((req, res, next) => {
        if (req.path === '/health' || req.path === '/api/health')
            return next();
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token || token !== cfg.token) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    });
    app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: '50mb' }));
    app.use((0, morgan_1.default)('combined', { stream: { write: (msg) => logger_1.logger.http(msg.trim()) } }));
    // --- Routes ---
    app.use('/api/servers', servers_1.default);
    app.use('/api/servers/:uuid/files', files_1.default);
    app.use('/api', system_1.default);
    // --- Socket.io for console/stats streaming ---
    const io = new socket_io_1.Server(httpServer, {
        cors: { origin: '*' },
        transports: ['websocket', 'polling'],
    });
    serverManager_1.serverManager.setSocketServer(io);
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        // Accept panel token OR client JWT (panel proxies with its own token)
        if (token === cfg.token || token?.startsWith('eyJ')) {
            return next();
        }
        next(new Error('Unauthorized'));
    });
    io.on('connection', (socket) => {
        logger_1.logger.debug(`Socket connected: ${socket.id}`);
        socket.on('subscribe', (uuid) => {
            socket.join(`server:${uuid}`);
            const status = serverManager_1.serverManager.getStatus(uuid);
            socket.emit('server:status', { state: status });
            // Replay buffered log lines so clients recover history after reconnect.
            // Include uuid so the relay can route to the correct server room.
            const history = serverManager_1.serverManager.getLogBuffer(uuid);
            if (history.length > 0) {
                socket.emit('server:console:history', {
                    uuid,
                    lines: history.map((data) => ({ type: 'output', data, timestamp: Date.now() })),
                });
            }
        });
        socket.on('unsubscribe', (uuid) => {
            socket.leave(`server:${uuid}`);
        });
        socket.on('power', async ({ uuid, action }) => {
            // Auto-load server from panel if Wings doesn't know about it yet
            if (!serverManager_1.serverManager.getServerList().includes(uuid)) {
                try {
                    const servers = await panelClient_1.panelClient.getServers();
                    const cfg = servers.find(s => s.uuid === uuid);
                    if (cfg) {
                        await serverManager_1.serverManager.loadServer(cfg);
                        logger_1.logger.info(`Auto-loaded server ${uuid} from panel`);
                    }
                    else {
                        logger_1.logger.warn(`Server ${uuid} not found on panel, cannot start`);
                        return;
                    }
                }
                catch (err) {
                    logger_1.logger.warn(`Failed to auto-load server ${uuid}: ${err.message}`);
                    return;
                }
            }
            switch (action) {
                case 'start':
                    await serverManager_1.serverManager.startServer(uuid).catch(err => logger_1.logger.error(err));
                    break;
                case 'stop':
                    await serverManager_1.serverManager.stopServer(uuid).catch(err => logger_1.logger.error(err));
                    break;
                case 'restart':
                    await serverManager_1.serverManager.restartServer(uuid).catch(err => logger_1.logger.error(err));
                    break;
                case 'kill':
                    await serverManager_1.serverManager.killServer(uuid).catch(err => logger_1.logger.error(err));
                    break;
            }
        });
        socket.on('command', async ({ uuid, command }) => {
            await serverManager_1.serverManager.sendCommand(uuid, command);
        });
        socket.on('disconnect', () => logger_1.logger.debug(`Socket disconnected: ${socket.id}`));
    });
    // --- Ensure Docker network ---
    await (0, dockerService_1.ensureNetwork)();
    // --- Pull servers from Panel ---
    try {
        logger_1.logger.info(`Connecting to panel: ${cfg.remote}`);
        const servers = await panelClient_1.panelClient.getServers();
        logger_1.logger.info(`Loading ${servers.length} server(s) from panel...`);
        for (const server of servers) {
            await serverManager_1.serverManager.loadServer(server).catch(err => logger_1.logger.warn(`Failed to load server ${server.uuid}: ${err.message}`));
        }
    }
    catch (err) {
        logger_1.logger.warn(`Could not connect to panel: ${err.message}`);
        logger_1.logger.warn('Wings will run without panel sync. Check panel URL and token.');
    }
    // --- Heartbeat to panel every 30s ---
    node_cron_1.default.schedule('*/30 * * * * *', async () => {
        Promise.resolve().then(() => __importStar(require('systeminformation'))).then(async (si) => {
            const [cpu, mem] = await Promise.all([si.currentLoad(), si.mem()]);
            await panelClient_1.panelClient.reportHeartbeat({
                cpu: parseFloat(cpu.currentLoad.toFixed(2)),
                memory: Math.round((mem.active / mem.total) * 100),
                disk: 0,
            }).catch(() => { });
        });
    });
    // --- Start server ---
    const port = cfg.api.port || 8080;
    const host = cfg.api.host || '0.0.0.0';
    httpServer.listen(port, host, () => {
        logger_1.logger.info('================================================');
        logger_1.logger.info('  Kretase - Wings Daemon');
        logger_1.logger.info(`  Listening: ${host}:${port}`);
        logger_1.logger.info(`  Panel: ${cfg.remote}`);
        logger_1.logger.info(`  Node UUID: ${cfg.uuid}`);
        logger_1.logger.info('================================================');
    });
    // Graceful shutdown
    process.on('SIGTERM', async () => {
        logger_1.logger.info('Shutting down...');
        process.exit(0);
    });
}
main().catch(err => {
    logger_1.logger.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map