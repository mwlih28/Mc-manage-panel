"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocketServer = initSocketServer;
const socket_io_1 = require("socket.io");
const jwt_1 = require("../utils/jwt");
const prisma_1 = require("../utils/prisma");
const logger_1 = require("../utils/logger");
const wingsClient_1 = require("./wingsClient");
const wingsRelay_1 = require("./wingsRelay");
const WINGS_TO_PANEL_STATUS = {
    running: 'RUNNING', offline: 'OFFLINE', starting: 'STARTING', stopping: 'STOPPING', installing: 'INSTALLING',
};
function initSocketServer(httpServer, corsOrigin) {
    const io = new socket_io_1.Server(httpServer, {
        cors: { origin: corsOrigin, credentials: true },
        transports: ['websocket', 'polling'],
    });
    // Auth middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.slice(7);
        if (!token)
            return next(new Error('Authentication required'));
        try {
            const payload = (0, jwt_1.verifyAccessToken)(token);
            const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.userId } });
            if (!user)
                return next(new Error('User not found'));
            socket.data.user = user;
            next();
        }
        catch {
            next(new Error('Invalid token'));
        }
    });
    io.on('connection', (socket) => {
        logger_1.logger.debug(`Socket connected: ${socket.id} (user: ${socket.data.user?.email})`);
        socket.on('server:subscribe', async (serverId) => {
            const isAdmin = socket.data.user?.role === 'ADMIN';
            const server = await prisma_1.prisma.server.findFirst({
                where: { id: serverId, ...(isAdmin ? {} : { userId: socket.data.user?.id }) },
                include: { node: true },
            });
            if (!server) {
                socket.emit('error', 'Server not found or access denied');
                return;
            }
            // Room keyed by panel server ID for panel clients
            socket.join(`server:${serverId}`);
            // Room keyed by wings uuid for relay
            socket.join(`server:uuid:${server.uuid}`);
            // Send initial status — if the DB has it in a transient state
            // (STARTING/STOPPING), that value only gets refreshed when Wings emits
            // a change event. If the server actually finished transitioning while
            // no one had a live connection to relay that event, the DB is left
            // stuck showing the old transient state forever. Reconcile against
            // Wings' live state on subscribe instead of trusting the DB blindly.
            let liveStatus = server.status;
            if ((liveStatus === 'STARTING' || liveStatus === 'STOPPING') && server.node?.status === 'ONLINE') {
                try {
                    const resources = await (0, wingsClient_1.getServerResources)(server);
                    const mapped = WINGS_TO_PANEL_STATUS[resources.state];
                    if (mapped && mapped !== liveStatus) {
                        liveStatus = mapped;
                        await prisma_1.prisma.server.update({ where: { id: serverId }, data: { status: mapped } });
                    }
                }
                catch { /* Wings unreachable — fall back to the DB value */ }
            }
            socket.emit('server:status', { serverId, status: liveStatus, timestamp: Date.now() });
            // Replay console history so the client gets recent output after refresh
            const history = wingsRelay_1.consoleBuffer.get(server.uuid) ?? [];
            if (history.length > 0) {
                socket.emit('server:console:history', history);
            }
            // Connect to Wings relay if node available
            if (server.node) {
                try {
                    (0, wingsRelay_1.getOrConnectWings)({
                        id: server.node.id,
                        fqdn: server.node.fqdn,
                        daemonPort: server.node.daemonPort,
                        scheme: server.node.scheme,
                        token: server.node.token,
                    }, io);
                    (0, wingsRelay_1.subscribeServerOnWings)(server.node.id, server.uuid);
                }
                catch (err) {
                    logger_1.logger.warn(`Could not connect Wings relay for server ${serverId}: ${err.message}`);
                }
            }
        });
        socket.on('server:unsubscribe', (serverId) => {
            socket.leave(`server:${serverId}`);
        });
        socket.on('server:command', async ({ serverId, command }) => {
            const isAdmin = socket.data.user?.role === 'ADMIN';
            const server = await prisma_1.prisma.server.findFirst({
                where: { id: serverId, ...(isAdmin ? {} : { userId: socket.data.user?.id }) },
                include: { node: true },
            });
            if (!server)
                return;
            // Echo command to panel clients and buffer it
            const inputLine = { type: 'input', data: `> ${command}`, timestamp: Date.now() };
            io.to(`server:${serverId}`).emit('server:console', { serverId, ...inputLine });
            (0, wingsRelay_1.pushConsoleBuffer)(server.uuid, inputLine);
            // Try Wings relay first, fall back to HTTP
            if (server.node) {
                try {
                    (0, wingsRelay_1.sendCommandToWings)(server.node.id, server.uuid, command);
                }
                catch {
                    try {
                        await (0, wingsClient_1.sendCommand)(server, command);
                    }
                    catch (err) {
                        logger_1.logger.warn(`Failed to send command to Wings: ${err.message}`);
                    }
                }
            }
        });
        socket.on('server:power', async ({ serverId, action }) => {
            const isAdmin = socket.data.user?.role === 'ADMIN';
            const server = await prisma_1.prisma.server.findFirst({
                where: { id: serverId, ...(isAdmin ? {} : { userId: socket.data.user?.id }) },
                include: { node: true, egg: true },
            });
            if (!server)
                return;
            const isBedrockEgg = server.egg.name.toLowerCase().includes('bedrock') || server.egg.startup.includes('bedrock_server');
            if (action === 'start' && !isBedrockEgg && !server.eulaAccepted) {
                socket.emit('error', 'EULA_NOT_ACCEPTED');
                return;
            }
            const transitStatus = {
                start: 'STARTING', stop: 'STOPPING', restart: 'STOPPING', kill: 'OFFLINE',
            };
            const newStatus = transitStatus[action];
            if (!newStatus)
                return;
            await prisma_1.prisma.server.update({ where: { id: serverId }, data: { status: newStatus } });
            io.to(`server:${serverId}`).emit('server:status', { serverId, status: newStatus, timestamp: Date.now() });
            // Try Wings relay first, fall back to HTTP
            if (server.node) {
                try {
                    (0, wingsRelay_1.sendPowerToWings)(server.node.id, server.uuid, action);
                }
                catch {
                    try {
                        await (0, wingsClient_1.sendPowerAction)(server, action);
                    }
                    catch (err) {
                        logger_1.logger.warn(`Failed to send power action to Wings: ${err.message}`);
                    }
                }
            }
        });
        socket.on('disconnect', () => {
            logger_1.logger.debug(`Socket disconnected: ${socket.id}`);
        });
    });
    return io;
}
//# sourceMappingURL=socketService.js.map