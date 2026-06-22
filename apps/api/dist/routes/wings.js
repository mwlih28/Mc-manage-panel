"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const wingsClient_1 = require("../services/wingsClient");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
// Wings daemon authenticates to get node info
// POST /api/v1/wings/auth
router.post('/auth', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ message: 'Token required' });
    const node = await prisma_1.prisma.node.findUnique({ where: { token } });
    if (!node)
        return res.status(401).json({ message: 'Invalid token' });
    // Mark node as online
    await prisma_1.prisma.node.update({
        where: { id: node.id },
        data: { status: 'ONLINE' },
    });
    logger_1.logger.info(`Node authenticated: ${node.name} (${node.fqdn})`);
    return res.json({ uuid: node.id, name: node.name, nodeId: node.id });
});
// Wings daemon pulls server list
// GET /api/v1/wings/servers
router.get('/servers', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ message: 'Token required' });
    const node = await prisma_1.prisma.node.findUnique({ where: { token } });
    if (!node)
        return res.status(401).json({ message: 'Invalid token' });
    const servers = await (0, wingsClient_1.getNodeServers)(node.id);
    return res.json({ servers });
});
// Wings daemon reports server status
// POST /api/v1/wings/servers/:uuid/status
router.post('/servers/:uuid/status', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ message: 'Token required' });
    const node = await prisma_1.prisma.node.findUnique({ where: { token } });
    if (!node)
        return res.status(401).json({ message: 'Invalid token' });
    const { uuid } = req.params;
    const { status } = req.body;
    const validStatuses = [
        'OFFLINE', 'STARTING', 'RUNNING', 'STOPPING',
        'INSTALLING', 'INSTALL_FAILED', 'SUSPENDED'
    ];
    if (!validStatuses.includes(status?.toUpperCase())) {
        return res.status(422).json({ message: 'Invalid status' });
    }
    await prisma_1.prisma.server.updateMany({
        where: { uuid, nodeId: node.id },
        data: { status: status.toUpperCase() },
    });
    // Broadcast to connected clients via socket
    const io = req.app.get('io');
    const server = await prisma_1.prisma.server.findFirst({ where: { uuid } });
    if (io && server) {
        io.to(`server:${server.id}`).emit('server:status', {
            serverId: server.id,
            status: status.toUpperCase(),
            timestamp: Date.now(),
        });
    }
    return res.json({ message: 'Status updated' });
});
// Wings daemon heartbeat
// POST /api/v1/wings/heartbeat
router.post('/heartbeat', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ message: 'Token required' });
    const node = await prisma_1.prisma.node.findUnique({ where: { token } });
    if (!node)
        return res.status(401).json({ message: 'Invalid token' });
    await prisma_1.prisma.node.update({
        where: { id: node.id },
        data: { status: 'ONLINE', updatedAt: new Date() },
    });
    return res.json({ message: 'ok' });
});
exports.default = router;
//# sourceMappingURL=wings.js.map