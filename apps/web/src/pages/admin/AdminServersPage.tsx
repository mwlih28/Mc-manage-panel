import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, ExternalLink, Pencil, Zap } from 'lucide-react';
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
    refetchInterval: (query) => {
      const list = (query.state.data as { data?: Server[] } | undefined)?.data || [];
      return list.some((s) => s.status === 'MIGRATING') ? 4000 : false;
    },
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

interface ServerTemplate {
  id: string;
  name: string;
  description?: string;
  memory?: number;
  disk?: number;
  cpu?: number;
  env?: Record<string, string>;
}

// Maps a template's SERVER_TYPE env value to the matching egg's name, so
// picking a template also selects the right egg instead of leaving whatever
// (or nothing) was previously selected.
const TEMPLATE_SERVER_TYPE_TO_EGG_NAME: Record<string, string> = {
  PAPER: 'paper',
  BEDROCK: 'minecraft bedrock',
  FABRIC: 'fabric',
};

function CreateServerModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '', description: '', userId: '', nodeId: '', eggId: '',
    memory: '1024', disk: '5120', cpu: '0', backupLimit: '3',
  });
  const [paperVersion, setPaperVersion] = useState('latest');
  const [paperVersions, setPaperVersions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateEnv, setTemplateEnv] = useState<Record<string, string>>({});

  // Fetch templates
  const { data: templatesData } = useQuery({
    queryKey: ['server-templates'],
    queryFn: () => api.get('/templates').then((r) => r.data.data ?? r.data ?? []).catch(() => []),
  });
  const templates: ServerTemplate[] = templatesData || [];

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

  // Derive selected egg type
  const eggs: { id: string; name: string }[] = eggsData || [];
  const selectedEgg = eggs.find((e) => e.id === form.eggId);
  const isPaperEgg = selectedEgg?.name?.toLowerCase() === 'paper';
  const isBedrockEgg = selectedEgg?.name?.toLowerCase().includes('bedrock') ?? false;

  // Fetch Paper versions via our own backend (PaperMC's API requires a real
  // User-Agent header, which browsers won't let client-side fetch set).
  useEffect(() => {
    if (!isPaperEgg) return;
    api.get('/paper/versions', { timeout: 10000 })
      .then(({ data }) => { if (data.versions) setPaperVersions(data.versions); })
      .catch(() => {/* ignore */});
  }, [isPaperEgg]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await api.post('/servers', { ...form, env: templateEnv });
      const serverId: string = res.data?.data?.id;
      // Install selected Paper version right after creation (only for Paper egg)
      if (isPaperEgg && serverId && paperVersion && paperVersion !== 'latest') {
        try {
          await api.post(`/servers/${serverId}/version`, { version: paperVersion }, { timeout: 180000 });
          await api.patch(`/servers/${serverId}`, { mcVersion: paperVersion }).catch(() => {});
          toast.success(`Server created with Paper ${paperVersion}`);
        } catch {
          toast.success('Server created (version install failed — use Versions tab to install manually)');
        }
      } else {
        toast.success('Server created');
      }
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

  const applyTemplate = (template: ServerTemplate) => {
    setSelectedTemplate(template.id);
    setTemplateEnv(template.env || {});

    // Match the template's SERVER_TYPE to an actual egg so creating from a
    // template doesn't leave the egg (and therefore the install script)
    // unset — that was leaving MC_VERSION unpassed and install scripts
    // failing on templated servers.
    const serverType = template.env?.SERVER_TYPE;
    const eggNameMatch = serverType ? TEMPLATE_SERVER_TYPE_TO_EGG_NAME[serverType] : undefined;
    const matchedEgg = eggNameMatch ? eggs.find((e) => e.name.toLowerCase() === eggNameMatch) : undefined;

    setForm(prev => ({
      ...prev,
      memory: template.memory ? String(template.memory) : prev.memory,
      disk: template.disk ? String(template.disk) : prev.disk,
      cpu: template.cpu !== undefined ? String(template.cpu) : prev.cpu,
      eggId: matchedEgg ? matchedEgg.id : prev.eggId,
    }));

    if (serverType && !matchedEgg) {
      toast.error(`No egg found for ${serverType} — pick one manually`);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Create Server" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Quick Templates */}
        {templates.length > 0 && (
          <div className="rounded-xl border border-dark-700 bg-dark-800/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-panel-400" />
              <h3 className="text-sm font-semibold text-slate-100">Quick Templates</h3>
              <span className="text-xs text-slate-500">Select a template to pre-fill resources</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    selectedTemplate === tpl.id
                      ? 'border-panel-500/60 bg-panel-500/10 text-panel-300'
                      : 'border-dark-600 bg-dark-700/50 text-slate-300 hover:border-dark-500 hover:bg-dark-700'
                  }`}
                >
                  <p className="text-sm font-medium truncate">{tpl.name}</p>
                  {(tpl.memory || tpl.disk) && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {tpl.memory ? `${tpl.memory} MB RAM` : ''}{tpl.memory && tpl.disk ? ' · ' : ''}{tpl.disk ? `${tpl.disk} MB Disk` : ''}
                    </p>
                  )}
                  {tpl.description && (
                    <p className="text-xs text-slate-600 mt-0.5 truncate">{tpl.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

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
              {eggs.map((egg) => (
                <option key={egg.id} value={egg.id}>{egg.name}</option>
              ))}
            </select>
          </div>

          {/* Paper version — only shown for Paper egg */}
          {isPaperEgg && (
            <div className="col-span-2">
              <label className="label">Paper Version</label>
              <select className="input" value={paperVersion} onChange={(e) => setPaperVersion(e.target.value)}>
                <option value="latest">Latest (auto-download on first start)</option>
                {paperVersions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-500 mt-1">
                Specific version downloads the Paper JAR immediately after server creation.
              </p>
            </div>
          )}

          {/* Bedrock info */}
          {isBedrockEgg && (
            <div className="col-span-2 rounded-lg px-3 py-2.5 text-xs text-zinc-400" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2a2e' }}>
              Bedrock Dedicated Server (BDS) will be downloaded from Mojang automatically on first start.
              Players connect with Minecraft Bedrock/PE/Console edition on port <span className="font-mono text-zinc-200">19132 UDP</span>.
            </div>
          )}

          <div>
            <label className="label">Memory (MB)</label>
            <input type="number" className="input" value={form.memory} onChange={f('memory')} required />
          </div>

          <div>
            <label className="label">Disk Space (MB)</label>
            <input type="number" className="input" value={form.disk} onChange={f('disk')} required />
          </div>

          <div>
            <label className="label">CPU Limit <span className="text-zinc-500 font-normal">(% of 1 core, 0 = unlimited)</span></label>
            <input type="number" className="input" value={form.cpu} onChange={f('cpu')} placeholder="0" />
          </div>

          <div>
            <label className="label">Backup Limit</label>
            <input type="number" className="input" value={form.backupLimit} onChange={f('backupLimit')} />
          </div>
        </div>

        {!isBedrockEgg && (
          <p className="text-xs text-zinc-500 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
            The server owner will be asked to accept the Minecraft EULA the first time they start this server.
          </p>
        )}

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
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'general' | 'resources' | 'startup' | 'migrate' | 'danger'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isReinstalling, setIsReinstalling] = useState(false);
  const [migrateTargetNode, setMigrateTargetNode] = useState('');
  const [migrateAllocationId, setMigrateAllocationId] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);

  const srv = server as Server & { image?: string; startup?: string; cpu?: number; swap?: number; backupLimit?: number; allocationId?: string; allocation?: { id: string; ip: string; port: number } };

  const [general, setGeneral] = useState({
    name: server.name,
    description: (server as Server & { description?: string }).description || '',
    userId: server.user?.id || '',
    allocationId: srv.allocationId || '',
  });
  const [resources, setResources] = useState({
    memory: String(server.memory),
    disk: String(server.disk),
    cpu: String(srv.cpu ?? 0),
    backupLimit: String(srv.backupLimit ?? 0),
  });
  const [startup, setStartup] = useState({
    image: srv.image || 'ghcr.io/pterodactyl/yolks:java_21',
    startupCmd: srv.startup || '',
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users', { params: { perPage: 100 } }).then((r) => r.data.data),
  });
  const { data: allocationsData } = useQuery({
    queryKey: ['allocations-list', server.node?.id],
    queryFn: () => api.get(`/nodes/${server.node?.id}/allocations`, { params: { perPage: 100 } }).then((r) => r.data.data).catch(() => []),
    enabled: !!server.node?.id,
  });
  const { data: nodesData } = useQuery({
    queryKey: ['nodes-list'],
    queryFn: () => api.get('/nodes').then((r) => r.data.data),
  });
  const otherNodes: { id: string; name: string }[] = (nodesData || []).filter((n: { id: string }) => n.id !== server.node?.id);
  const { data: targetAllocationsData } = useQuery({
    queryKey: ['allocations-list', migrateTargetNode],
    queryFn: () => api.get(`/nodes/${migrateTargetNode}/allocations`, { params: { perPage: 100 } }).then((r) => r.data.data).catch(() => []),
    enabled: !!migrateTargetNode,
  });
  const freeTargetAllocations: { id: string; ip: string; port: number; assigned: boolean }[] =
    (targetAllocationsData || []).filter((a: { assigned: boolean }) => !a.assigned);

  const save = async (payload: Record<string, unknown>) => {
    setIsSaving(true);
    try {
      await api.patch(`/servers/${server.id}`, payload);
      toast.success('Server updated');
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      onSuccess();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to update server');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReinstall = async () => {
    if (!confirm(`Reinstall "${server.name}"? All server files will be deleted and the install script will run again.`)) return;
    setIsReinstalling(true);
    try {
      await api.post(`/servers/${server.id}/reinstall`, {});
      toast.success('Reinstall initiated — check the console for progress');
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      onClose();
    } catch {
      toast.error('Failed to initiate reinstall');
    } finally {
      setIsReinstalling(false);
    }
  };

  const handleMigrate = async () => {
    if (!migrateTargetNode) return;
    const targetName = otherNodes.find((n) => n.id === migrateTargetNode)?.name || 'the selected node';
    if (!confirm(`Migrate "${server.name}" to ${targetName}? The server will be stopped, its files copied over, and it will come back online on the new node.`)) return;
    setIsMigrating(true);
    try {
      await api.post(`/servers/${server.id}/migrate`, {
        targetNodeId: migrateTargetNode,
        allocationId: migrateAllocationId || undefined,
      });
      toast.success('Migration started — this can take a while for large worlds');
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to start migration');
    } finally {
      setIsMigrating(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'resources', label: 'Resources' },
    { id: 'startup', label: 'Startup' },
    { id: 'migrate', label: 'Migrate' },
    { id: 'danger', label: 'Danger Zone' },
  ] as const;

  return (
    <Modal isOpen onClose={onClose} title={`Manage: ${server.name}`} size="xl">
      <div className="flex gap-1 mb-5 border-b border-slate-700/50 -mx-1 px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium rounded-t transition-colors ${
              tab === t.id
                ? 'text-panel-400 border-b-2 border-panel-400 -mb-px'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="space-y-4">
          <div>
            <label className="label">Server Name</label>
            <input className="input" value={general.name} onChange={(e) => setGeneral({ ...general, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={general.description} onChange={(e) => setGeneral({ ...general, description: e.target.value })} placeholder="Optional description" />
          </div>
          <div>
            <label className="label">Owner</label>
            <select className="input" value={general.userId} onChange={(e) => setGeneral({ ...general, userId: e.target.value })}>
              <option value="">Select user...</option>
              {(usersData || []).map((u: { id: string; username: string; email: string }) => (
                <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Allocation (IP:Port)</label>
            <select className="input" value={general.allocationId} onChange={(e) => setGeneral({ ...general, allocationId: e.target.value })}>
              <option value="">Keep current ({srv.allocation ? `${srv.allocation.ip}:${srv.allocation.port}` : 'none'})</option>
              {(allocationsData || []).map((a: { id: string; ip: string; port: number; assigned: boolean }) => (
                <option key={a.id} value={a.id} disabled={a.assigned && a.id !== srv.allocationId}>
                  {a.ip}:{a.port}{a.assigned && a.id !== srv.allocationId ? ' (in use)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex-1" disabled={isSaving} onClick={() => save({
              name: general.name,
              description: general.description,
              userId: general.userId || undefined,
              allocationId: general.allocationId || undefined,
            })}>
              {isSaving ? <Spinner size="sm" /> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {tab === 'resources' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Memory (MB)</label>
              <input type="number" className="input" value={resources.memory} onChange={(e) => setResources({ ...resources, memory: e.target.value })} />
            </div>
            <div>
              <label className="label">Disk Space (MB)</label>
              <input type="number" className="input" value={resources.disk} onChange={(e) => setResources({ ...resources, disk: e.target.value })} />
            </div>
            <div>
              <label className="label">CPU Limit <span className="text-slate-500 font-normal">(% of 1 core, 0=unlimited)</span></label>
              <input type="number" className="input" value={resources.cpu} onChange={(e) => setResources({ ...resources, cpu: e.target.value })} />
            </div>
            <div>
              <label className="label">Backup Limit</label>
              <input type="number" className="input" value={resources.backupLimit} onChange={(e) => setResources({ ...resources, backupLimit: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex-1" disabled={isSaving} onClick={() => save({
              memory: resources.memory,
              disk: resources.disk,
              cpu: resources.cpu,
              backupLimit: resources.backupLimit,
            })}>
              {isSaving ? <Spinner size="sm" /> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {tab === 'startup' && (
        <div className="space-y-4">
          <div>
            <label className="label">Docker Image</label>
            <input className="input font-mono" value={startup.image} onChange={(e) => setStartup({ ...startup, image: e.target.value })} placeholder="ghcr.io/pterodactyl/yolks:java_21" />
            <p className="text-xs text-slate-500 mt-1">Use <code className="text-panel-400">ghcr.io/pterodactyl/yolks:java_21</code> for Paper 1.21+</p>
          </div>
          <div>
            <label className="label">Startup Command</label>
            <input className="input font-mono text-xs" value={startup.startupCmd} onChange={(e) => setStartup({ ...startup, startupCmd: e.target.value })} />
            <p className="text-xs text-slate-500 mt-1">Changes take effect on next server start.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex-1" disabled={isSaving} onClick={() => save({ image: startup.image, startup: startup.startupCmd })}>
              {isSaving ? <Spinner size="sm" /> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {tab === 'migrate' && (
        <div className="space-y-4">
          {server.status === 'MIGRATING' ? (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
              <h3 className="text-sm font-semibold text-cyan-400 mb-1">Migration in progress</h3>
              <p className="text-xs text-slate-400">
                This server is currently being moved to another node. Close this dialog and check back — the status badge will update once it's done.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-slate-400">
                Moves this server to a different node: stops it, snapshots its files, transfers them directly
                to the new node, then brings it back online there. The old copy is removed once the transfer succeeds.
                Existing backups won't carry over since they live on the old node's disk — take a fresh one after migrating if you need it.
              </div>
              {server.status === 'MIGRATION_FAILED' && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
                  The last migration attempt failed. The server is still on its original node — you can retry below.
                </div>
              )}
              <div>
                <label className="label">Destination Node</label>
                <select
                  className="input"
                  value={migrateTargetNode}
                  onChange={(e) => { setMigrateTargetNode(e.target.value); setMigrateAllocationId(''); }}
                >
                  <option value="">Select node...</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                {otherNodes.length === 0 && (
                  <p className="text-xs text-slate-500 mt-1">No other nodes available to migrate to.</p>
                )}
              </div>
              {migrateTargetNode && (
                <div>
                  <label className="label">Allocation on destination <span className="text-slate-500 font-normal">(optional)</span></label>
                  <select className="input" value={migrateAllocationId} onChange={(e) => setMigrateAllocationId(e.target.value)}>
                    <option value="">Auto-pick a free allocation</option>
                    {freeTargetAllocations.map((a) => (
                      <option key={a.id} value={a.id}>{a.ip}:{a.port}</option>
                    ))}
                  </select>
                  {freeTargetAllocations.length === 0 && (
                    <p className="text-xs text-yellow-500 mt-1">No free allocations on this node — add one first or migration will fail.</p>
                  )}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
                <button
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors disabled:opacity-50 flex-1"
                  disabled={isMigrating || !migrateTargetNode}
                  onClick={handleMigrate}
                >
                  {isMigrating ? <Spinner size="sm" /> : 'Start Migration'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'danger' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
            <h3 className="text-sm font-semibold text-yellow-400 mb-1">Reinstall Server</h3>
            <p className="text-xs text-slate-400 mb-3">
              Deletes all server files and re-runs the install script. The server will be offline during reinstall.
              This action cannot be undone.
            </p>
            <button
              className="px-4 py-2 rounded-lg text-sm font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
              onClick={handleReinstall}
              disabled={isReinstalling}
            >
              {isReinstalling ? <Spinner size="sm" /> : 'Reinstall Server'}
            </button>
          </div>
          <p className="text-xs text-slate-500">To delete this server entirely, use the trash icon on the servers list.</p>
        </div>
      )}
    </Modal>
  );
}
