import { useQuery } from '@tanstack/react-query';
import { Server, Activity, HardDrive, Cpu } from 'lucide-react';
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
      <div>
        <h1 className="text-2xl font-bold text-slate-100">
          Welcome back, {user?.firstName}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Here's an overview of your servers
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Server size={20} />}
          label="Total Servers"
          value={overview?.totalServers || 0}
          iconBg="bg-panel-500/20"
          iconColor="text-panel-400"
        />
        <StatCard
          icon={<Activity size={20} />}
          label="Running"
          value={running}
          iconBg="bg-green-500/20"
          iconColor="text-green-400"
        />
        <StatCard
          icon={<HardDrive size={20} />}
          label="Total RAM"
          value={formatBytes(servers.reduce((a, s) => a + s.memory * 1048576, 0))}
          iconBg="bg-blue-500/20"
          iconColor="text-blue-400"
        />
        <StatCard
          icon={<Cpu size={20} />}
          label="Total Disk"
          value={formatBytes(servers.reduce((a, s) => a + s.disk * 1048576, 0))}
          iconBg="bg-orange-500/20"
          iconColor="text-orange-400"
        />
      </div>

      {/* Servers */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Your Servers</h2>
          <Link to="/servers" className="text-xs text-panel-400 hover:text-panel-300 transition-colors">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-dark-800">
          {servers.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Server size={40} className="mx-auto mb-3 opacity-20" />
              <p>No servers yet</p>
            </div>
          ) : (
            servers.map((server) => (
              <Link
                key={server.id}
                to={`/servers/${server.id}`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-dark-800/50 transition-colors group"
              >
                <div className="relative">
                  <div className={`h-2.5 w-2.5 rounded-full ${getServerStatusDot(server.status)}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-200 group-hover:text-white truncate">
                    {server.name}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">{server.id.slice(0, 8)}</p>
                </div>
                <span className={getServerStatusBadge(server.status)}>
                  {server.status}
                </span>
                <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500">
                  {server.allocation && (
                    <span className="font-mono">
                      {(server.node as typeof server.node & { gameSubdomain?: string })?.gameSubdomain
                        ? `${server.uuidShort}.${(server.node as typeof server.node & { gameSubdomain?: string }).gameSubdomain}:${server.allocation.port}`
                        : `${server.allocation.ip}:${server.allocation.port}`}
                    </span>
                  )}
                  <span>{formatBytes(server.memory * 1048576)} RAM</span>
                  <span>{formatBytes(server.disk * 1048576)} Disk</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, iconBg, iconColor }: {
  icon: React.ReactNode; label: string; value: string | number;
  iconBg: string; iconColor: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <div>
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-slate-100 mt-0.5">{value}</p>
      </div>
    </div>
  );
}
