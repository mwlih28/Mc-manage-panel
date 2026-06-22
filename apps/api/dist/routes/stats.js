"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /stats - Admin dashboard stats
router.get('/', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const [totalUsers, totalServers, totalNodes, totalAllocations, serversByStatus, recentActivity] = await Promise.all([
        prisma_1.prisma.user.count(),
        prisma_1.prisma.server.count(),
        prisma_1.prisma.node.count(),
        prisma_1.prisma.allocation.count({ where: { assigned: true } }),
        prisma_1.prisma.server.groupBy({ by: ['status'], _count: { status: true } }),
        prisma_1.prisma.activity.findMany({
            include: { user: { select: { username: true, email: true } } },
            orderBy: { timestamp: 'desc' },
            take: 20,
        }),
    ]);
    return res.json({
        data: {
            totals: { users: totalUsers, servers: totalServers, nodes: totalNodes, allocations: totalAllocations },
            serversByStatus: serversByStatus.reduce((acc, item) => {
                acc[item.status] = item._count.status;
                return acc;
            }, {}),
            recentActivity,
        },
    });
});
// GET /stats/overview - User's own stats
router.get('/overview', auth_1.authenticate, async (req, res) => {
    const userId = req.user.id;
    const [servers, runningServers] = await Promise.all([
        prisma_1.prisma.server.findMany({
            where: { userId },
            select: { id: true, name: true, status: true, memory: true, disk: true, cpu: true },
        }),
        prisma_1.prisma.server.count({ where: { userId, status: 'RUNNING' } }),
    ]);
    return res.json({
        data: {
            totalServers: servers.length,
            runningServers,
            servers,
        },
    });
});
exports.default = router;
//# sourceMappingURL=stats.js.map