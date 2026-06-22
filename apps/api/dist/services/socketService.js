"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocketServer = initSocketServer;
const socket_io_1 = require("socket.io");
const jwt_1 = require("../utils/jwt");
const prisma_1 = require("../utils/prisma");
const logger_1 = require("../utils/logger");
const wingsClient_1 = require("./wingsClient");
const wingsRelay_1 = require("./wingsRelay");
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
            // Send initial status
            socket.emit('server:status', { serverId, status: server.status, timestamp: Date.now() });
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
            // Echo command to panel clients
            io.to(`server:${serverId}`).emit('server:console', {
                serverId, type: 'input', data: `> ${command}`, timestamp: Date.now(),
            });
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
                include: { node: true },
            });
            if (!server)
                return;
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