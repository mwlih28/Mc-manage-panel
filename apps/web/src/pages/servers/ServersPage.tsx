import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Server, Search, ChevronRight } from 'lucide-react';
import api from '@/lib/axios';
import { Server as ServerType } from '@/types';
import { getServerStatusDot, getServerStatusBadge } from '@/lib/utils';
import { TableSkeleton } from '@/components/ui/Skeleton';

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
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Servers</h1>
          <p className="text-slate-500 text-xs mt-1">Manage your game servers</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          className="input pl-9"
          placeholder="Search servers..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Servers table */}
      <div className="card">
        {isLoading ? (
          <TableSkeleton rows={8} columns={5} />
        ) : servers.length === 0 ? (
          <div className="p-12 text-center">
            <Server size={40} className="mx-auto text-slate-600 mb-3 opacity-40" />
            <p className="text-slate-300 font-medium text-sm">No servers found</p>
            <p className="text-slate-500 text-xs mt-1">
              {search ? 'Try a different search term' : 'You have no servers yet'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Node</th>
                  <th className="hidden lg:table-cell">Egg</th>
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
                    <td className="hidden lg:table-cell text-slate-500 text-xs">{server.egg?.name || '—'}</td>
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

      {/* Pagination */}
      {meta && meta.lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
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
