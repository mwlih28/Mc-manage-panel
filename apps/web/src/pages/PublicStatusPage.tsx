import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/lib/axios';
import { Users, Copy, Server as ServerIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import toast from 'react-hot-toast';

interface PublicStatus {
  name: string;
  online: boolean;
  playerCount: number;
  maxPlayers: number | null;
  motd: string | null;
  address: string | null;
}

export function PublicStatusPage() {
  const { slug } = useParams();
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.get(`/public/status/${slug}`)
        .then(({ data }) => { if (!cancelled) setStatus(data); })
        .catch(() => { if (!cancelled) setNotFound(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [slug]);

  const copyAddress = () => {
    if (!status?.address) return;
    navigator.clipboard.writeText(status.address);
    toast.success('Copied');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0a0a0c' }}>
      <div className="w-full max-w-md">
        {loading ? (
          <div className="flex justify-center"><Spinner size="lg" /></div>
        ) : notFound || !status ? (
          <div className="card card-body text-center py-12">
            <ServerIcon size={32} className="mx-auto mb-3 text-slate-600" />
            <p className="text-slate-400">This status page doesn't exist or isn't public.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="p-6 border-b border-dark-700">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full shrink-0 ${status.online ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-slate-100 truncate">{status.name}</h1>
                  <p className={`text-xs font-medium ${status.online ? 'text-green-400' : 'text-slate-500'}`}>
                    {status.online ? 'Online' : 'Offline'}
                  </p>
                </div>
              </div>
              {status.motd && (
                <p className="text-sm text-slate-400 mt-3 font-mono">{status.motd}</p>
              )}
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-slate-400"><Users size={15} /> Players</span>
                <span className="text-sm font-semibold text-slate-200">
                  {status.playerCount}{status.maxPlayers !== null ? ` / ${status.maxPlayers}` : ''}
                </span>
              </div>

              {status.address && (
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Server Address</p>
                  <button
                    onClick={copyAddress}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-700 hover:border-dark-600 transition-colors text-left"
                  >
                    <code className="text-sm text-panel-400 truncate">{status.address}</code>
                    <Copy size={14} className="text-slate-500 shrink-0" />
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 py-3 bg-dark-900/50 text-center">
              <p className="text-[11px] text-slate-600">Powered by Kretase</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
