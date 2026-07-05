import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Copy, Eye, EyeOff, RefreshCw, Download, ShoppingCart, X,
} from 'lucide-react';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

interface CommandMapping {
  packageId: string;
  command: string;
}

interface StoreIntegrationRow {
  id: string;
  provider: 'tebex' | 'craftingstore';
  name: string;
  serverId: string;
  server: { id: string; name: string };
  commandMappings: CommandMapping[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  lastStatus: 'success' | 'failed' | 'skipped' | null;
  lastError: string | null;
}

function StatusDot({ status }: { status: StoreIntegrationRow['lastStatus'] }) {
  const color = status === 'success' ? 'bg-panel-500' : status === 'failed' ? 'bg-red-500' : status === 'skipped' ? 'bg-amber-500' : 'bg-zinc-600';
  const title = status === 'success' ? 'Last purchase ran successfully' : status === 'failed' ? 'Last purchase failed' : status === 'skipped' ? 'Last purchase had no matching package mapping' : 'Never triggered';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={title} />;
}

export function AdminIntegrationsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editIntegration, setEditIntegration] = useState<StoreIntegrationRow | null>(null);
  const [deleteIntegration, setDeleteIntegration] = useState<StoreIntegrationRow | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-store-integrations'],
    queryFn: () => api.get('/store-integrations').then((r) => r.data.data as StoreIntegrationRow[]),
  });

  const { data: serversData } = useQuery({
    queryKey: ['admin-store-integration-servers'],
    queryFn: () => api.get('/servers', { params: { perPage: 100 } }).then((r) => r.data.data as { id: string; name: string }[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/store-integrations/${id}`),
    onSuccess: () => {
      toast.success('Integration deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-store-integrations'] });
      setDeleteIntegration(null);
    },
    onError: () => toast.error('Failed to delete integration'),
  });

  const integrations = data || [];
  const servers = serversData || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Billing & Store Integrations</h1>
        <p className="text-slate-400 text-sm mt-1">
          Plug Kretase into your billing panel or in-game store.
        </p>
      </div>

      {/* WHMCS / Blesta */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100">Billing Panel Modules</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            WHMCS and Blesta call these modules on order/suspend/terminate — they use your existing Admin API keys, nothing else to configure here.
          </p>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <a href="/integrations/whmcs" className="flex items-center justify-between gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div>
              <p className="text-sm font-medium text-zinc-200">WHMCS Module</p>
              <p className="text-xs text-zinc-600 mt-0.5">modules/servers/kretase/kretase.php</p>
            </div>
            <Download size={16} className="text-zinc-500 shrink-0" />
          </a>
          <a href="/integrations/blesta" className="flex items-center justify-between gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div>
              <p className="text-sm font-medium text-zinc-200">Blesta Module</p>
              <p className="text-xs text-zinc-600 mt-0.5">components/modules/kretase/</p>
            </div>
            <Download size={16} className="text-zinc-500 shrink-0" />
          </a>
        </div>
      </div>

      {/* Tebex / CraftingStore */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Store Integrations</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Integration
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : integrations.length === 0 ? (
        <div className="card p-12 text-center">
          <ShoppingCart size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium">No store integrations yet</p>
          <p className="text-slate-500 text-sm mt-2">Map a Tebex or CraftingStore package to a console command — like granting a rank on purchase.</p>
          <button className="btn-primary mt-4 mx-auto" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create First Integration
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Server</th>
                  <th>Mappings</th>
                  <th>Last Triggered</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.id}>
                    <td><StatusDot status={i.lastStatus} /></td>
                    <td className="font-medium text-zinc-200">{i.name}{!i.enabled && <span className="ml-2 text-[10px] text-zinc-600">(disabled)</span>}</td>
                    <td>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${i.provider === 'tebex' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                        {i.provider}
                      </span>
                    </td>
                    <td className="text-xs text-zinc-500">{i.server?.name}</td>
                    <td className="text-xs text-zinc-500">{i.commandMappings.length} mapping{i.commandMappings.length !== 1 ? 's' : ''}</td>
                    <td className="text-zinc-500 text-xs">{i.lastTriggeredAt ? new Date(i.lastTriggeredAt).toLocaleString() : 'Never'}</td>
                    <td>
                      <div className="flex items-center gap-1.5 justify-end">
                        <button className="btn-secondary btn-sm" onClick={() => setEditIntegration(i)} title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => setDeleteIntegration(i)} title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(showCreate || editIntegration) && (
        <StoreIntegrationModal
          servers={servers}
          existing={editIntegration}
          onClose={() => { setShowCreate(false); setEditIntegration(null); }}
          onSaved={() => {
            setShowCreate(false);
            setEditIntegration(null);
            queryClient.invalidateQueries({ queryKey: ['admin-store-integrations'] });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteIntegration}
        onClose={() => setDeleteIntegration(null)}
        onConfirm={() => deleteIntegration && deleteMutation.mutate(deleteIntegration.id)}
        title="Delete Integration"
        message={`Delete "${deleteIntegration?.name}"? Purchases will stop running commands immediately.`}
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function StoreIntegrationModal({ servers, existing, onClose, onSaved }: {
  servers: { id: string; name: string }[];
  existing: StoreIntegrationRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [provider, setProvider] = useState<'tebex' | 'craftingstore'>(existing?.provider || 'tebex');
  const [serverId, setServerId] = useState(existing?.serverId || '');
  const [mappings, setMappings] = useState<CommandMapping[]>(existing?.commandMappings?.length ? existing.commandMappings : [{ packageId: '', command: '' }]);
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const webhookUrl = existing ? `${window.location.origin}/api/v1/store-webhooks/${existing.id}` : null;

  const loadSecret = async () => {
    if (!existing) return;
    const { data } = await api.get(`/store-integrations/${existing.id}/secret`);
    setSecret(data.secret);
    setShowSecret(true);
  };

  const regenerateSecret = async () => {
    if (!existing) return;
    await api.put(`/store-integrations/${existing.id}`, { regenerateSecret: true });
    await loadSecret();
    toast.success('Secret regenerated — update it in your store dashboard too');
  };

  const updateMapping = (idx: number, field: keyof CommandMapping, value: string) => {
    setMappings((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!serverId) { toast.error('Pick a server'); return; }
    const cleanMappings = mappings.filter((m) => m.packageId.trim() && m.command.trim());
    setLoading(true);
    try {
      const payload = { name: name.trim(), provider, serverId, commandMappings: cleanMappings };
      if (existing) {
        await api.put(`/store-integrations/${existing.id}`, payload);
      } else {
        await api.post('/store-integrations', payload);
      }
      onSaved();
      toast.success(existing ? 'Integration updated' : 'Integration created');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to save integration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={existing ? 'Edit Integration' : 'New Store Integration'} size="lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="e.g. Main store" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="label">Provider</label>
          <div className="flex gap-2">
            <button type="button" className={provider === 'tebex' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setProvider('tebex')}>Tebex</button>
            <button type="button" className={provider === 'craftingstore' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setProvider('craftingstore')}>CraftingStore</button>
          </div>
        </div>

        <div>
          <label className="label">Server</label>
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">Select a server…</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {existing && webhookUrl && (
          <div className="rounded-lg border border-zinc-800 p-4 space-y-2">
            <label className="label">Webhook URL</label>
            <div className="flex items-center gap-2">
              <code className="input font-mono text-xs flex-1 select-all truncate">{webhookUrl}</code>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Copied'); }}>
                <Copy size={13} />
              </button>
            </div>
            <label className="label">Webhook Secret</label>
            <div className="flex items-center gap-2">
              <code className="input font-mono text-xs flex-1 select-all">{showSecret && secret ? secret : '•'.repeat(32)}</code>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => (showSecret ? setShowSecret(false) : loadSecret())}>
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button className="btn-secondary btn-sm shrink-0" onClick={regenerateSecret} title="Regenerate">
                <RefreshCw size={13} />
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">
              Paste both into your {provider === 'tebex' ? 'Tebex' : 'CraftingStore'} webhook settings.
            </p>
          </div>
        )}

        <div>
          <label className="label">Package → Command Mappings</label>
          <div className="space-y-2">
            {mappings.map((m, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input className="input font-mono text-xs w-28 shrink-0" placeholder="Package ID" value={m.packageId} onChange={(e) => updateMapping(idx, 'packageId', e.target.value)} />
                <input className="input font-mono text-xs flex-1 min-w-0" placeholder="lp user {username} parent addtemp vip 30d" value={m.command} onChange={(e) => updateMapping(idx, 'command', e.target.value)} />
                <button type="button" className="text-zinc-600 hover:text-red-400 shrink-0" onClick={() => setMappings((prev) => prev.filter((_, i) => i !== idx))}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => setMappings((prev) => [...prev, { packageId: '', command: '' }])}>
            <Plus size={12} /> Add mapping
          </button>
          <p className="text-[11px] text-zinc-600 mt-2">
            <code>{'{username}'}</code> in a command is replaced with the buyer's in-game name from the purchase.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>
            {loading ? <Spinner size="sm" /> : existing ? 'Save Changes' : 'Create Integration'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
