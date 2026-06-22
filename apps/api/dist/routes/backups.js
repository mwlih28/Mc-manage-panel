"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)({ mergeParams: true });
// GET /servers/:serverId/backups
router.get('/', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.serverId,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const backups = await prisma_1.prisma.backup.findMany({
        where: { serverId: server.id },
        orderBy: { createdAt: 'desc' },
    });
    return res.json({ data: backups });
});
// POST /servers/:serverId/backups
router.post('/', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.serverId,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const backupCount = await prisma_1.prisma.backup.count({
        where: { serverId: server.id },
    });
    if (server.backupLimit > 0 && backupCount >= server.backupLimit) {
        return res.status(400).json({ message: 'Backup limit reached' });
    }
    const { name, ignoredFiles } = req.body;
    const backup = await prisma_1.prisma.backup.create({
        data: {
            serverId: server.id,
            uuid: (0, uuid_1.v4)(),
            name: name || `Backup ${new Date().toISOString()}`,
            ignoredFiles: JSON.stringify(ignoredFiles || []),
            isSuccessful: false,
        },
    });
    // Simulate backup completion after creation
    setTimeout(async () => {
        await prisma_1.prisma.backup.update({
            where: { id: backup.id },
            data: {
                isSuccessful: true,
                bytes: Math.floor(Math.random() * 104857600) + 1048576,
                completedAt: new Date(),
                checksum: (0, uuid_1.v4)().replace(/-/g, ''),
            },
        });
    }, 3000);
    await prisma_1.prisma.activity.create({
        data: {
            userId: req.user.id,
            serverId: server.id,
            event: 'server:backup.start',
            ip: req.ip,
        },
    });
    return res.status(201).json({ data: backup });
});
// DELETE /servers/:serverId/backups/:backupId
router.delete('/:backupId', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.serverId,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const backup = await prisma_1.prisma.backup.findFirst({
        where: { id: req.params.backupId, serverId: server.id },
    });
    if (!backup)
        return res.status(404).json({ message: 'Backup not found' });
    if (backup.isLocked)
        return res.status(400).json({ message: 'Backup is locked' });
    await prisma_1.prisma.backup.delete({ where: { id: backup.id } });
    return res.status(204).send();
});
// POST /servers/:serverId/backups/:backupId/restore
router.post('/:backupId/restore', auth_1.authenticate, async (req, res) => {
    const isAdmin = req.user.role === 'ADMIN';
    const server = await prisma_1.prisma.server.findFirst({
        where: {
            id: req.params.serverId,
            ...(isAdmin ? {} : { userId: req.user.id }),
        },
    });
    if (!server)
        return res.status(404).json({ message: 'Server not found' });
    const backup = await prisma_1.prisma.backup.findFirst({
        where: { id: req.params.backupId, serverId: server.id, isSuccessful: true },
    });
    if (!backup)
        return res.status(404).json({ message: 'Backup not found or not successful' });
    await prisma_1.prisma.server.update({
        where: { id: server.id },
        data: { status: 'RESTORING_BACKUP' },
    });
    return res.json({ message: 'Restore initiated' });
});
exports.default = router;
//# sourceMappingURL=backups.js.map