import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { PublicStatusCard } from '@/components/PublicStatusCard';
import { Server } from '@/types';
import {
  Palette, Image as ImageIcon, Megaphone, Code2, Save, RefreshCw, Info, ExternalLink,
} from 'lucide-react';

interface PreviewData {
  name: string;
  description: string | null;
  online: boolean;
  playerCount: number;
  maxPlayers: number | null;
  motd: string | null;
  address: string | null;
}

export function PublicPageCustomizer({ serverId, server }: { serverId: string; server?: Server }) {
  const [accentColor, setAccentColor] = useState('#3b82f6');
  const [logo, setLogo] = useState('');
  const [banner, setBanner] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [customCss, setCustomCss] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (server) {
      setAccentColor(server.publicStatusAccentColor || '#3b82f6');
      setLogo(server.publicStatusLogo || '');
      setBanner(server.publicStatusBanner || '');
      setAnnouncement(server.publicStatusAnnouncement || '');
      setCustomCss(server.publicStatusCustomCss || '');
    }
  }, [server]);

  const { data: preview, isLoading, refetch, isFetching } = useQuery<PreviewData>({
    queryKey: ['server', serverId, 'public-preview'],
    queryFn: async () => (await api.get(`/servers/${serverId}/public-preview`)).data,
  });

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.patch(`/servers/${serverId}`, {
        publicStatusAccentColor: accentColor,
        publicStatusLogo: logo || null,
        publicStatusBanner: banner || null,
        publicStatusAnnouncement: announcement || null,
        publicStatusCustomCss: customCss || null,
      });
      toast.success('Customization saved');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [serverId, accentColor, logo, banner, announcement, customCss]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        {server && !server.publicStatusEnabled && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>The public page is currently off. Turn it on in the Settings tab to make it visible — you can still design it here first.</span>
          </div>
        )}

        <div className="card">
          <div className="card-header flex items-center gap-2">
            <Palette size={14} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-100">Appearance</h3>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="label">Accent color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-dark-700 bg-transparent cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  className="input font-mono w-32"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#3b82f6"
                />
              </div>
            </div>

            <div>
              <label className="label flex items-center gap-1.5"><ImageIcon size={13} /> Logo URL</label>
              <input
                type="text"
                className="input text-sm"
                value={logo}
                onChange={(e) => setLogo(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
              <p className="text-xs text-slate-600 mt-1">Square image shown instead of the default server icon.</p>
            </div>

            <div>
              <label className="label flex items-center gap-1.5"><ImageIcon size={13} /> Banner image URL</label>
              <input
                type="text"
                className="input text-sm"
                value={banner}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="https://example.com/banner.jpg"
              />
              <p className="text-xs text-slate-600 mt-1">Slowly pans and zooms automatically — no video needed. A GIF URL will animate on its own too.</p>
            </div>

            <div>
              <label className="label flex items-center gap-1.5"><Megaphone size={13} /> Announcement</label>
              <input
                type="text"
                className="input text-sm"
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value.slice(0, 200))}
                placeholder="e.g. Bakım: Cumartesi 20:00'de sunucu yeniden başlatılacak"
              />
              <p className="text-xs text-slate-600 mt-1">{announcement.length}/200 — shown as a banner strip on the page. Leave empty to hide.</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center gap-2">
            <Code2 size={14} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-100">Custom CSS</h3>
            <span className="badge-gray text-[10px] ml-auto">Advanced</span>
          </div>
          <div className="p-5 space-y-2">
            <textarea
              className="input font-mono text-xs min-h-[160px] resize-y"
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value.slice(0, 4000))}
              placeholder={'.ksp-card { border-radius: 8px; }\n.ksp-card h1 { font-family: monospace; }'}
              spellCheck={false}
            />
            <p className="text-xs text-slate-600">
              {customCss.length}/4000 — raw CSS injected only on your live public page (not shown in the preview below).
              Full control, use with care.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <Spinner size="sm" /> : <><Save size={14} /> Save changes</>}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Live preview</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Spinner size="sm" /> : <RefreshCw size={12} />} Refresh data
            </button>
            {server?.publicSlug && (
              <a href={`/status/${server.publicSlug}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                <ExternalLink size={12} /> Open live page
              </a>
            )}
          </div>
        </div>
        <div className="relative rounded-xl overflow-hidden border border-dark-700" style={{ height: 520 }}>
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-dark-950">
              <Spinner />
            </div>
          ) : (
            <PublicStatusCard
              name={preview?.name || server?.name || 'Server'}
              description={preview?.description}
              online={preview?.online ?? false}
              playerCount={preview?.playerCount ?? 0}
              maxPlayers={preview?.maxPlayers ?? null}
              motd={preview?.motd}
              address={preview?.address}
              accentColor={accentColor}
              banner={banner || null}
              logo={logo || null}
              announcement={announcement || null}
              allowCustomCss={false}
            />
          )}
        </div>
        <p className="text-[11px] text-slate-600">
          Player count and online status are live from your server. Custom CSS only applies on the real page — open it to see the full effect.
        </p>
      </div>
    </div>
  );
}
