"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /nests
router.get('/nests', auth_1.authenticate, async (_req, res) => {
    const nests = await prisma_1.prisma.nest.findMany({
        include: {
            _count: { select: { eggs: true } },
        },
        orderBy: { name: 'asc' },
    });
    return res.json({ data: nests });
});
// GET /nests/:nestId/eggs
router.get('/nests/:nestId/eggs', auth_1.authenticate, async (req, res) => {
    const eggs = await prisma_1.prisma.egg.findMany({
        where: { nestId: req.params.nestId },
        include: { variables: true },
        orderBy: { name: 'asc' },
    });
    return res.json({ data: eggs });
});
// GET /eggs
router.get('/', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const eggs = await prisma_1.prisma.egg.findMany({
        include: {
            nest: { select: { id: true, name: true } },
            variables: true,
            _count: { select: { servers: true } },
        },
        orderBy: { name: 'asc' },
    });
    return res.json({ data: eggs });
});
// POST /eggs
router.post('/', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { nestId, nestName, name, description, dockerImage, startup, configStop, scriptInstall, variables, } = req.body;
    if (!name || !dockerImage || !startup) {
        return res.status(422).json({ message: 'name, dockerImage, and startup are required' });
    }
    // Resolve or create nest
    let resolvedNestId = nestId;
    if (!resolvedNestId) {
        if (!nestName)
            return res.status(422).json({ message: 'nestId or nestName is required' });
        const existing = await prisma_1.prisma.nest.findFirst({ where: { name: nestName } });
        if (existing) {
            resolvedNestId = existing.id;
        }
        else {
            const nest = await prisma_1.prisma.nest.create({
                data: { uuid: (0, uuid_1.v4)(), author: 'admin@local', name: nestName, description: nestName },
            });
            resolvedNestId = nest.id;
        }
    }
    const egg = await prisma_1.prisma.egg.create({
        data: {
            uuid: (0, uuid_1.v4)(),
            author: 'admin@local',
            nestId: resolvedNestId,
            name,
            description: description || '',
            dockerImage,
            startup,
            configStop: configStop || '^C',
            scriptInstall: scriptInstall || null,
            variables: variables?.length
                ? {
                    create: variables.map((v) => ({
                        name: v.name,
                        envVariable: v.envVariable,
                        defaultValue: v.defaultValue || '',
                        description: v.description || '',
                        userViewable: v.userViewable !== false,
                        userEditable: v.userEditable !== false,
                    })),
                }
                : undefined,
        },
        include: { variables: true, nest: true },
    });
    return res.status(201).json({ data: egg });
});
// PUT /eggs/:id
router.put('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    try {
        const egg = await prisma_1.prisma.egg.findUnique({ where: { id: req.params.id } });
        if (!egg)
            return res.status(404).json({ message: 'Egg not found' });
        const { name, description, dockerImage, startup, configStop, scriptInstall } = req.body;
        const updated = await prisma_1.prisma.egg.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description }),
                ...(dockerImage && { dockerImage }),
                ...(startup && { startup }),
                ...(configStop !== undefined && { configStop }),
                ...(scriptInstall !== undefined && { scriptInstall: scriptInstall || null }),
            },
            include: { variables: true, nest: true },
        });
        return res.json({ data: updated });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update egg';
        return res.status(500).json({ message });
    }
});
// DELETE /eggs/:id
router.delete('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const egg = await prisma_1.prisma.egg.findUnique({ where: { id: req.params.id }, include: { _count: { select: { servers: true } } } });
    if (!egg)
        return res.status(404).json({ message: 'Egg not found' });
    if (egg._count.servers > 0)
        return res.status(400).json({ message: 'Cannot delete egg with active servers' });
    await prisma_1.prisma.egg.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});
// GET /eggs/:id
router.get('/:id', auth_1.authenticate, async (req, res) => {
    const egg = await prisma_1.prisma.egg.findUnique({
        where: { id: req.params.id },
        include: {
            nest: true,
            variables: true,
        },
    });
    if (!egg)
        return res.status(404).json({ message: 'Egg not found' });
    return res.json({ data: egg });
});
exports.default = router;
//# sourceMappingURL=eggs.js.map