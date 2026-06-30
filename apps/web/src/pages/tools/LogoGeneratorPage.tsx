import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, RefreshCw, Download, Lock, ImagePlus, Wand2 } from 'lucide-react';
import api from '@/lib/axios';
import { Server } from '@/types';
import { generateLogos, logoSpecToSvgString, svgToPngDataUrl, imageSrcToPngDataUrl, LogoSpec } from '@/lib/logoGenerator';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

function AiLogoCard({ imageB64, index, targetServerId }: { imageB64: string; index: number; targetServerId: string }) {
  const dataUrl = `data:image/png;base64,${imageB64}`;
  const [applying, setApplying] = useState(false);

  const download = () => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `server-logo-ai-${index + 1}.png`;
    a.click();
  };

  const applyAsIcon = async () => {
    if (!targetServerId) { toast.error('Select a server first'); return; }
    setApplying(true);
    try {
      const resized = await imageSrcToPngDataUrl(dataUrl, 64);
      const base64 = resized.split(',')[1];
      await api.post(`/servers/${targetServerId}/files/write`, {
        file: 'server-icon.png',
        content: base64,
        encoding: 'base64',
      });
      toast.success('Applied as server icon — restart the server for it to take effect');
    } catch {
      toast.error('Failed to apply icon');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="card p-4 flex flex-col items-center gap-3">
      <img src={dataUrl} alt="" className="w-32 h-32 rounded-lg object-cover" />
      <button className="btn-secondary btn-sm w-full" onClick={download}>
        <Download size={13} /> Download PNG
      </button>
      <button
        className={cn('btn-secondary btn-sm w-full', !targetServerId && 'opacity-50 cursor-not-allowed')}
        disabled={!targetServerId || applying}
        onClick={applyAsIcon}
      >
        {applying ? <Spinner size="sm" /> : <><ImagePlus size={13} /> Apply as Server Icon</>}
      </button>
    </div>
  );
}

function LogoCard({ spec, index, targetServerId }: { spec: LogoSpec; index: number; targetServerId: string }) {
  const gradId = `kretase-logo-grad-${index}`;
  const svg = logoSpecToSvgString(spec, gradId);
  const [applying, setApplying] = useState(false);

  const download = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `server-logo-${index + 1}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyAsIcon = async () => {
    if (!targetServerId) { toast.error('Select a server first'); return; }
    setApplying(true);
    try {
      const dataUrl = await svgToPngDataUrl(svg, 64);
      const base64 = dataUrl.split(',')[1];
      await api.post(`/servers/${targetServerId}/files/write`, {
        file: 'server-icon.png',
        content: base64,
        encoding: 'base64',
      });
      toast.success('Applied as server icon — restart the server for it to take effect');
    } catch {
      toast.error('Failed to apply icon');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="card p-4 flex flex-col items-center gap-3">
      <div className="w-32 h-32" dangerouslySetInnerHTML={{ __html: svg }} />
      <button className="btn-secondary btn-sm w-full" onClick={download}>
        <Download size={13} /> Download SVG
      </button>
      <button
        className={cn('btn-secondary btn-sm w-full', !targetServerId && 'opacity-50 cursor-not-allowed')}
        disabled={!targetServerId || applying}
        onClick={applyAsIcon}
      >
        {applying ? <Spinner size="sm" /> : <><ImagePlus size={13} /> Apply as Server Icon</>}
      </button>
    </div>
  );
}

export function LogoGeneratorPage() {
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
  const [logos, setLogos] = useState<LogoSpec[]>([]);
  const [aiImages, setAiImages] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const enabled = settings?.['features.aiTools'] !== 'false';
  const aiAvailable = settings?.['ai.openaiConfigured'] === 'true';

  const pickServer = (id: string) => {
    setServerId(id);
    const s = (serversData || []).find((sv) => sv.id === id);
    if (s) setServerName(s.name);
  };

  const generate = () => { setLogos(generateLogos(serverName, 6)); setAiImages([]); };

  const generateWithAi = async () => {
    setAiLoading(true);
    try {
      const { data } = await api.post('/ai/logo', { serverName });
      setAiImages(data.images || []);
      setLogos([]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'AI generation failed';
      toast.error(msg);
    } finally {
      setAiLoading(false);
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
        <p className="text-sm text-slate-500">The Logo Generator has been disabled by the administrator.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Sparkles size={18} className="text-panel-400" /> Logo Generator
        </h1>
        <p className="text-slate-400 text-sm mt-1">Generate a logo for your server and apply it directly as the in-game server icon.</p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Server (optional)</label>
            <select className="input" value={serverId} onChange={(e) => pickServer(e.target.value)}>
              <option value="">None — just generate</option>
              {(serversData || []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-600 mt-1">Pick a server to apply a logo directly as its server-icon.png.</p>
          </div>
          <div>
            <label className="label">Server Name</label>
            <input
              className="input"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="My Server"
            />
            <p className="text-xs text-slate-600 mt-1">The first letter is used as the logo's initial.</p>
          </div>
        </div>
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

      {logos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {logos.map((spec, i) => (
            <LogoCard key={i} spec={spec} index={i} targetServerId={serverId} />
          ))}
        </div>
      )}

      {aiImages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {aiImages.map((img, i) => (
            <AiLogoCard key={i} imageB64={img} index={i} targetServerId={serverId} />
          ))}
        </div>
      )}
    </div>
  );
}
