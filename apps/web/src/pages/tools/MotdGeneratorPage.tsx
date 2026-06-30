import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, RefreshCw, Copy, Check, Lock, Wand2 } from 'lucide-react';
import api from '@/lib/axios';
import { Server } from '@/types';
import { generateMotd, parseMotdLines, MotdTheme } from '@/lib/motdGenerator';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const THEME_OPTIONS: { id: MotdTheme; label: string }[] = [
  { id: 'random', label: 'Random' },
  { id: 'survival', label: 'Survival' },
  { id: 'creative', label: 'Creative' },
  { id: 'minigame', label: 'Minigame' },
  { id: 'hardcore', label: 'Hardcore' },
];

function MotdPreview({ motd }: { motd: string }) {
  const lines = parseMotdLines(motd);
  return (
    <div className="bg-black/60 rounded-lg p-3 font-mono text-sm leading-relaxed">
      {lines.map((segments, i) => (
        <div key={i}>
          {segments.map((seg, j) => (
            <span
              key={j}
              style={{
                color: seg.color,
                fontWeight: seg.bold ? 700 : 400,
                fontStyle: seg.italic ? 'italic' : 'normal',
              }}
            >
              {seg.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function MotdGeneratorPage() {
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then((r) => r.data as Record<string, string>),
    staleTime: 60000,
  });

  const { data: serversData } = useQuery({
    queryKey: ['my-servers-for-tools'],
    queryFn: () => api.get('/servers', { params: { perPage: 100 } }).then((r) => r.data.data as Server[]),
  });

  const [serverId, setServerId] = useState('');
  const [serverName, setServerName] = useState('');
  const [theme, setTheme] = useState<MotdTheme>('random');
  const [results, setResults] = useState<string[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [applyTarget, setApplyTarget] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const enabled = settings?.['features.aiTools'] !== 'false';
  const aiAvailable = settings?.['ai.configured'] === 'true';

  const { data: currentPropertiesData } = useQuery({
    queryKey: ['server-properties-motd', serverId],
    queryFn: () => api.get(`/servers/${serverId}/files/contents`, { params: { file: 'server.properties' } }).then((r) => r.data),
    enabled: !!serverId,
  });
  const currentMotd: string | null = (() => {
    const content: string = currentPropertiesData?.content || '';
    const line = content.split('\n').find((l: string) => l.startsWith('motd='));
    return line ? line.slice(5).replace(/\\n/g, '\n') : null;
  })();

  const pickServer = (id: string) => {
    setServerId(id);
    const s = (serversData || []).find((sv) => sv.id === id);
    if (s) setServerName(s.name);
  };

  const applyResults = (motds: string[]) => {
    setResults(motds);
    if (serverId) {
      setApplyTarget(Object.fromEntries(motds.map((_, i) => [i, serverId])));
    }
  };

  const generate = () => applyResults(generateMotd(serverName, theme));

  const generateWithAi = async () => {
    setAiLoading(true);
    try {
      const { data } = await api.post('/ai/motd', { serverName, theme });
      applyResults(data.results || []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'AI generation failed';
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  };

  const copyMotd = (motd: string, idx: number) => {
    navigator.clipboard.writeText(motd);
    setCopiedIdx(idx);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const applyToServer = async (motd: string, idx: number) => {
    const serverId = applyTarget[idx];
    if (!serverId) { toast.error('Select a server first'); return; }
    setApplying(idx);
    try {
      const { data } = await api.get(`/servers/${serverId}/files/contents`, { params: { file: 'server.properties' } });
      const lines: string[] = (data.content || '').split('\n');
      const motdLine = `motd=${motd.replace(/\n/g, '\\n')}`;
      let found = false;
      const updated = lines.map((l: string) => {
        if (l.startsWith('motd=')) { found = true; return motdLine; }
        return l;
      });
      if (!found) updated.push(motdLine);
      await api.post(`/servers/${serverId}/files/write`, { file: 'server.properties', content: updated.join('\n') });
      toast.success('MOTD applied — restart the server for it to take effect');
    } catch {
      toast.error('Failed to apply MOTD');
    } finally {
      setApplying(null);
    }
  };

  if (settingsLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  if (!enabled) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center space-y-3">
        <Lock size={32} className="mx-auto text-slate-600" />
        <h1 className="text-lg font-semibold text-slate-200">AI Tools Disabled</h1>
        <p className="text-sm text-slate-500">The MOTD Generator has been disabled by the administrator.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Sparkles size={18} className="text-panel-400" /> MOTD Generator
        </h1>
        <p className="text-slate-400 text-sm mt-1">Generate a server message-of-the-day with Minecraft formatting codes.</p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Server (optional)</label>
            <select className="input" value={serverId} onChange={(e) => pickServer(e.target.value)}>
              <option value="">None — just generate</option>
              {(serversData || []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Server Name</label>
            <input
              className="input"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="My Server"
            />
          </div>
          <div>
            <label className="label">Theme</label>
            <select className="input" value={theme} onChange={(e) => setTheme(e.target.value as MotdTheme)}>
              {THEME_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        {serverId && currentMotd && (
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Current MOTD</p>
            <MotdPreview motd={currentMotd} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={generate}>
            <RefreshCw size={14} /> Generate (Free)
          </button>
          {aiAvailable && (
            <button className="btn-secondary" onClick={generateWithAi} disabled={aiLoading}>
              {aiLoading ? <Spinner size="sm" /> : <Wand2 size={14} />} Generate with AI
            </button>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((motd, i) => (
            <div key={i} className="card p-4 space-y-3">
              <MotdPreview motd={motd} />
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-secondary btn-sm" onClick={() => copyMotd(motd, i)}>
                  {copiedIdx === i ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  Copy
                </button>
                <select
                  className="input py-1.5 text-xs w-44"
                  value={applyTarget[i] || ''}
                  onChange={(e) => setApplyTarget((p) => ({ ...p, [i]: e.target.value }))}
                >
                  <option value="">Select server…</option>
                  {(serversData || []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  className={cn('btn-secondary btn-sm', !applyTarget[i] && 'opacity-50 cursor-not-allowed')}
                  disabled={!applyTarget[i] || applying === i}
                  onClick={() => applyToServer(motd, i)}
                >
                  {applying === i ? <Spinner size="sm" /> : 'Apply to Server'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
