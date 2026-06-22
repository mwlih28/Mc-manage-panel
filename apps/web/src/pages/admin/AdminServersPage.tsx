import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, ExternalLink, Pencil } from 'lucide-react';
import api from '@/lib/axios';
import { Server } from '@/types';
import { getServerStatusBadge, getServerStatusDot, formatDate } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

export function AdminServersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteServer, setDeleteServer] = useState<Server | null>(null);
  const [editServer, setEditServer] = useState<Server | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-servers', page, search],
    queryFn: () =>
      api.get('/servers', { params: { page, perPage: 15, search: search || undefined } })
        .then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/servers/${id}`),
    onSuccess: () => {
      toast.success('Server deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      setDeleteServer(null);
    },
    onError: () => toast.error('Failed to delete server'),
  });

  const servers: Server[] = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">All Servers</h1>
          <p className="text-slate-400 text-sm mt-1">{meta?.total || 0} total servers</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Server
        </button>
      </div>

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

      <div className="card">
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Owner</th>
                  <th>Node</th>
                  <th>Status</th>
                  <th>Resources</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-500">No servers found</td>
                  </tr>
                ) : (
                  servers.map((server) => (
                    <tr key={server.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${getServerStatusDot(server.status)}`} />
                          <div>
                            <p className="font-medium text-slate-200">{server.name}</p>
                            <p className="text-xs font-mono text-slate-500">{server.uuidShort}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        {server.user && (
                          <div>
                            <p className="text-slate-300">{server.user.username}</p>
                            <p className="text-xs text-slate-500">{server.user.email}</p>
                          </div>
                        )}
                      </td>
                      <td className="text-slate-400 text-sm">{server.node?.name}</td>
                      <td>
                        <span className={getServerStatusBadge(server.status)}>
                          {server.status}
                        </span>
                      </td>
                      <td className="text-xs text-slate-400">
                        <div>{server.memory} MB RAM</div>
                        <div>{server.disk} MB Disk</div>
                      </td>
                      <td className="text-slate-400 text-xs">{formatDate(server.createdAt)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <Link
                            to={`/servers/${server.id}`}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-panel-400 hover:bg-panel-500/10 transition-colors"
                          >
                            <ExternalLink size={14} />
                          </Link>
                          <button
                            className="p-1.5 rounded-lg text-slate-500 hover:text-panel-400 hover:bg-panel-500/10 transition-colors"
                            onClick={() => setEditServer(server)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            onClick={() => setDeleteServer(server)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta && meta.lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">Page {page} of {meta.lastPage}</p>
          <div className="flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Previous</button>
            <button className="btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={page === meta.lastPage}>Next</button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
          }}
        />
      )}

      {editServer && (
        <EditServerModal
          server={editServer}
          onClose={() => setEditServer(null)}
          onSuccess={() => {
            setEditServer(null);
            queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteServer}
        onClose={() => setDeleteServer(null)}
        onConfirm={() => deleteServer && deleteMutation.mutate(deleteServer.id)}
        title="Delete Server"
        message={`Are you sure you want to delete "${deleteServer?.name}"? All data will be lost.`}
        confirmLabel="Delete Server"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function CreateServerModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '', description: '', userId: '', nodeId: '', eggId: '',
    memory: '1024', disk: '5120', cpu: '100', backupLimit: '3',
  });
  const [isLoading, setIsLoading] = useState(false);

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users', { params: { perPage: 100 } }).then((r) => r.data.data),
  });
  const { data: nodesData } = useQuery({
    queryKey: ['nodes-list'],
    queryFn: () => api.get('/nodes').then((r) => r.data.data),
  });
  const { data: eggsData } = useQuery({
    queryKey: ['eggs-list'],
    queryFn: () => api.get('/eggs').then((r) => r.data.data),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.post('/servers', form);
      toast.success('Server created');
      onSuccess();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to create server');
    } finally {
      setIsLoading(false);
    }
  };

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal isOpen onClose={onClose} title="Create Server" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Server Name</label>
            <input className="input" placeholder="My Server" value={form.name} onChange={f('name')} required />
          </div>

          <div>
            <label className="label">Owner</label>
            <select className="input" value={form.userId} onChange={f('userId')} required>
              <option value="">Select user...</option>
              {(usersData || []).map((u: { id: string; username: string; email: string }) => (
                <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Node</label>
            <select className="input" value={form.nodeId} onChange={f('nodeId')} required>
              <option value="">Select node...</option>
              {(nodesData || []).map((n: { id: string; name: string }) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="label">Egg (Server Type)</label>
            <select className="input" value={form.eggId} onChange={f('eggId')} required>
              <option value="">Select egg...</option>
              {(eggsData || []).map((egg: { id: string; name: string }) => (
                <option key={egg.id} value={egg.id}>{egg.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Memory (MB)</label>
            <input type="number" className="input" value={form.memory} onChange={f('memory')} required />
          </div>

          <div>
            <label className="label">Disk Space (MB)</label>
            <input type="number" className="input" value={form.disk} onChange={f('disk')} required />
          </div>

          <div>
            <label className="label">CPU Limit (%)</label>
            <input type="number" className="input" value={form.cpu} onChange={f('cpu')} />
          </div>

          <div>
            <label className="label">Backup Limit</label>
            <input type="number" className="input" value={form.backupLimit} onChange={f('backupLimit')} />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
            {isLoading ? <Spinner size="sm" /> : 'Create Server'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditServerModal({ server, onClose, onSuccess }: { server: Server; onClose: () => void; onSuccess: () => void }) {
  const [image, setImage] = useState((server as Server & { image?: string }).image || 'ghcr.io/pterodactyl/yolks:java_21');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.patch(`/servers/${server.id}`, { image });
      toast.success('Server image updated. Restart the server to apply.');
      onSuccess();
    } catch {
      toast.error('Failed to update server');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Edit: ${server.name}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Docker Image</label>
          <input
            className="input font-mono"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="ghcr.io/pterodactyl/yolks:java_21"
            required
          />
          <p className="text-xs text-slate-500 mt-1">
            Use <code className="text-panel-400">ghcr.io/pterodactyl/yolks:java_21</code> for Paper 1.21+
          </p>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
            {isLoading ? <Spinner size="sm" /> : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
