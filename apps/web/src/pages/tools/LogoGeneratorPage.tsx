import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, RefreshCw, Download, Lock } from 'lucide-react';
import api from '@/lib/axios';
import { generateLogos, logoSpecToSvgString, LogoSpec } from '@/lib/logoGenerator';
import { Spinner } from '@/components/ui/Spinner';

function LogoCard({ spec, index }: { spec: LogoSpec; index: number }) {
  const gradId = `kretase-logo-grad-${index}`;
  const svg = logoSpecToSvgString(spec, gradId);

  const download = () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `server-logo-${index + 1}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card p-4 flex flex-col items-center gap-3">
      <div className="w-32 h-32" dangerouslySetInnerHTML={{ __html: svg }} />
      <button className="btn-secondary btn-sm w-full" onClick={download}>
        <Download size={13} /> Download SVG
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

  const [serverName, setServerName] = useState('');
  const [logos, setLogos] = useState<LogoSpec[]>([]);

  const enabled = settings?.['features.aiTools'] !== 'false';

  const generate = () => setLogos(generateLogos(serverName, 6));

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
        <p className="text-slate-400 text-sm mt-1">Generate a logo for your server — pick a name and we'll create a few options.</p>
      </div>

      <div className="card p-5 space-y-4">
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
        <button className="btn-primary" onClick={generate}>
          <RefreshCw size={14} /> Generate Logos
        </button>
      </div>

      {logos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {logos.map((spec, i) => (
            <LogoCard key={i} spec={spec} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
