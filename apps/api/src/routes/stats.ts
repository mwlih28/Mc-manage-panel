import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// GET /stats - Admin dashboard stats
router.get('/', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const [
    totalUsers, totalServers, totalNodes, totalAllocations,
    serversByStatus, recentActivity
  ] = await Promise.all([
    prisma.user.count(),
    prisma.server.count(),
    prisma.node.count(),
    prisma.allocation.count({ where: { assigned: true } }),
    prisma.server.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.activity.findMany({
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
      }, {} as Record<string, number>),
      recentActivity,
    },
  });
});

// GET /stats/overview - User's own stats
router.get('/overview', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [servers, runningServers] = await Promise.all([
    prisma.server.findMany({
      where: { userId },
      select: { id: true, name: true, status: true, memory: true, disk: true, cpu: true },
    }),
    prisma.server.count({ where: { userId, status: 'RUNNING' } }),
  ]);

  return res.json({
    data: {
      totalServers: servers.length,
      runningServers,
      servers,
    },
  });
});

export default router;
