import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Cpu, Trash2, Edit, Wifi, WifiOff } from 'lucide-react';
import api from '@/lib/axios';
import { Node } from '@/types';
import { formatBytes } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

export function AdminNodesPage() {
  const [showCreate, setShowCreate] = useState(false);
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
                <button className="btn-secondary btn-sm flex-1">
                  <Edit size={13} /> Edit
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
