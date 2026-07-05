import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, Rocket, ExternalLink } from 'lucide-react';
import api from '@/lib/axios';
import { ActivityLog, ServerStatus } from '@/types';
import { formatRelativeTime, getServerStatusDot } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import { MetricStrip, Metric } from '@/components/ui/MetricStrip';
import { StatusBreakdown } from '@/components/ui/StatusBreakdown';

export function AdminOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/stats').then((r) => r.data.data),
    refetchInterval: 10000,
  });
  const { data: updateCheck } = useUpdateCheck();

  if (isLoading) return (
    <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  );

  const totals = data?.totals || {};
  const serversByStatus: Record<string, number> = data?.serversByStatus || {};
  const activities: ActivityLog[] = data?.recentActivity || [];

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Admin Overview</h1>
        <p className="text-slate-500 text-xs mt-1">Panel statistics and activity</p>
      </div>

      {updateCheck?.updateAvailable && (
        <div className="card p-4 flex items-center gap-3 border-panel-500/30 bg-panel-500/[0.06]">
          <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-panel-500/15 text-panel-400">
            <Rocket size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">
              Update available — {updateCheck.latestVersion}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              You're running {updateCheck.currentVersion}. Update with{' '}
              <code className="font-mono text-panel-300">bash &lt;(curl -fsSL https://get.kretase.com/update-panel)</code>
            </p>
          </div>
          {updateCheck.releaseUrl && (
            <a
              href={updateCheck.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary btn-sm shrink-0"
            >
              Changelog <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {/* Dense metric strip */}
      <MetricStrip columns={4}>
        <Metric label="Total Users" value={totals.users || 0} color="bg-panel-400" />
        <Metric label="Total Servers" value={totals.servers || 0} color="bg-blue-400" />
        <Metric label="Active Nodes" value={totals.nodes || 0} color="bg-green-400" />
        <Metric label="Used Allocations" value={totals.allocations || 0} color="bg-orange-400" />
      </MetricStrip>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Server status breakdown */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-100">Servers by Status</h2>
          </div>
          <div className="card-body">
            <StatusBreakdown
              counts={serversByStatus}
              dotClass={(status) => getServerStatusDot(status as ServerStatus)}
            />
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-100">Recent Activity</h2>
          </div>
          <div className="divide-y divide-dark-800 max-h-64 overflow-y-auto scrollbar-none">
            {activities.length === 0 ? (
              <p className="p-4 text-slate-500 text-sm">No recent activity</p>
            ) : (
              activities.map((activity) => (
                <div key={activity.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="mt-0.5">
                    {activity.event.startsWith('auth:') ? (
                      <CheckCircle size={14} className="text-green-400" />
                    ) : activity.event.includes('delete') ? (
                      <XCircle size={14} className="text-red-400" />
                    ) : (
                      <Activity size={14} className="text-panel-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 font-medium">{activity.event}</p>
                    {activity.user && (
                      <p className="text-xs text-slate-500">by {activity.user.username}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-600 shrink-0">
                    {formatRelativeTime(activity.timestamp)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
