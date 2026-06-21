import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Server, Search, Plus, ChevronRight } from 'lucide-react';
import api from '@/lib/axios';
import { Server as ServerType } from '@/types';
import { getServerStatusDot, getServerStatusBadge, formatBytes } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

export function ServersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['servers', page, search],
    queryFn: () =>
      api.get('/servers', { params: { page, perPage: 15, search: search || undefined } })
        .then((r) => r.data),
  });

  const servers: ServerType[] = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Servers</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your game servers</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          className="input pl-9"
          placeholder="Search servers..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Servers grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : servers.length === 0 ? (
        <div className="card p-12 text-center">
          <Server size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium">No servers found</p>
          <p className="text-slate-500 text-sm mt-1">
            {search ? 'Try a different search term' : 'You have no servers yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Showing {(page - 1) * 15 + 1}–{Math.min(page * 15, meta.total)} of {meta.total}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary btn-sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
            >
              Previous
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page === meta.lastPage}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServerCard({ server }: { server: ServerType }) {
  return (
    <Link
      to={`/servers/${server.id}`}
      className="card hover:border-dark-700 hover:shadow-lg hover:shadow-dark-950/50 transition-all duration-200 group block"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-panel-500/20">
              <Server size={18} className="text-panel-400" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-100 group-hover:text-white truncate">
                {server.name}
              </p>
              <p className="text-xs font-mono text-slate-500">{server.uuidShort}</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400 transition-colors mt-1" />
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`h-2 w-2 rounded-full ${getServerStatusDot(server.status)}`} />
          <span className={`text-xs font-medium ${getServerStatusBadge(server.status).includes('green') ? 'text-green-400' : 'text-slate-400'}`}>
            {server.status}
          </span>
        </div>

        {/* Resources */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <ResourcePill label="RAM" value={`${server.memory} MB`} />
          <ResourcePill label="Disk" value={`${server.disk} MB`} />
          <ResourcePill label="CPU" value={server.cpu > 0 ? `${server.cpu}%` : '∞'} />
        </div>

        {/* Node/Egg */}
        {(server.node || server.egg) && (
          <div className="mt-3 pt-3 border-t border-dark-800 flex items-center justify-between text-xs text-slate-500">
            {server.node && <span className="truncate">Node: {server.node.name}</span>}
            {server.egg && <span className="truncate">Egg: {server.egg.name}</span>}
          </div>
        )}
      </div>
    </Link>
  );
}

function ResourcePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-dark-950/60 rounded-lg px-2 py-1.5">
      <p className="text-[10px] text-slate-500 font-medium">{label}</p>
      <p className="text-xs text-slate-300 font-semibold">{value}</p>
    </div>
  );
}
