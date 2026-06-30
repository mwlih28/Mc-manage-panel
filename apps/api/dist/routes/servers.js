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
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const uuid_1 = require("uuid");
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const wingsClient_1 = require("../services/wingsClient");
const logger_1 = require("../utils/logger");
async function getWingsClient(serverId, userId, isAdmin) {
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: serverId, ...(isAdmin ? {} : { userId }) },
        include: { node: true },
    });
    if (!server || !server.node)
        return null;
    const { node } = server;
    const client = axios_1.default.create({
        baseURL: `${node.scheme}://${node.fqdn}:${node.daemonPort}/api`,
        headers: { Authorization: `Bearer ${node.token}` },
        timeout: 15000,
    });
    return { server, client };
}
const router = (0, express_1.Router)();
function generateShortUuid() {
    return (0, uuid_1.v4)().replace(/-/g, '').slice(0, 8);
}
// GET /servers - Admin sees all, user sees own
router.get('/', auth_1.authenticate, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 20;
    const search = req.query.search;
    const isAdmin = req.user.role === 'ADMIN';
    const where = isAdmin ? {} : { userId: req.user.id };
    if (search) {
        where.OR = [
            { name: { contains: search } },
            { uuidShort: { contains: search } },
        ];
    }
    const [servers, total] = await Promise.all([
        prisma_1.prisma.server.findMany({
            where,
            include: {
                user: { select: { id: true, email: true, username: true } },
                node: { select: { id: true, name: true, fqdn: true } },
                egg: { select: { id: true, name: true } },
                allocation: true,
            },
            skip: (page - 1) * perPage,
            take: perPage,
            orderBy: { createdAt: 'desc' },
        }),
        prisma_1.prisma.server.count({ where }),
    ]);
    return res.json({
        data: servers,
        meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
    });
});
// GET /servers/:id
router.get('/:id', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            OR: [{ id: req.params.id }, { uuid: req.params.id }, { uuidShort: req.params.id }],
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
        include: {
            user: { select: { id: true, email: true, username: true } },
            node: { select: { id: true, name: true, fqdn: true, scheme: true, daemonPort: true } },
            egg: { include: { variables: true } },
            allocation: true,
            _count: { select: { backups: true, databases: true } },
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    return res.json({ data: server });
});
// POST /servers - Admin only
router.post('/', auth_1.authenticate, auth_1.requireAdmin, [
    (0, express_validator_1.body)('name').notEmpty().trim(),
    (0, express_validator_1.body)('userId').notEmpty(),
    (0, express_validator_1.body)('nodeId').notEmpty(),
    (0, express_validator_1.body)('eggId').notEmpty(),
    (0, express_validator_1.body)('memory').isInt({ min: 1 }),
    (0, express_validator_1.body)('disk').isInt({ min: 1 }),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });
    const { name, description, userId, nodeId, eggId, allocationId, memory, swap, disk, io, cpu, startup, image, env, databaseLimit, allocationLimit, backupLimit, } = req.body;
    // Verify user, node, egg exist
    const [user, node, egg] = await Promise.all([
        prisma_1.prisma.user.findUnique({ where: { id: userId } }),
        prisma_1.prisma.node.findUnique({ where: { id: nodeId } }),
        prisma_1.prisma.egg.findUnique({ where: { id: eggId }, include: { variables: true } }),
    ]);
    if (!user)
        return res.status(422).json({ message: 'User not found' });
    if (!node)
        return res.status(422).json({ message: 'Node not found' });
    if (!egg)
        return res.status(422).json({ message: 'Egg not found' });
    // Minecraft's EULA must be explicitly accepted by whoever is creating the
    // server — Bedrock servers have no EULA, everything else requires consent.
    const isBedrockEgg = egg.name.toLowerCase().includes('bedrock') || egg.startup.includes('bedrock_server');
    if (!isBedrockEgg && env?.EULA_ACCEPTED !== 'true') {
        return res.status(422).json({ message: 'You must accept the Minecraft EULA to create this server.' });
    }
    // Handle allocation — pick a free one, or auto-create if none exist
    let finalAllocationId = allocationId;
    if (!finalAllocationId) {
        let freeAlloc = await prisma_1.prisma.allocation.findFirst({
            where: { nodeId, assigned: false },
            orderBy: { port: 'asc' },
        });
        if (!freeAlloc) {
            // Auto-generate next available port starting from 25565
            const highest = await prisma_1.prisma.allocation.findFirst({
                where: { nodeId },
                orderBy: { port: 'desc' },
            });
            // Check if the egg is Bedrock to choose the right default port
            const eggForPort = egg; // Already fetched above
            const isBedrockEgg = eggForPort.name.toLowerCase().includes('bedrock') ||
                eggForPort.startup.includes('bedrock_server');
            const basePort = isBedrockEgg ? 19132 : 25565;
            const nextPort = highest ? highest.port + 1 : basePort;
            const nodeRecord = await prisma_1.prisma.node.findUnique({ where: { id: nodeId } });
            freeAlloc = await prisma_1.prisma.allocation.create({
                data: { nodeId, ip: nodeRecord?.fqdn || '0.0.0.0', port: nextPort },
            });
        }
        finalAllocationId = freeAlloc.id;
    }
    const server = await prisma_1.prisma.server.create({
        data: {
            uuid: (0, uuid_1.v4)(),
            uuidShort: generateShortUuid(),
            name, description, userId, nodeId, eggId,
            allocationId: finalAllocationId,
            memory: parseInt(memory),
            swap: parseInt(swap) || 0,
            disk: parseInt(disk),
            io: parseInt(io) || 500,
            cpu: parseInt(cpu) || 0,
            startup: startup || egg.startup,
            image: image || egg.dockerImage,
            env: JSON.stringify({
                // Always seed the two variables the JVM startup template depends on
                SERVER_MEMORY: String(parseInt(memory)),
                SERVER_JARFILE: 'server.jar',
                ...Object.fromEntries((egg.variables || []).map(v => [v.envVariable, v.defaultValue])),
                ...(env || {}),
            }),
            databaseLimit: parseInt(databaseLimit) || 0,
            allocationLimit: parseInt(allocationLimit) || 0,
            backupLimit: parseInt(backupLimit) || 0,
            status: 'INSTALLING',
        },
        include: {
            user: { select: { id: true, email: true, username: true } },
            node: { select: { id: true, name: true, fqdn: true } },
            egg: { select: { id: true, name: true } },
            allocation: true,
        },
    });
    // Mark allocation as assigned
    await prisma_1.prisma.allocation.update({
        where: { id: finalAllocationId },
        data: { assigned: true },
    });
    await prisma_1.prisma.activity.create({
        data: {
            userId: req.user.id,
            serverId: server.id,
            event: 'server:create',
            properties: JSON.stringify({ name }),
            ip: req.ip,
        },
    });
    // Notify Wings to load the new server
    try {
        const fullServer = await prisma_1.prisma.server.findUnique({
            where: { id: server.id },
            include: {
                node: { select: { id: true, fqdn: true, daemonPort: true, scheme: true, token: true } },
                egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
            },
        });
        if (fullServer?.node) {
            await (0, wingsClient_1.createServerOnNode)(fullServer);
        }
    }
    catch (err) {
        logger_1.logger.warn(`Failed to register server with Wings: ${err.message}`);
    }
    return res.status(201).json({ data: server });
});
// PATCH /servers/:id
router.patch('/:id', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.id,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { name, description, mcVersion } = req.body;
    const updateData = {};
    if (name)
        updateData.name = name;
    if (description !== undefined)
        updateData.description = description;
    if (mcVersion) {
        let currentEnv = {};
        try {
            currentEnv = JSON.parse(server.env) || {};
        }
        catch { /* use empty */ }
        if (!currentEnv.SERVER_MEMORY)
            currentEnv.SERVER_MEMORY = String(server.memory);
        if (!currentEnv.SERVER_JARFILE)
            currentEnv.SERVER_JARFILE = 'server.jar';
        updateData.env = JSON.stringify({ ...currentEnv, MC_VERSION: mcVersion });
    }
    if (isAdmin) {
        const { memory, swap, disk, io, cpu, startup, image, suspended, userId, allocationId, backupLimit, databaseLimit } = req.body;
        if (memory)
            updateData.memory = parseInt(memory);
        if (swap !== undefined)
            updateData.swap = parseInt(swap);
        if (disk)
            updateData.disk = parseInt(disk);
        if (io)
            updateData.io = parseInt(io);
        if (cpu !== undefined)
            updateData.cpu = parseInt(cpu);
        if (startup)
            updateData.startup = startup;
        if (image)
            updateData.image = image;
        if (typeof suspended === 'boolean')
            updateData.suspended = suspended;
        if (backupLimit !== undefined)
            updateData.backupLimit = parseInt(backupLimit);
        if (databaseLimit !== undefined)
            updateData.databaseLimit = parseInt(databaseLimit);
        // Owner change
        if (userId && userId !== server.userId) {
            const newOwner = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
            if (!newOwner)
                return res.status(422).json({ message: 'User not found' });
            updateData.userId = userId;
        }
        // Allocation change
        if (allocationId && allocationId !== server.allocationId) {
            const newAlloc = await prisma_1.prisma.allocation.findUnique({ where: { id: allocationId } });
            if (!newAlloc)
                return res.status(422).json({ message: 'Allocation not found' });
            if (newAlloc.assigned && newAlloc.id !== server.allocationId) {
                return res.status(422).json({ message: 'Allocation already in use' });
            }
            // Free old allocation
            if (server.allocationId) {
                await prisma_1.prisma.allocation.update({ where: { id: server.allocationId }, data: { assigned: false } });
            }
            await prisma_1.prisma.allocation.update({ where: { id: allocationId }, data: { assigned: true } });
            updateData.allocationId = allocationId;
        }
    }
    const updated = await prisma_1.prisma.server.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
            user: { select: { id: true, email: true, username: true } },
            node: { select: { id: true, name: true } },
            allocation: true,
        },
    });
    return res.json({ data: updated });
});
// POST /servers/:id/reinstall - Admin only
router.post('/:id/reinstall', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    try {
        const server = await prisma_1.prisma.server.findFirst({
            where: { id: req.params.id },
            include: {
                node: true,
                egg: { select: { startup: true, dockerImage: true, scriptInstall: true, scriptContainer: true } },
            },
        });
        if (!server)
            return res.status(404).json({ message: 'Server not found' });
        await prisma_1.prisma.server.update({ where: { id: server.id }, data: { status: 'INSTALLING' } });
        if (server.node?.status === 'ONLINE') {
            const wingsConfig = (0, wingsClient_1.buildWingsConfig)(server);
            const client = axios_1.default.create({
                baseURL: `${server.node.scheme}://${server.node.fqdn}:${server.node.daemonPort}/api`,
                headers: { Authorization: `Bearer ${server.node.token}` },
                timeout: 10000,
            });
            client.post(`/servers/${server.uuid}/reinstall`, wingsConfig)
                .catch(err => logger_1.logger.warn(`Wings reinstall request failed: ${err.message}`));
        }
        await prisma_1.prisma.activity.create({
            data: { userId: req.user.id, serverId: server.id, event: 'server:reinstall', ip: req.ip },
        });
        return res.json({ message: 'Reinstall initiated' });
    }
    catch (err) {
        logger_1.logger.error('Reinstall error:', err);
        return res.status(500).json({ message: 'Internal server error during reinstall' });
    }
});
// DELETE /servers/:id
router.delete('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const server = await prisma_1.prisma.server.findUnique({ where: { id: req.params.id } });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    if (server.allocationId) {
        await prisma_1.prisma.allocation.update({
            where: { id: server.allocationId },
            data: { assigned: false },
        });
    }
    await prisma_1.prisma.server.delete({ where: { id: req.params.id } });
    await prisma_1.prisma.activity.create({
        data: {
            userId: req.user.id,
            event: 'server:delete',
            properties: JSON.stringify({ name: server.name }),
            ip: req.ip,
        },
    });
    return res.status(204).send();
});
// POST /servers/:id/power - Power actions (real Wings integration)
router.post('/:id/power', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.id,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
        include: { node: true },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { action } = req.body;
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
        return res.status(422).json({ message: 'Invalid power action' });
    }
    const statusMap = {
        start: 'STARTING',
        stop: 'STOPPING',
        restart: 'STOPPING',
        kill: 'OFFLINE',
    };
    // Update status optimistically
    await prisma_1.prisma.server.update({
        where: { id: server.id },
        data: { status: statusMap[action] },
    });
    // Send to Wings daemon (non-blocking)
    if (server.node?.status === 'ONLINE') {
        (0, wingsClient_1.sendPowerAction)(server, action)
            .catch(err => logger_1.logger.warn(`Wings power action failed for ${server.uuid}: ${err.message}`));
    }
    else {
        logger_1.logger.warn(`Node is offline, power action queued for ${server.uuid}`);
    }
    await prisma_1.prisma.activity.create({
        data: {
            userId: req.user.id,
            serverId: server.id,
            event: `server:power.${action}`,
            ip: req.ip,
        },
    });
    return res.json({ message: `Server ${action} command sent` });
});
// POST /servers/:id/command - Send console command
router.post('/:id/command', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.id,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
        include: { node: true },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { command } = req.body;
    if (!command)
        return res.status(422).json({ message: 'Command required' });
    if (server.node?.status === 'ONLINE') {
        await (0, wingsClient_1.sendCommand)(server, command)
            .catch(err => logger_1.logger.warn(`Wings command failed: ${err.message}`));
    }
    return res.json({ message: 'Command sent' });
});
// GET /servers/:id/resources - Real resource data from Wings
router.get('/:id/resources', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.id,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
        include: { node: true },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    if (!server.node || server.node.status !== 'ONLINE') {
        return res.json({ resources: { state: 'offline', cpu_absolute: 0, memory_bytes: 0, disk_bytes: 0 } });
    }
    const resources = await (0, wingsClient_1.getServerResources)(server)
        .catch(() => ({ state: 'offline', cpu_absolute: 0, memory_bytes: 0, disk_bytes: 0 }));
    return res.json({ resources });
});
// GET /servers/:id/activity
router.get('/:id/activity', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.id,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const activities = await prisma_1.prisma.activity.findMany({
        where: { serverId: server.id },
        include: { user: { select: { id: true, username: true, email: true } } },
        orderBy: { timestamp: 'desc' },
        take: 50,
    });
    return res.json({ data: activities });
});
// ──────────────────────────────────────────────────────
// File Manager (proxy to Wings)
// ──────────────────────────────────────────────────────
// GET /servers/:id/files?directory=/
router.get('/:id/files', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/files`, { params: { directory: req.query.directory || '/' } });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// GET /servers/:id/files/contents?file=path
router.get('/:id/files/contents', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/files/contents`, { params: { file: req.query.file } });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// POST /servers/:id/files/write
router.post('/:id/files/write', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/files/write`, req.body);
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// POST /servers/:id/files/delete
router.post('/:id/files/delete', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/files/delete`, req.body);
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// POST /servers/:id/files/create-folder
router.post('/:id/files/create-folder', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/files/create-folder`, req.body);
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// PUT /servers/:id/files/rename
router.put('/:id/files/rename', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.put(`/servers/${ctx.server.uuid}/files/rename`, req.body);
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// GET /servers/:id/players - Proxy to Wings for log-based player tracking
router.get('/:id/players', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players`, { timeout: 5000 });
        return res.json(data);
    }
    catch {
        return res.json({ players: [], count: 0 });
    }
});
// GET /servers/:id/players/:playerUuid/inventory
router.get('/:id/players/:playerUuid/inventory', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/inventory`, { timeout: 10000 });
        return res.json(data);
    }
    catch {
        return res.status(500).json({ message: 'Could not read inventory' });
    }
});
// GET /servers/:id/players/all — all players who ever joined
router.get('/:id/players/all', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/all`, { timeout: 10000 });
        return res.json(data);
    }
    catch {
        return res.json({ players: [], count: 0 });
    }
});
// GET /servers/:id/players/:playerUuid/details
router.get('/:id/players/:playerUuid/details', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const ctx = await getWingsClient(req.params.id, req.user.id, isAdmin);
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/details`, { timeout: 10000 });
        return res.json(data);
    }
    catch {
        return res.status(500).json({ message: 'Could not read player data' });
    }
});
// POST /servers/:id/players/:playerUuid/ban
router.post('/:id/players/:playerUuid/ban', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, true);
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/ban`, req.body, { timeout: 10000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Ban failed' });
    }
});
// DELETE /servers/:id/players/:playerUuid/ban
router.delete('/:id/players/:playerUuid/ban', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, true);
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.delete(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/ban`, { params: req.query, timeout: 10000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Unban failed' });
    }
});
// POST /servers/:id/players/:playerUuid/kick
router.post('/:id/players/:playerUuid/kick', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, true);
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/kick`, req.body, { timeout: 10000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Kick failed' });
    }
});
// POST /servers/:id/players/:playerUuid/ipban
router.post('/:id/players/:playerUuid/ipban', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, true);
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/ipban`, req.body, { timeout: 10000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'IP ban failed' });
    }
});
// DELETE /servers/:id/players/:playerUuid/inventory/:slot
router.delete('/:id/players/:playerUuid/inventory/:slot', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, true);
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.delete(`/servers/${ctx.server.uuid}/players/${req.params.playerUuid}/inventory/${req.params.slot}`, { params: req.query, timeout: 10000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Failed to remove item' });
    }
});
// POST /servers/:id/plugins/install - Proxy to Wings for plugin download
router.post('/:id/plugins/install', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/plugins/install`, req.body, { timeout: 120000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Wings error' });
    }
});
// GET /servers/:id/versions
router.get('/:id/versions', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/versions`, { timeout: 15000 });
        return res.json(data);
    }
    catch {
        try {
            const { data } = await axios_1.default.get('https://api.papermc.io/v2/projects/paper', { timeout: 10000 });
            return res.json({ versions: data.versions.reverse() });
        }
        catch {
            return res.status(500).json({ message: 'Failed to fetch versions' });
        }
    }
});
// GET /servers/:id/versions/:version/builds
router.get('/:id/versions/:version/builds', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.get(`/servers/${ctx.server.uuid}/versions/${req.params.version}/builds`, { timeout: 15000 });
        return res.json(data);
    }
    catch {
        try {
            const { data } = await axios_1.default.get(`https://api.papermc.io/v2/projects/paper/versions/${req.params.version}`, { timeout: 10000 });
            const builds = data.builds;
            return res.json({ builds: builds.reverse(), latestBuild: builds[0] });
        }
        catch {
            return res.status(500).json({ message: 'Failed to fetch builds' });
        }
    }
});
// POST /servers/:id/version — install specific Paper version
router.post('/:id/version', auth_1.authenticate, async (req, res) => {
    const ctx = await getWingsClient(req.params.id, req.user.id, req.user.role === 'ADMIN');
    if (!ctx)
        return res.status(404).json({ message: 'Server not found' });
    try {
        const { data } = await ctx.client.post(`/servers/${ctx.server.uuid}/version`, req.body, { timeout: 180000 });
        return res.json(data);
    }
    catch (err) {
        const e = err;
        return res.status(e.response?.status || 500).json(e.response?.data || { message: 'Version change failed' });
    }
});
// ─── Server Notes ─────────────────────────────────────────────────────────────
router.get('/:id/notes', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const note = await prisma_1.prisma.serverNote.findUnique({ where: { serverId: server.id } });
    return res.json({ content: note?.content || '' });
});
router.put('/:id/notes', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const note = await prisma_1.prisma.serverNote.upsert({
        where: { serverId: server.id },
        create: { serverId: server.id, content: req.body.content || '' },
        update: { content: req.body.content || '' },
    });
    return res.json({ content: note.content });
});
// ─── Sub-Users ────────────────────────────────────────────────────────────────
router.get('/:id/subusers', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const subUsers = await prisma_1.prisma.serverSubUser.findMany({
        where: { serverId: server.id },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true, username: true } } },
    });
    return res.json({ data: subUsers });
});
router.post('/:id/subusers', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { email, permissions } = req.body;
    const target = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (!target)
        return res.status(404).json({ message: 'User not found' });
    if (target.id === server.userId)
        return res.status(400).json({ message: 'Cannot add server owner as sub-user' });
    const su = await prisma_1.prisma.serverSubUser.upsert({
        where: { serverId_userId: { serverId: server.id, userId: target.id } },
        create: { serverId: server.id, userId: target.id, permissions: JSON.stringify(permissions || []) },
        update: { permissions: JSON.stringify(permissions || []) },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true, username: true } } },
    });
    return res.json(su);
});
router.delete('/:id/subusers/:userId', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    await prisma_1.prisma.serverSubUser.deleteMany({ where: { serverId: server.id, userId: req.params.userId } });
    return res.json({ ok: true });
});
// ─── Scheduled Tasks ─────────────────────────────────────────────────────────
router.get('/:id/schedules', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const schedules = await prisma_1.prisma.scheduledTask.findMany({ where: { serverId: server.id }, orderBy: { createdAt: 'asc' } });
    return res.json({ data: schedules });
});
router.post('/:id/schedules', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { name, cronExpression, action, payload, enabled } = req.body;
    const task = await prisma_1.prisma.scheduledTask.create({
        data: { serverId: server.id, name, cronExpression, action, payload: JSON.stringify(payload || {}), enabled: enabled !== false },
    });
    return res.json(task);
});
router.put('/:id/schedules/:taskId', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { name, cronExpression, action, payload, enabled } = req.body;
    const task = await prisma_1.prisma.scheduledTask.update({
        where: { id: req.params.taskId },
        data: { name, cronExpression, action, ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}), ...(enabled !== undefined ? { enabled } : {}) },
    });
    return res.json(task);
});
router.delete('/:id/schedules/:taskId', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    await prisma_1.prisma.scheduledTask.delete({ where: { id: req.params.taskId } });
    return res.json({ ok: true });
});
// ─── Stats History (for graphs) ───────────────────────────────────────────────
router.get('/:id/stats/history', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: { id: req.params.id, ...(isAdmin ? {} : { userId: req.user.id }) },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const { statsBuffer } = await Promise.resolve().then(() => __importStar(require('../services/wingsRelay')));
    const history = statsBuffer.get(server.uuid) ?? [];
    return res.json({ data: history });
});
exports.default = router;
//# sourceMappingURL=servers.js.map