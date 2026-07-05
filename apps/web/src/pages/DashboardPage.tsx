import { useQuery } from '@tanstack/react-query';
import { Server, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { Server as ServerType, ServerStatus } from '@/types';
import { getServerStatusDot, getServerStatusBadge, formatBytes } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { MetricStrip, Metric } from '@/components/ui/MetricStrip';
import { StatusBreakdown } from '@/components/ui/StatusBreakdown';

export function DashboardPage() {
  const { user } = useAuthStore();

  const { data: overview, isLoading } = useQuery({
    queryKey: ['stats-overview'],
    queryFn: () => api.get('/stats/overview').then((r) => r.data.data),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
  );

  const servers: ServerType[] = overview?.servers || [];
  const running = servers.filter((s) => s.status === 'RUNNING').length;
  const suspended = servers.filter((s) => s.status === 'SUSPENDED').length;
  const totalRam = servers.reduce((a, s) => a + (s.memory || 0) * 1048576, 0);
  const totalDisk = servers.reduce((a, s) => a + (s.disk || 0) * 1048576, 0);

  const statusCounts = servers.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {} as Partial<Record<ServerStatus, number>>);

  const byNode = servers.reduce((acc, s) => {
    const key = s.node?.name || 'Unassigned';
    if (!acc[key]) acc[key] = { total: 0, running: 0 };
    acc[key].total += 1;
    if (s.status === 'RUNNING') acc[key].running += 1;
    return acc;
  }, {} as Record<string, { total: number; running: number }>);
  const nodeCount = Object.keys(byNode).length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            Welcome back, <span className="text-gradient">{user?.firstName}</span>
          </h1>
          <p className="text-slate-500 text-xs mt-1 font-mono">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link to="/servers" className="btn-secondary btn-sm mt-1">
          Manage Servers <ChevronRight size={13} />
        </Link>
      </div>

      {/* Dense metric strip */}
      <MetricStrip>
        <Metric label="Total Servers" value={servers.length} color="bg-zinc-400" />
        <Metric label="Running" value={running} color="bg-green-400" />
        <Metric label="Suspended" value={suspended} color="bg-red-400" />
        <Metric label="Nodes" value={nodeCount} color="bg-yellow-400" />
        <Metric label="Total RAM" value={formatBytes(totalRam)} color="bg-panel-400" />
        <Metric label="Total Disk" value={formatBytes(totalDisk)} color="bg-blue-400" />
      </MetricStrip>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Servers table */}
        <div className="card xl:col-span-2">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Your Servers</h2>
            <Link to="/servers" className="text-xs text-panel-400 hover:text-panel-300 transition-colors flex items-center gap-1">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          {servers.length === 0 ? (
            <div className="p-10 text-center text-slate-600">
              <Server size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No servers yet</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Node</th>
                    <th className="text-right">RAM</th>
                    <th className="text-right hidden sm:table-cell">Disk</th>
                    <th className="text-right hidden sm:table-cell">CPU</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {servers.map((server) => (
                    <tr key={server.id} className="group">
                      <td>
                        <Link to={`/servers/${server.id}`} className="flex items-center gap-2.5 min-w-0">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${getServerStatusDot(server.status)}`} />
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-200 group-hover:text-white truncate text-sm">
                              {server.name}
                            </span>
                            <span className="block text-[11px] text-slate-600 font-mono">{server.uuidShort}</span>
                          </span>
                        </Link>
                      </td>
                      <td><span className={getServerStatusBadge(server.status)}>{server.status}</span></td>
                      <td className="hidden md:table-cell text-slate-500 text-xs">{server.node?.name || '—'}</td>
                      <td className="text-right font-mono text-xs text-slate-400">{server.memory} MB</td>
                      <td className="text-right hidden sm:table-cell font-mono text-xs text-slate-400">{server.disk} MB</td>
                      <td className="text-right hidden sm:table-cell font-mono text-xs text-slate-400">{server.cpu > 0 ? `${server.cpu}%` : '∞'}</td>
                      <td className="text-right">
                        <Link to={`/servers/${server.id}`}>
                          <ChevronRight size={14} className="text-slate-700 group-hover:text-slate-500 transition-colors" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Status breakdown */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-slate-200">Status Breakdown</h2>
            </div>
            <div className="card-body">
              <StatusBreakdown
                counts={statusCounts as Record<string, number>}
                dotClass={(status) => getServerStatusDot(status as ServerStatus)}
              />
            </div>
          </div>

          {/* By node */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-slate-200">Servers by Node</h2>
            </div>
            <div className="card-body space-y-2">
              {Object.keys(byNode).length === 0 ? (
                <p className="text-xs text-slate-600">No data yet</p>
              ) : (
                Object.entries(byNode).map(([node, stat]) => (
                  <div key={node} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 truncate">{node}</span>
                    <span className="font-mono text-slate-300">
                      <span className="text-green-400">{stat.running}</span>
                      <span className="text-slate-600">/{stat.total}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
