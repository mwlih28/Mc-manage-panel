"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const uuid_1 = require("uuid");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /nodes
router.get('/', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 20;
    const [nodes, total] = await Promise.all([
        prisma_1.prisma.node.findMany({
            include: {
                _count: { select: { servers: true, allocations: true } },
            },
            skip: (page - 1) * perPage,
            take: perPage,
            orderBy: { createdAt: 'asc' },
        }),
        prisma_1.prisma.node.count(),
    ]);
    return res.json({
        data: nodes,
        meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
    });
});
// GET /nodes/:id
router.get('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const node = await prisma_1.prisma.node.findUnique({
        where: { id: req.params.id },
        include: {
            _count: { select: { servers: true, allocations: true } },
            allocations: { take: 50, orderBy: { port: 'asc' } },
        },
    });
    if (!node)
        return res.status(404).json({ message: 'Node not found' });
    return res.json({ data: node });
});
// POST /nodes
router.post('/', auth_1.authenticate, auth_1.requireAdmin, [
    (0, express_validator_1.body)('name').notEmpty().trim(),
    (0, express_validator_1.body)('fqdn').notEmpty().trim(),
    (0, express_validator_1.body)('memory').isInt({ min: 1 }),
    (0, express_validator_1.body)('disk').isInt({ min: 1 }),
    (0, express_validator_1.body)('port').optional().isInt({ min: 1, max: 65535 }),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty())
        return res.status(422).json({ errors: errors.array() });
    const { name, description, fqdn, scheme, port, daemonPort, daemonSftp, memory, memoryOverallocate, disk, diskOverallocate, uploadSize, behindProxy, } = req.body;
    const token = (0, uuid_1.v4)().replace(/-/g, '');
    const node = await prisma_1.prisma.node.create({
        data: {
            name, description, fqdn,
            scheme: scheme || 'https',
            port: parseInt(port) || 8080,
            daemonPort: parseInt(daemonPort) || 2022,
            daemonSftp: parseInt(daemonSftp) || 2022,
            memory: parseInt(memory),
            memoryOverallocate: parseInt(memoryOverallocate) || 0,
            disk: parseInt(disk),
            diskOverallocate: parseInt(diskOverallocate) || 0,
            uploadSize: parseInt(uploadSize) || 100,
            behindProxy: behindProxy || false,
            token,
        },
    });
    return res.status(201).json({ data: node });
});
// PATCH /nodes/:id
router.patch('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { name, description, fqdn, scheme, port, daemonPort, daemonSftp, memory, memoryOverallocate, disk, diskOverallocate, maintenanceMode, gameSubdomain, } = req.body;
    const node = await prisma_1.prisma.node.update({
        where: { id: req.params.id },
        data: {
            ...(name && { name }),
            ...(description !== undefined && { description }),
            ...(fqdn && { fqdn }),
            ...(scheme && { scheme }),
            ...(port && { port: parseInt(port) }),
            ...(daemonPort && { daemonPort: parseInt(daemonPort) }),
            ...(daemonSftp && { daemonSftp: parseInt(daemonSftp) }),
            ...(memory && { memory: parseInt(memory) }),
            ...(memoryOverallocate !== undefined && { memoryOverallocate: parseInt(memoryOverallocate) }),
            ...(disk && { disk: parseInt(disk) }),
            ...(diskOverallocate !== undefined && { diskOverallocate: parseInt(diskOverallocate) }),
            ...(typeof maintenanceMode === 'boolean' && { maintenanceMode }),
            ...(gameSubdomain !== undefined && { gameSubdomain: gameSubdomain || null }),
        },
    });
    return res.json({ data: node });
});
// DELETE /nodes/:id
router.delete('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const serverCount = await prisma_1.prisma.server.count({ where: { nodeId: req.params.id } });
    if (serverCount > 0) {
        return res.status(400).json({ message: 'Cannot delete node with active servers' });
    }
    await prisma_1.prisma.node.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});
// GET /nodes/:id/allocations
router.get('/:id/allocations', auth_1.authenticate, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 50;
    const [allocations, total] = await Promise.all([
        prisma_1.prisma.allocation.findMany({
            where: { nodeId: req.params.id },
            include: { server: { select: { id: true, name: true, uuid: true } } },
            skip: (page - 1) * perPage,
            take: perPage,
            orderBy: { port: 'asc' },
        }),
        prisma_1.prisma.allocation.count({ where: { nodeId: req.params.id } }),
    ]);
    return res.json({
        data: allocations,
        meta: { total, page, perPage, lastPage: Math.ceil(total / perPage) },
    });
});
// POST /nodes/:id/allocations
router.post('/:id/allocations', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { ip, ports } = req.body;
    if (!ip || !Array.isArray(ports) || ports.length === 0) {
        return res.status(422).json({ message: 'IP and ports array required' });
    }
    const created = await prisma_1.prisma.$transaction(ports.map((port) => prisma_1.prisma.allocation.create({
        data: { nodeId: req.params.id, ip, port },
    })));
    return res.status(201).json({ data: created });
});
// DELETE /nodes/:nodeId/allocations/:allocId
router.delete('/:nodeId/allocations/:allocId', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const alloc = await prisma_1.prisma.allocation.findFirst({
        where: { id: req.params.allocId, nodeId: req.params.nodeId },
    });
    if (!alloc)
        return res.status(404).json({ message: 'Allocation not found' });
    if (alloc.assigned)
        return res.status(400).json({ message: 'Cannot delete assigned allocation' });
    await prisma_1.prisma.allocation.delete({ where: { id: req.params.allocId } });
    return res.status(204).send();
});
exports.default = router;
//# sourceMappingURL=nodes.js.map