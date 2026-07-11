import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Cpu, Trash2, Settings, Wifi, WifiOff, Copy, Check, Terminal, Network, RefreshCw, Zap, ChevronDown } from 'lucide-react';
import api from '@/lib/axios';
import { Node } from '@/types';

interface Allocation {
  id: string;
  ip: string;
  port: number;
  assigned: boolean;
  server?: { id: string; name: string };
}
import { formatBytes, formatRelativeTime } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

export function AdminNodesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [deleteNode, setDeleteNode] = useState<Node | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-nodes'],
    queryFn: () => api.get('/nodes').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (nodeId: string) => api.delete(`/nodes/${nodeId}`),
    onSuccess: () => {
      toast.success('Node deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-nodes'] });
      setDeleteNode(null);
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to delete node');
    },
  });

  const nodes: Node[] = data?.data || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Nodes</h1>
          <p className="text-slate-400 text-sm mt-1">{nodes.length} nodes configured</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Node
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={4} />
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No nodes configured"
          description="Add a node to start hosting servers"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {nodes.map((node) => (
            <div key={node.id} className="card p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-lg ${node.status === 'ONLINE' ? 'bg-green-500/20' : 'bg-slate-500/20'}`}>
                    <Cpu size={18} className={node.status === 'ONLINE' ? 'text-green-400' : 'text-slate-400'} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-100">{node.name}</p>
                    <p className="text-xs text-slate-500">{node.fqdn}:{node.daemonPort}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${node.status === 'ONLINE' ? 'badge-green' : 'badge-gray'}`}>
                    {node.status === 'ONLINE' ? <Wifi size={10} /> : <WifiOff size={10} />}
                    {node.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <ResourceBox label="Memory" value={formatBytes(node.memory * 1048576)} />
                <ResourceBox label="Disk" value={formatBytes(node.disk * 1048576)} />
                <ResourceBox label="Servers" value={String(node._count?.servers || 0)} />
              </div>

              <DiskUsageBar node={node} />

              {node.maintenanceMode && (
                <div className="px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs text-center">
                  Maintenance mode active
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button className="btn-secondary btn-sm flex-1" onClick={() => setEditNode(node)}>
                  <Settings size={13} /> Configure
                </button>
                <button
                  className="btn-danger btn-sm"
                  onClick={() => setDeleteNode(node)}
                  disabled={(node._count?.servers || 0) > 0}
                  title={(node._count?.servers || 0) > 0 ? 'Cannot delete node with servers' : 'Delete node'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateNodeModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['admin-nodes'] });
          }}
        />
      )}

      {editNode && (
        <NodeDetailModal
          node={editNode}
          onClose={() => setEditNode(null)}
          onSuccess={() => {
            setEditNode(null);
            queryClient.invalidateQueries({ queryKey: ['admin-nodes'] });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteNode}
        onClose={() => setDeleteNode(null)}
        onConfirm={() => deleteNode && deleteMutation.mutate(deleteNode.id)}
        title="Delete Node"
        message={`Are you sure you want to delete node "${deleteNode?.name}"?`}
        confirmLabel="Delete Node"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

// Real host disk usage (the filesystem holding server data), refreshed
// every ~5 min by the API's background node monitor — distinct from the
// "Disk" ResourceBox above, which is just the admin-configured allocatable
// amount, not what's actually used on the host.
function DiskUsageBar({ node }: { node: Node }) {
  if (node.diskTotalBytes == null || node.diskUsedBytes == null) return null;
  const pct = node.diskTotalBytes > 0 ? (node.diskUsedBytes / node.diskTotalBytes) * 100 : 0;
  const level = node.diskAlertLevel || 'ok';
  const barColor = level === 'critical' ? 'bg-red-500' : level === 'warning' ? 'bg-yellow-500' : 'bg-panel-500';
  const textColor = level === 'critical' ? 'text-red-400' : level === 'warning' ? 'text-yellow-400' : 'text-slate-400';

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-500">Host disk usage</span>
        <span className={textColor}>
          {formatBytes(node.diskUsedBytes)} / {formatBytes(node.diskTotalBytes)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-dark-800 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {node.diskCheckedAt && (
        <p className="text-[10px] text-slate-600 mt-1">Checked {formatRelativeTime(node.diskCheckedAt)}</p>
      )}
    </div>
  );
}

function ResourceBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-dark-950/60 rounded-lg px-2 py-2">
      <p className="text-[10px] text-slate-500 font-medium">{label}</p>
      <p className="text-xs font-semibold text-slate-300 mt-0.5">{value}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  );
}

function NodeDetailModal({ node, onClose, onSuccess }: { node: Node; onClose: () => void; onSuccess: () => void }) {
  const [tab, setTab] = useState<'configuration' | 'allocations' | 'settings'>('configuration');
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: node.name,
    description: node.description || '',
    fqdn: node.fqdn,
    scheme: node.scheme,
    daemonPort: String(node.daemonPort),
    daemonSftp: String(node.daemonSftp ?? 2022),
    memory: String(node.memory),
    disk: String(node.disk),
    memoryOverallocate: String(node.memoryOverallocate ?? 0),
    diskOverallocate: String(node.diskOverallocate ?? 0),
    gameSubdomain: (node as typeof node & { gameSubdomain?: string }).gameSubdomain || '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [setupToken, setSetupToken] = useState(node.setupToken || null);
  const [setupTokenExpiresAt, setSetupTokenExpiresAt] = useState(node.setupTokenExpiresAt || null);
  const [regenerating, setRegenerating] = useState(false);

  const panelUrl = window.location.origin;
  const installCmd = `bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh)`;
  const isCodeExpired = !setupTokenExpiresAt || new Date(setupTokenExpiresAt) < new Date();
  const quickDeployCmd = setupToken && !isCodeExpired
    ? `bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/install-wings.sh) --panel=${panelUrl} --code=${setupToken}`
    : '';

  const regenerateCode = async () => {
    setRegenerating(true);
    try {
      const { data } = await api.post(`/nodes/${node.id}/regenerate-setup-token`);
      setSetupToken(data.setupToken);
      setSetupTokenExpiresAt(data.setupTokenExpiresAt);
      toast.success('New activation code generated');
    } catch {
      toast.error('Failed to generate activation code');
    } finally {
      setRegenerating(false);
    }
  };

  const { data: allocData, isLoading: allocLoading } = useQuery({
    queryKey: ['node-allocations', node.id],
    queryFn: () => api.get(`/nodes/${node.id}/allocations?perPage=100`).then((r) => r.data),
    enabled: tab === 'allocations',
  });
  const allocations: Allocation[] = allocData?.data || [];

  const [newIp, setNewIp] = useState('');
  const [newPorts, setNewPorts] = useState('');
  const [addingAlloc, setAddingAlloc] = useState(false);

  const addAllocations = async () => {
    const ip = newIp.trim();
    // Support "25565-25600" range notation as well as "25565, 25566" comma list
    let ports: number[] = [];
    const rangeMatch = newPorts.trim().match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1]);
      const to = parseInt(rangeMatch[2]);
      if (to > from && to - from <= 500) {
        ports = Array.from({ length: to - from + 1 }, (_, i) => from + i);
      }
    } else {
      ports = newPorts.split(',').map((p) => parseInt(p.trim())).filter((p) => !isNaN(p) && p > 0);
    }
    if (!ip || ports.length === 0) { toast.error('Enter IP and ports (e.g. 25565-25600 or 25565,25566)'); return; }
    setAddingAlloc(true);
    try {
      await api.post(`/nodes/${node.id}/allocations`, { ip, ports });
      toast.success(`Added ${ports.length} allocation(s)`);
      setNewIp(''); setNewPorts('');
      queryClient.invalidateQueries({ queryKey: ['node-allocations', node.id] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to add allocations');
    } finally { setAddingAlloc(false); }
  };

  const deleteAllocation = async (allocId: string) => {
    try {
      await api.delete(`/nodes/${node.id}/allocations/${allocId}`);
      queryClient.invalidateQueries({ queryKey: ['node-allocations', node.id] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to delete allocation');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.patch(`/nodes/${node.id}`, form);
      toast.success('Node updated');
      onSuccess();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to update node');
    } finally {
      setIsLoading(false);
    }
  };

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal isOpen onClose={onClose} title={node.name} size="lg">
      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-700/50 -mt-1">
        {(['configuration', 'allocations', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'configuration' && (
        <div className="space-y-4">
          {/* Quick deploy — one command, no manual copy/paste of token/URL/FQDN */}
          <div className="rounded-lg border border-panel-500/30 bg-panel-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Zap size={14} className="text-panel-400" /> Quick Deploy
              </p>
              <button
                type="button"
                onClick={regenerateCode}
                disabled={regenerating}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                title="Generate a new activation code"
              >
                <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} /> New code
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Paste this into your game server's terminal — it fetches the panel URL, token, and
              node config automatically, no manual copy/paste required.
            </p>
            {quickDeployCmd ? (
              <div className="flex items-start gap-2 bg-dark-950/80 border border-slate-700/50 rounded-lg px-3 py-2.5">
                <code className="flex-1 text-xs text-panel-300 font-mono break-all select-all leading-relaxed">
                  {quickDeployCmd}
                </code>
                <CopyButton text={quickDeployCmd} />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 bg-dark-950/80 border border-yellow-500/20 rounded-lg px-3 py-2.5">
                <span className="text-xs text-yellow-400">This node's activation code has expired.</span>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={regenerateCode} disabled={regenerating}>
                  {regenerating ? <Spinner size="sm" /> : 'Generate code'}
                </button>
              </div>
            )}
            {quickDeployCmd && setupTokenExpiresAt && (
              <p className="text-[11px] text-slate-500">
                Expires {new Date(setupTokenExpiresAt).toLocaleString()} — codes are single-node and safe to regenerate anytime.
              </p>
            )}
          </div>

          {/* Steps */}
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-4 space-y-2">
            <p className="text-xs font-semibold text-blue-300">How to connect this node</p>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
              <li>SSH into your game server (not the panel server)</li>
              <li>Paste the Quick Deploy command above</li>
              <li>When install finishes, this node will show <span className="text-green-400">ONLINE</span></li>
            </ol>
          </div>

          {/* Manual fallback */}
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          >
            <ChevronDown size={12} className={`transition-transform ${showManual ? 'rotate-180' : ''}`} />
            {showManual ? 'Hide manual setup' : 'Set up manually instead'}
          </button>

          {showManual && (
            <div className="space-y-4 pt-1">
              <div>
                <label className="label">Node Token</label>
                <p className="text-xs text-slate-500 mb-2">
                  Paste this token when running the Wings install script on your game server.
                </p>
                <div className="flex items-center gap-2 bg-dark-950/80 border border-slate-700/50 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-green-400 font-mono break-all select-all">
                    {node.token}
                  </code>
                  <CopyButton text={node.token} />
                </div>
              </div>

              <div>
                <label className="label">Panel URL</label>
                <p className="text-xs text-slate-500 mb-2">Enter this when the Wings installer asks for the panel URL.</p>
                <div className="flex items-center gap-2 bg-dark-950/80 border border-slate-700/50 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-blue-400 font-mono break-all select-all">
                    {panelUrl}
                  </code>
                  <CopyButton text={panelUrl} />
                </div>
              </div>

              <div>
                <label className="label flex items-center gap-2">
                  <Terminal size={13} /> Wings Install Command
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Run this on your <strong className="text-slate-300">game server</strong> (not the panel server), then enter the Panel URL and Node Token above when prompted.
                </p>
                <div className="flex items-start gap-2 bg-dark-950/80 border border-slate-700/50 rounded-lg px-3 py-2.5">
                  <code className="flex-1 text-xs text-slate-300 font-mono break-all select-all leading-relaxed">
                    {installCmd}
                  </code>
                  <CopyButton text={installCmd} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'allocations' && (
        <div className="space-y-4">
          {/* Add allocations */}
          <div className="rounded-lg border border-slate-700/50 p-4 space-y-3">
            <p className="text-sm font-medium text-slate-200 flex items-center gap-2"><Network size={14} /> Add Allocations</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">IP Address</label>
                <input className="input" placeholder="192.168.1.1" value={newIp} onChange={(e) => setNewIp(e.target.value)} />
              </div>
              <div>
                <label className="label">Ports (comma-separated)</label>
                <input className="input" placeholder="25565-25600 or 25565,25566" value={newPorts} onChange={(e) => setNewPorts(e.target.value)} />
              </div>
            </div>
            <button className="btn-primary btn-sm" onClick={addAllocations} disabled={addingAlloc}>
              {addingAlloc ? <Spinner size="sm" /> : <><Plus size={13} /> Add Ports</>}
            </button>
          </div>

          {/* Allocation list */}
          {allocLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : allocations.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-sm">No allocations yet. Add at least one port above.</div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {allocations.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark-950/60">
                  <div className="flex items-center gap-3">
                    <code className="text-xs font-mono text-slate-300">{a.ip}:{a.port}</code>
                    {a.assigned
                      ? <span className="badge badge-blue text-[10px]">{a.server?.name || 'in use'}</span>
                      : <span className="badge badge-green text-[10px]">free</span>}
                  </div>
                  {!a.assigned && (
                    <button className="btn-danger btn-sm py-0.5 px-2" onClick={() => deleteAllocation(a.id)}>
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Node Name</label>
              <input className="input" value={form.name} onChange={f('name')} required />
            </div>
            <div className="col-span-2">
              <label className="label">Description</label>
              <input className="input" value={form.description} onChange={f('description')} />
            </div>
            <div className="col-span-2">
              <label className="label">FQDN / IP Address</label>
              <input className="input" value={form.fqdn} onChange={f('fqdn')} required />
            </div>
            <div className="col-span-2">
              <label className="label">Game Subdomain <span className="text-slate-500 font-normal">(optional)</span></label>
              <input className="input" placeholder="mc.hksg.qzz.io" value={form.gameSubdomain} onChange={f('gameSubdomain')} />
              <p className="text-xs text-slate-500 mt-1">
                Set up a wildcard DNS record: <code className="text-panel-400">*.mc.hksg.qzz.io → {node.fqdn}</code>. Servers will show as <code className="text-panel-400">{`{uuid}.mc.hksg.qzz.io`}</code>.
              </p>
            </div>
            <div>
              <label className="label">Scheme</label>
              <select className="input" value={form.scheme} onChange={f('scheme')}>
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div>
              <label className="label">Daemon Port</label>
              <input type="number" className="input" value={form.daemonPort} onChange={f('daemonPort')} />
            </div>
            <div>
              <label className="label">SFTP Port</label>
              <input type="number" className="input" value={form.daemonSftp} onChange={f('daemonSftp')} />
            </div>
            <div>
              <label className="label">Total Memory (MB)</label>
              <input type="number" className="input" value={form.memory} onChange={f('memory')} required />
            </div>
            <div>
              <label className="label">Total Disk (MB)</label>
              <input type="number" className="input" value={form.disk} onChange={f('disk')} required />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
              {isLoading ? <Spinner size="sm" /> : 'Save Changes'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function CreateNodeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: '', description: '', fqdn: '', scheme: 'https',
    port: '8080', daemonPort: '2022', daemonSftp: '2022', memory: '', disk: '',
    memoryOverallocate: '0', diskOverallocate: '0',
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.post('/nodes', form);
      toast.success('Node created');
      onSuccess();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to create node');
    } finally {
      setIsLoading(false);
    }
  };

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal isOpen onClose={onClose} title="Create Node" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Node Name</label>
            <input className="input" placeholder="Node 01" value={form.name} onChange={f('name')} required />
          </div>
          <div className="col-span-2">
            <label className="label">Description</label>
            <input className="input" placeholder="Primary node" value={form.description} onChange={f('description')} />
          </div>
          <div className="col-span-2">
            <label className="label">FQDN / IP Address</label>
            <input className="input" placeholder="node1.example.com" value={form.fqdn} onChange={f('fqdn')} required />
          </div>
          <div>
            <label className="label">Scheme</label>
            <select className="input" value={form.scheme} onChange={f('scheme')}>
              <option value="https">HTTPS</option>
              <option value="http">HTTP</option>
            </select>
          </div>
          <div>
            <label className="label">Daemon Port</label>
            <input type="number" className="input" value={form.daemonPort} onChange={f('daemonPort')} />
          </div>
          <div>
            <label className="label">SFTP Port</label>
            <input type="number" className="input" value={form.daemonSftp} onChange={f('daemonSftp')} />
          </div>
          <div>
            <label className="label">Total Memory (MB)</label>
            <input type="number" className="input" placeholder="8192" value={form.memory} onChange={f('memory')} required />
          </div>
          <div>
            <label className="label">Total Disk (MB)</label>
            <input type="number" className="input" placeholder="51200" value={form.disk} onChange={f('disk')} required />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={isLoading}>
            {isLoading ? <Spinner size="sm" /> : 'Create Node'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
