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

// Points per server sparkline — enough to read a trend at a glance without
// bloating the dashboard payload when a user has many servers.
const SPARKLINE_POINTS = 24;
const SPARKLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

// GET /stats/overview - User's own stats
router.get('/overview', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [servers, runningServers] = await Promise.all([
    prisma.server.findMany({
      where: { userId },
      select: {
        id: true, uuidShort: true, name: true, status: true, memory: true, disk: true, cpu: true,
        node: { select: { id: true, name: true } },
      },
    }),
    prisma.server.count({ where: { userId, status: 'RUNNING' } }),
  ]);

  // One batched query for every server's last-24h CPU history, downsampled to
  // a handful of points each so the dashboard can render a per-row sparkline
  // without N follow-up requests. Only cpu + timestamp are selected to keep
  // the row set small; servers with no samples yet just get an empty trend.
  const serverIds = servers.map((s) => s.id);
  const trends: Record<string, number[]> = {};
  if (serverIds.length > 0) {
    const samples = await prisma.serverStatSample.findMany({
      where: { serverId: { in: serverIds }, timestamp: { gte: new Date(Date.now() - SPARKLINE_WINDOW_MS) } },
      select: { serverId: true, cpu: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });
    const grouped: Record<string, number[]> = {};
    for (const s of samples) (grouped[s.serverId] ||= []).push(s.cpu);
    for (const [id, series] of Object.entries(grouped)) {
      // Evenly downsample to at most SPARKLINE_POINTS, keeping chronological order.
      const step = Math.max(1, Math.ceil(series.length / SPARKLINE_POINTS));
      trends[id] = series.filter((_, i) => i % step === 0);
    }
  }

  const serversWithTrend = servers.map((s) => ({ ...s, cpuTrend: trends[s.id] || [] }));

  return res.json({
    data: {
      totalServers: servers.length,
      runningServers,
      servers: serversWithTrend,
    },
  });
});

export default router;
