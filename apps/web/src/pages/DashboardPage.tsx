import { useQuery } from '@tanstack/react-query';
import { Server, Activity, HardDrive, Cpu, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { Server as ServerType } from '@/types';
import { getServerStatusDot, getServerStatusBadge, formatBytes } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Welcome back, <span className="text-gradient">{user?.firstName}</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {running > 0 ? `${running} of ${servers.length} servers online` : 'All servers offline'}
            {' · '}
            <span className="text-slate-600">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          </p>
        </div>
        <Link
          to="/servers"
          className="btn-secondary btn-sm mt-1"
        >
          Manage Servers <ChevronRight size={13} />
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Server size={22} />}
          label="Total Servers"
          value={overview?.totalServers || 0}
        />
        <StatCard
          icon={<Activity size={22} />}
          label="Running"
          value={running}
        />
        <StatCard
          icon={<HardDrive size={22} />}
          label="Total RAM"
          value={formatBytes(servers.reduce((a, s) => a + (s.memory || 0) * 1048576, 0))}
        />
        <StatCard
          icon={<Cpu size={22} />}
          label="Total Disk"
          value={formatBytes(servers.reduce((a, s) => a + (s.disk || 0) * 1048576, 0))}
        />
      </div>

      {/* Servers */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Your Servers</h2>
          <Link to="/servers" className="text-xs text-panel-400 hover:text-panel-300 transition-colors flex items-center gap-1">
            View all <ChevronRight size={12} />
          </Link>
        </div>
        <div>
          {servers.length === 0 ? (
            <div className="p-10 text-center text-slate-600">
              <Server size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No servers yet</p>
            </div>
          ) : (
            servers.map((server) => (
              <Link
                key={server.id}
                to={`/servers/${server.id}`}
                className="flex items-center gap-4 px-6 py-4 transition-colors group"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${getServerStatusDot(server.status)}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-200 group-hover:text-white truncate text-sm">
                    {server.name}
                  </p>
                  <p className="text-xs text-slate-600 font-mono mt-0.5">{server.uuidShort}</p>
                </div>
                <span className={getServerStatusBadge(server.status)}>
                  {server.status}
                </span>
                <div className="hidden sm:flex items-center gap-4 text-xs text-slate-600">
                  {server.allocation && (
                    <span className="font-mono text-slate-500">
                      {(server.node as typeof server.node & { gameSubdomain?: string })?.gameSubdomain
                        ? `${server.uuidShort}.${(server.node as typeof server.node & { gameSubdomain?: string }).gameSubdomain}:${server.allocation.port}`
                        : `${server.allocation.ip}:${server.allocation.port}`}
                    </span>
                  )}
                  <span>{formatBytes((server.memory || 0) * 1048576)} RAM</span>
                </div>
                <ChevronRight size={14} className="text-slate-700 group-hover:text-slate-500 transition-colors shrink-0" />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: {
  icon: React.ReactNode; label: string; value: string | number;
}) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center bg-panel-500/10 border border-panel-500/20 text-panel-400">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5 leading-none">{value}</p>
      </div>
    </div>
  );
}
