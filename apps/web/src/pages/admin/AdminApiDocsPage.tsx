import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Check } from 'lucide-react';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import toast from 'react-hot-toast';

interface ManifestEntry {
  method: string;
  path: string;
  scope: string | string[];
  description: string;
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-sky-400 bg-sky-500/10',
  POST: 'text-green-400 bg-green-500/10',
  PATCH: 'text-amber-400 bg-amber-500/10',
  PUT: 'text-amber-400 bg-amber-500/10',
  DELETE: 'text-red-400 bg-red-500/10',
};

function resourceOf(path: string): string {
  const seg = path.split('/').filter(Boolean)[0] || 'other';
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function AdminApiDocsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-api-manifest'],
    queryFn: () => api.get('/docs/manifest').then((r) => r.data.data as ManifestEntry[]),
  });

  const entries = data || [];
  const groups = entries.reduce<Record<string, ManifestEntry[]>>((acc, e) => {
    const key = resourceOf(e.path);
    (acc[key] ??= []).push(e);
    return acc;
  }, {});

  const origin = import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api/v1`
    : `${window.location.origin}/api/v1`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">API Reference</h1>
        <p className="text-slate-400 text-sm mt-1">
          Routes available to admin API keys, grouped by resource. Create a key under{' '}
          <span className="text-zinc-300">API Keys</span> and use it as a Bearer token.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        Object.entries(groups).map(([resource, rows]) => (
          <div key={resource} className="card">
            <div className="px-4 py-3 border-b border-dark-800">
              <h2 className="text-sm font-semibold text-zinc-200">{resource}</h2>
            </div>
            <div className="divide-y divide-dark-800">
              {rows.map((e) => (
                <ManifestRow key={`${e.method}-${e.path}`} entry={e} origin={origin} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ManifestRow({ entry, origin }: { entry: ManifestEntry; origin: string }) {
  const [copied, setCopied] = useState(false);
  const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope];
  const curl = `curl -X ${entry.method} "${origin}${entry.path}" \\\n  -H "Authorization: Bearer $API_KEY"`;

  const copy = () => {
    navigator.clipboard.writeText(curl);
    setCopied(true);
    toast.success('Copied curl example');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${METHOD_COLOR[entry.method] || 'text-zinc-400 bg-dark-800'}`}>
        {entry.method}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono text-zinc-300">{entry.path}</code>
          {scopes.map((s) => (
            <span key={s} className="text-[10px] font-mono text-panel-400 bg-dark-950/60 px-1.5 py-0.5 rounded">{s}</span>
          ))}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{entry.description}</p>
      </div>
      <button className="btn-secondary btn-sm shrink-0" onClick={copy} title="Copy curl example">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
