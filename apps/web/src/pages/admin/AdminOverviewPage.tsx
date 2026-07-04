import { useQuery } from '@tanstack/react-query';
import { Users, Server, Cpu, Activity, CheckCircle, XCircle, Rocket, ExternalLink } from 'lucide-react';
import api from '@/lib/axios';
import { ActivityLog } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';

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
  const serversByStatus = data?.serversByStatus || {};
  const activities: ActivityLog[] = data?.recentActivity || [];

  const statsCards = [
    { label: 'Total Users', value: totals.users || 0, icon: <Users size={20} />, color: 'panel' },
    { label: 'Total Servers', value: totals.servers || 0, icon: <Server size={20} />, color: 'blue' },
    { label: 'Active Nodes', value: totals.nodes || 0, icon: <Cpu size={20} />, color: 'green' },
    { label: 'Used Allocations', value: totals.allocations || 0, icon: <Activity size={20} />, color: 'orange' },
  ];

  const colorMap: Record<string, string> = {
    panel: 'bg-panel-500/20 text-panel-400',
    blue: 'bg-blue-500/20 text-blue-400',
    green: 'bg-green-500/20 text-green-400',
    orange: 'bg-orange-500/20 text-orange-400',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Admin Overview</h1>
        <p className="text-slate-400 text-sm mt-1">Panel statistics and activity</p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((card) => (
          <div key={card.label} className="stat-card">
            <div className={`stat-icon ${colorMap[card.color]}`}>
              <span>{card.icon}</span>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">{card.label}</p>
              <p className="text-2xl font-bold text-slate-100">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Server status breakdown */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-slate-100">Servers by Status</h2>
          </div>
          <div className="card-body space-y-2">
            {Object.entries(serversByStatus).length === 0 ? (
              <p className="text-slate-500 text-sm">No servers</p>
            ) : (
              Object.entries(serversByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm text-slate-400 capitalize">{status.toLowerCase()}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 progress-bar">
                      <div
                        className="progress-fill bg-panel-500"
                        style={{ width: `${((count as number) / (totals.servers || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-300 w-4 text-right">
                      {count as number}
                    </span>
                  </div>
                </div>
              ))
            )}
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
