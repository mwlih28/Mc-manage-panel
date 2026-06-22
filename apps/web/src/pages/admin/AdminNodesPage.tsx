import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Cpu, Trash2, Settings, Wifi, WifiOff, Copy, Check, Terminal } from 'lucide-react';
import api from '@/lib/axios';
import { Node } from '@/types';
import { formatBytes } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
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
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : nodes.length === 0 ? (
        <div className="card p-12 text-center">
          <Cpu size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium">No nodes configured</p>
          <p className="text-slate-500 text-sm mt-1">Add a node to start hosting servers</p>
        </div>
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
  const [tab, setTab] = useState<'configuration' | 'settings'>('configuration');
  const [form, setForm] = useState({
    name: node.name,
    description: node.description || '',
    fqdn: node.fqdn,
    scheme: node.scheme,
    daemonPort: String(node.daemonPort),
    memory: String(node.memory),
    disk: String(node.disk),
    memoryOverallocate: String(node.memoryOverallocate ?? 0),
    diskOverallocate: String(node.diskOverallocate ?? 0),
  });
  const [isLoading, setIsLoading] = useState(false);

  const installCmd = `bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/claude%2Fpterodactyl-panel-builder-8uy3tp/scripts/install-wings.sh)`;

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
        {(['configuration', 'settings'] as const).map((t) => (
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
          {/* Token */}
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

          {/* Panel URL */}
          <div>
            <label className="label">Panel URL</label>
            <p className="text-xs text-slate-500 mb-2">Enter this when the Wings installer asks for the panel URL.</p>
            <div className="flex items-center gap-2 bg-dark-950/80 border border-slate-700/50 rounded-lg px-3 py-2">
              <code className="flex-1 text-xs text-blue-400 font-mono break-all select-all">
                {window.location.origin}
              </code>
              <CopyButton text={window.location.origin} />
            </div>
          </div>

          {/* Install command */}
          <div>
            <label className="label flex items-center gap-2">
              <Terminal size={13} /> Wings Install Command
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Run this on your <strong className="text-slate-300">game server</strong> (not the panel server).
            </p>
            <div className="flex items-start gap-2 bg-dark-950/80 border border-slate-700/50 rounded-lg px-3 py-2.5">
              <code className="flex-1 text-xs text-slate-300 font-mono break-all select-all leading-relaxed">
                {installCmd}
              </code>
              <CopyButton text={installCmd} />
            </div>
          </div>

          {/* Steps */}
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-4 space-y-2">
            <p className="text-xs font-semibold text-blue-300">How to connect this node</p>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
              <li>SSH into your game server</li>
              <li>Run the Wings install command above</li>
              <li>Enter the Panel URL when prompted</li>
              <li>Enter the Node Token when prompted</li>
              <li>When install finishes, this node will show <span className="text-green-400">ONLINE</span></li>
            </ol>
          </div>
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
    port: '8080', daemonPort: '2022', memory: '', disk: '',
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
