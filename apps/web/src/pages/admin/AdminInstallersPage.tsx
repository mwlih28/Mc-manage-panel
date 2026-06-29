import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Bell, BellOff, Trash2, Send, RefreshCw, Globe, Calendar, Mail } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { formatRelativeTime } from '@/lib/utils';

interface Registration {
  id: string;
  email: string;
  name: string;
  serverIp: string;
  panelDomain: string;
  panelVersion: string;
  notifyUpdates: boolean;
  installedAt: string;
}

interface Stats {
  total: number;
  withNotify: number;
  today: number;
}

export function AdminInstallersPage() {
  const qc = useQueryClient();
  const [version, setVersion] = useState('');
  const [changelogUrl, setChangelogUrl] = useState('');
  const [sending, setSending] = useState(false);

  const { data: stats } = useQuery<Stats>({
    queryKey: ['installer-stats'],
    queryFn: () => api.get('/installer/registrations/stats').then(r => r.data),
  });

  const { data: list = [], isLoading } = useQuery<Registration[]>({
    queryKey: ['installer-registrations'],
    queryFn: () => api.get('/installer/registrations').then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/installer/registrations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installer-registrations'] });
      qc.invalidateQueries({ queryKey: ['installer-stats'] });
      toast.success('Registration deleted');
    },
    onError: () => toast.error('Delete failed'),
  });

  const sendNotifications = async () => {
    if (!version.trim()) { toast.error('Enter a version string'); return; }
    setSending(true);
    try {
      const { data } = await api.post('/installer/notify-updates', { version, changelogUrl });
      toast.success(`Sent ${data.sent} of ${data.total} emails`);
      if (data.failed > 0) toast.error(`${data.failed} failed — check SMTP settings`);
    } catch {
      toast.error('Failed to send notifications');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-white">Installers</h1>
        <p className="text-sm text-zinc-500 mt-1">Everyone who installed MC Manage Panel.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Installs', value: stats?.total ?? '—', icon: Users, color: 'text-panel-400' },
          { label: 'Notify Opted-In', value: stats?.withNotify ?? '—', icon: Bell, color: 'text-yellow-400' },
          { label: 'Today', value: stats?.today ?? '—', icon: Calendar, color: 'text-green-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
              <Icon size={16} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-zinc-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Send update notifications */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Send size={14} />Send Update Notifications</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Email all opted-in installers about a new release.</p>
        </div>
        <div className="p-5 flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-48">
            <label className="label">Version</label>
            <input
              className="input"
              value={version}
              onChange={e => setVersion(e.target.value)}
              placeholder="v1.2.0"
            />
          </div>
          <div className="flex-1 min-w-64">
            <label className="label">Changelog URL (optional)</label>
            <input
              className="input"
              value={changelogUrl}
              onChange={e => setChangelogUrl(e.target.value)}
              placeholder="https://github.com/mwlih28/mc-manage-panel/releases/tag/v1.2.0"
            />
          </div>
          <button
            className="btn-primary"
            onClick={sendNotifications}
            disabled={sending || !stats?.withNotify}
          >
            {sending ? <><Spinner size="sm" />Sending...</> : <><Send size={13} />Send to {stats?.withNotify ?? 0} subscribers</>}
          </button>
        </div>
      </div>

      {/* Registration list */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2"><Users size={14} />All Registrations</h2>
          <button
            className="p-1.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.05] transition-colors"
            onClick={() => qc.invalidateQueries({ queryKey: ['installer-registrations'] })}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-zinc-600">
            <Users size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No registrations yet</p>
            <p className="text-xs mt-1">They'll appear here once someone installs the panel</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Installer</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Server</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Notifications</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Installed</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {list.map(reg => (
                  <tr key={reg.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-panel-500/10 border border-panel-500/20 flex items-center justify-center text-panel-400 text-[10px] font-bold shrink-0">
                          {(reg.name || reg.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-zinc-200 font-medium">{reg.name || <span className="text-zinc-500 italic">—</span>}</p>
                          <p className="text-xs text-zinc-500 flex items-center gap-1"><Mail size={10} />{reg.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-zinc-300 font-mono text-xs">{reg.serverIp}</p>
                      {reg.panelDomain && (
                        <p className="text-xs text-zinc-600 flex items-center gap-1 mt-0.5"><Globe size={10} />{reg.panelDomain}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {reg.notifyUpdates ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <Bell size={10} />Opted in
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-500">
                          <BellOff size={10} />No
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-zinc-500">
                      {formatRelativeTime(reg.installedAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Remove registration for ${reg.email}?`)) deleteMutation.mutate(reg.id);
                        }}
                        className="p-1.5 rounded text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
