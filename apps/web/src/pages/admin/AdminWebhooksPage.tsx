import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Webhook as WebhookIcon, Plus, Trash2, Pencil, Send, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

interface WebhookEventDef {
  key: string;
  label: string;
  category: string;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  mode: 'generic' | 'discord';
  secret: string | null;
  events: string[];
  serverId: string | null;
  server: { id: string; name: string } | null;
  enabled: boolean;
  lastStatus: 'success' | 'failed' | null;
  lastTriggeredAt: string | null;
  lastError: string | null;
}

function StatusDot({ status }: { status: WebhookRow['lastStatus'] }) {
  const color = status === 'success' ? 'bg-[#3EC896]' : status === 'failed' ? 'bg-red-500' : 'bg-zinc-600';
  const title = status === 'success' ? 'Last delivery succeeded' : status === 'failed' ? 'Last delivery failed' : 'Never triggered';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={title} />;
}

export function AdminWebhooksPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editWebhook, setEditWebhook] = useState<WebhookRow | null>(null);
  const [deleteWebhook, setDeleteWebhook] = useState<WebhookRow | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-webhooks'],
    queryFn: () => api.get('/webhooks').then((r) => r.data.data as WebhookRow[]),
  });

  const { data: eventsData } = useQuery({
    queryKey: ['admin-webhook-events'],
    queryFn: () => api.get('/webhooks/events').then((r) => r.data.data as WebhookEventDef[]),
  });

  const { data: serversData } = useQuery({
    queryKey: ['admin-webhook-servers'],
    queryFn: () => api.get('/servers', { params: { perPage: 100 } }).then((r) => r.data.data as { id: string; name: string }[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => {
      toast.success('Webhook deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks'] });
      setDeleteWebhook(null);
    },
    onError: () => toast.error('Failed to delete webhook'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/webhooks/${id}/test`),
    onSuccess: () => {
      toast.success('Test delivery succeeded');
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Test delivery failed');
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks'] });
    },
  });

  const webhooks = data || [];
  const events = eventsData || [];
  const servers = serversData || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Webhooks</h1>
          <p className="text-slate-400 text-sm mt-1">
            Send server/user events to Discord or your own automation — billing, alerting, whatever you need to plug in.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Webhook
        </button>
      </div>

      {isLoading ? (
        <div className="card"><TableSkeleton rows={5} columns={5} /></div>
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks yet"
          description="Create one to get notified in Discord or your own system when something happens"
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Create First Webhook
            </button>
          }
        />
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Mode</th>
                  <th>Events</th>
                  <th>Scope</th>
                  <th>Last Triggered</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td><StatusDot status={w.lastStatus} /></td>
                    <td className="font-medium text-zinc-200">{w.name}{!w.enabled && <span className="ml-2 text-[10px] text-zinc-600">(disabled)</span>}</td>
                    <td>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${w.mode === 'discord' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-dark-950/60 text-panel-400'}`}>
                        {w.mode}
                      </span>
                    </td>
                    <td className="text-xs text-zinc-500">{w.events.length} event{w.events.length !== 1 ? 's' : ''}</td>
                    <td className="text-xs text-zinc-500">{w.server?.name || 'Global'}</td>
                    <td className="text-zinc-500 text-xs">{w.lastTriggeredAt ? new Date(w.lastTriggeredAt).toLocaleString() : 'Never'}</td>
                    <td>
                      <div className="flex items-center gap-1.5 justify-end">
                        <button className="btn-secondary btn-sm" onClick={() => testMutation.mutate(w.id)} disabled={testMutation.isPending} title="Send test delivery">
                          <Send size={13} />
                        </button>
                        <button className="btn-secondary btn-sm" onClick={() => setEditWebhook(w)} title="Edit">
                          <Pencil size={13} />
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => setDeleteWebhook(w)} title="Delete">
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

      {(showCreate || editWebhook) && (
        <WebhookModal
          events={events}
          servers={servers}
          existing={editWebhook}
          onClose={() => { setShowCreate(false); setEditWebhook(null); }}
          onSaved={() => {
            setShowCreate(false);
            setEditWebhook(null);
            queryClient.invalidateQueries({ queryKey: ['admin-webhooks'] });
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteWebhook}
        onClose={() => setDeleteWebhook(null)}
        onConfirm={() => deleteWebhook && deleteMutation.mutate(deleteWebhook.id)}
        title="Delete Webhook"
        message={`Delete "${deleteWebhook?.name}"? It will stop firing immediately.`}
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function WebhookModal({ events, servers, existing, onClose, onSaved }: {
  events: WebhookEventDef[];
  servers: { id: string; name: string }[];
  existing: WebhookRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [url, setUrl] = useState(existing?.url || '');
  const [mode, setMode] = useState<'generic' | 'discord'>(existing?.mode || 'generic');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(existing?.events || []);
  const [serverId, setServerId] = useState<string>(existing?.serverId || '');
  const [showSecret, setShowSecret] = useState(false);
  const [secret, setSecret] = useState(existing?.secret || '');
  const [loading, setLoading] = useState(false);

  const allSelected = selectedEvents.includes('*');
  const categories = Array.from(new Set(events.map((e) => e.category)));

  const toggleEvent = (key: string) => {
    setSelectedEvents((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (!url.trim()) { toast.error('URL is required'); return; }
    if (selectedEvents.length === 0) { toast.error('Select at least one event'); return; }
    setLoading(true);
    try {
      const payload = { name: name.trim(), url: url.trim(), mode, events: selectedEvents, serverId: serverId || null };
      if (existing) {
        const { data } = await api.put(`/webhooks/${existing.id}`, payload);
        setSecret(data.data.secret || '');
      } else {
        await api.post('/webhooks', payload);
      }
      onSaved();
      toast.success(existing ? 'Webhook updated' : 'Webhook created');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to save webhook');
    } finally {
      setLoading(false);
    }
  };

  const regenerateSecret = async () => {
    if (!existing) return;
    try {
      const { data } = await api.put(`/webhooks/${existing.id}`, { regenerateSecret: true });
      setSecret(data.data.secret || '');
      toast.success('Secret regenerated');
    } catch {
      toast.error('Failed to regenerate secret');
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={existing ? 'Edit Webhook' : 'New Webhook'} size="lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="e.g. Discord alerts" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="label">Mode</label>
          <div className="flex gap-2">
            <button
              type="button"
              className={mode === 'generic' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => setMode('generic')}
            >
              Generic (signed JSON)
            </button>
            <button
              type="button"
              className={mode === 'discord' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
              onClick={() => setMode('discord')}
            >
              Discord
            </button>
          </div>
        </div>

        <div>
          <label className="label">{mode === 'discord' ? 'Discord Webhook URL' : 'Receiver URL'}</label>
          <input className="input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>

        {mode === 'generic' && secret && (
          <div>
            <label className="label">Signing Secret</label>
            <div className="flex items-center gap-2">
              <code className="input font-mono text-xs flex-1 select-all">
                {showSecret ? secret : '•'.repeat(32)}
              </code>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => setShowSecret((s) => !s)} title="Toggle visibility">
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button className="btn-secondary btn-sm shrink-0" onClick={() => { navigator.clipboard.writeText(secret); toast.success('Copied'); }} title="Copy">
                <Copy size={13} />
              </button>
              {existing && (
                <button className="btn-secondary btn-sm shrink-0" onClick={regenerateSecret} title="Regenerate">
                  <RefreshCw size={13} />
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Verify deliveries with <code>HMAC-SHA256(secret, rawBody)</code> against the <code>X-Kretase-Signature</code> header.
            </p>
          </div>
        )}

        <div>
          <label className="label">Server scope</label>
          <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">Global (all servers)</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Events</label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer mb-2">
            <input type="checkbox" checked={allSelected} onChange={() => setSelectedEvents(allSelected ? [] : ['*'])} />
            All events
          </label>
          {!allSelected && (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {categories.map((cat) => (
                <div key={cat}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 mb-1">{cat}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {events.filter((e) => e.category === cat).map((e) => (
                      <label key={e.key} className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                        <input type="checkbox" checked={selectedEvents.includes(e.key)} onChange={() => toggleEvent(e.key)} />
                        {e.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>
            {loading ? <Spinner size="sm" /> : existing ? 'Save Changes' : 'Create Webhook'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
