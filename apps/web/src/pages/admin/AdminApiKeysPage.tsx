import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

interface ApiKeyRow {
  id: string;
  name: string;
  identifier: string;
  permissions: string[];
  expiresAt: string | null;
  expired: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

const EXPIRY_OPTIONS = [
  { label: 'Never', value: '' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: '1 year', value: '365' },
];

export function AdminApiKeysPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [deleteKey, setDeleteKey] = useState<ApiKeyRow | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: () => api.get('/api-keys').then((r) => r.data.data as ApiKeyRow[]),
  });

  const { data: scopesData } = useQuery({
    queryKey: ['admin-api-key-scopes'],
    queryFn: () => api.get('/api-keys/scopes').then((r) => r.data.scopes as string[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => {
      toast.success('API key revoked');
      queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] });
      setDeleteKey(null);
    },
    onError: () => toast.error('Failed to revoke API key'),
  });

  const keys = data || [];
  const scopes = scopesData || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">API Keys</h1>
          <p className="text-slate-400 text-sm mt-1">
            Admin-only credentials for scripts and integrations to call the Kretase API. Never shared with regular users.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New API Key
        </button>
      </div>

      {isLoading ? (
        <div className="card"><TableSkeleton rows={5} columns={6} /></div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description="Create one to let a script or integration call the Kretase API"
          action={
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Create First Key
            </button>
          }
        />
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Identifier</th>
                  <th>Permissions</th>
                  <th>Expires</th>
                  <th>Last Used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td className="font-medium text-zinc-200">{k.name}</td>
                    <td className="font-mono text-xs">{k.identifier}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {k.permissions.map((p) => (
                          <span key={p} className="text-[10px] font-mono bg-dark-950/60 px-1.5 py-0.5 rounded text-panel-400">{p}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {k.expiresAt ? (
                        <span className={k.expired ? 'text-red-400' : ''}>
                          {new Date(k.expiresAt).toLocaleDateString()}{k.expired ? ' (expired)' : ''}
                        </span>
                      ) : (
                        <span className="text-zinc-500">Never</span>
                      )}
                    </td>
                    <td className="text-zinc-500">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</td>
                    <td>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => setDeleteKey(k)}
                        title="Revoke key"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateApiKeyModal
          scopes={scopes}
          onClose={() => setShowCreate(false)}
          onCreated={(key) => {
            setShowCreate(false);
            setCreatedKey(key);
            queryClient.invalidateQueries({ queryKey: ['admin-api-keys'] });
          }}
        />
      )}

      {/* One-time reveal of the full key — never retrievable again afterward */}
      <Modal isOpen={!!createdKey} onClose={() => { setCreatedKey(null); setCopied(false); }} title="API Key Created" size="lg">
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-2 text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-3 text-sm">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <p>Copy this key now — it won't be shown again. Only a hash is stored, so it can't be recovered later.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="input font-mono text-xs break-all flex-1 select-all">{createdKey}</code>
            <button
              className="btn-secondary btn-sm shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(createdKey || '');
                setCopied(true);
                toast.success('Copied to clipboard');
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button className="btn-primary w-full" onClick={() => { setCreatedKey(null); setCopied(false); }}>
            Done
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteKey}
        onClose={() => setDeleteKey(null)}
        onConfirm={() => deleteKey && deleteMutation.mutate(deleteKey.id)}
        title="Revoke API Key"
        message={`Revoke "${deleteKey?.name}"? Anything using it will immediately lose access.`}
        confirmLabel="Revoke"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

function CreateApiKeyModal({ scopes, onClose, onCreated }: {
  scopes: string[]; onClose: () => void; onCreated: (key: string) => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleScope = (scope: string) => {
    setSelected((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  };

  const allSelected = selected.includes('*');

  const submit = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (selected.length === 0) { toast.error('Select at least one permission'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/api-keys', {
        name: name.trim(),
        permissions: selected,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
      });
      onCreated(data.data.key);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to create API key');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New API Key" size="lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            placeholder="e.g. Monitoring script"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Permissions</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : ['*'])} />
              Full access (all permissions)
            </label>
            {!allSelected && (
              <div className="grid grid-cols-2 gap-1.5 pl-1">
                {scopes.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-xs font-mono text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={selected.includes(s)} onChange={() => toggleScope(s)} />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="label">Expires</label>
          <select className="input" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>
            {loading ? <Spinner size="sm" /> : 'Create Key'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
