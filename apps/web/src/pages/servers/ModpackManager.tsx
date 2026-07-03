import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ServerStatus } from '@/types';
import {
  Search, Boxes, Download, ExternalLink, Info, AlertTriangle, Package,
} from 'lucide-react';

type Source = 'curseforge' | 'modrinth';

interface PackSummary {
  id: string; // modId (CF) or projectId (Modrinth), stringified
  name: string;
  summary: string;
  iconUrl: string | null;
  downloads: number;
  websiteUrl?: string;
}

interface PackVersion {
  id: string; // fileId (CF) or versionId (Modrinth), stringified
  label: string;
  gameVersions: string[];
  loaders: string[];
  date: string;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function ModpackManager({ serverId, serverStatus, onInstalled }: {
  serverId: string; serverStatus: ServerStatus; onInstalled: () => void;
}) {
  const [source, setSource] = useState<Source>('modrinth');
  const [cfConfigured, setCfConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 400);
  const [results, setResults] = useState<PackSummary[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedPack, setSelectedPack] = useState<PackSummary | null>(null);
  const [versions, setVersions] = useState<PackVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState<PackVersion | null>(null);
  const [installing, setInstalling] = useState(false);

  const isBusy = serverStatus === 'INSTALLING' || serverStatus === 'MIGRATING' || serverStatus === 'RESTORING_BACKUP';

  useEffect(() => {
    api.get('/curseforge/status').then(({ data }) => setCfConfigured(!!data.configured)).catch(() => setCfConfigured(false));
  }, []);

  const runSearch = useCallback(async (offset: number, append: boolean) => {
    if (source === 'curseforge' && !cfConfigured) return;
    if (append) setLoadingMore(true); else setSearching(true);
    try {
      if (source === 'modrinth') {
        const { data } = await api.get('/modrinth/modpacks/search', { params: { query: debouncedQuery, offset, limit: 20 } });
        const mapped: PackSummary[] = (data.results ?? []).map((r: { projectId: string; title: string; description: string; iconUrl: string | null; downloads: number }) => ({
          id: r.projectId, name: r.title, summary: r.description, iconUrl: r.iconUrl, downloads: r.downloads,
        }));
        setResults((prev) => (append ? [...prev, ...mapped] : mapped));
        setTotalHits(data.totalHits ?? mapped.length);
      } else {
        const { data } = await api.get('/curseforge/modpacks/search', { params: { query: debouncedQuery, index: offset, pageSize: 20 } });
        const mapped: PackSummary[] = (data.results ?? []).map((r: { id: number; name: string; summary: string; logoUrl: string | null; downloadCount: number; websiteUrl: string }) => ({
          id: String(r.id), name: r.name, summary: r.summary, iconUrl: r.logoUrl, downloads: r.downloadCount, websiteUrl: r.websiteUrl,
        }));
        setResults((prev) => (append ? [...prev, ...mapped] : mapped));
        setTotalHits(data.totalCount ?? mapped.length);
      }
    } catch {
      toast.error('Failed to search modpacks');
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  }, [debouncedQuery, source, cfConfigured]);

  useEffect(() => {
    if (source === 'modrinth' || cfConfigured) runSearch(0, false);
  }, [runSearch, source, cfConfigured]);

  const openPack = async (pack: PackSummary) => {
    setSelectedPack(pack);
    setVersions([]);
    setLoadingVersions(true);
    try {
      if (source === 'modrinth') {
        const { data } = await api.get(`/modrinth/modpacks/${pack.id}/versions`);
        const mapped: PackVersion[] = (data.versions ?? []).map((v: { id: string; versionNumber: string; name: string; gameVersions: string[]; loaders: string[]; datePublished: string }) => ({
          id: v.id, label: `${v.name} (${v.versionNumber})`, gameVersions: v.gameVersions, loaders: v.loaders, date: v.datePublished,
        }));
        setVersions(mapped);
      } else {
        const { data } = await api.get(`/curseforge/modpacks/${pack.id}/files`);
        const mapped: PackVersion[] = (data.files ?? []).map((f: { id: number; displayName: string; gameVersions: string[]; fileDate: string }) => ({
          id: String(f.id), label: f.displayName, gameVersions: f.gameVersions, loaders: f.gameVersions.filter((g) => /fabric|forge|quilt|neoforge/i.test(g)), date: f.fileDate,
        }));
        setVersions(mapped);
      }
    } catch {
      toast.error('Failed to load versions for this pack');
    } finally {
      setLoadingVersions(false);
    }
  };

  const install = async () => {
    if (!confirmVersion || !selectedPack) return;
    setInstalling(true);
    try {
      const payload = source === 'modrinth'
        ? { source, packName: selectedPack.name, versionId: confirmVersion.id }
        : { source, packName: selectedPack.name, modId: Number(selectedPack.id), fileId: Number(confirmVersion.id) };
      await api.post(`/servers/${serverId}/modpack/install`, payload);
      toast.success('Modpack install started — this will take a few minutes');
      setConfirmVersion(null);
      setSelectedPack(null);
      onInstalled();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to start modpack install');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-dark-800/50 border border-dark-700 text-slate-400 text-xs">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>
          Installing a modpack reinstalls the server onto the Fabric loader and wipes existing files first. Only Fabric packs can be
          auto-installed right now — Forge/NeoForge/Quilt support is coming soon.
        </span>
      </div>

      {isBusy && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-cyan-400 text-xs">
          <Spinner size="sm" /> An operation is already in progress on this server — wait for it to finish before installing a modpack.
        </div>
      )}

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-dark-800 p-1">
            <button
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${source === 'modrinth' ? 'bg-panel-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => { setSource('modrinth'); setResults([]); }}
            >
              Modrinth
            </button>
            <button
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${source === 'curseforge' ? 'bg-panel-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => { setSource('curseforge'); setResults([]); }}
            >
              CurseForge
            </button>
          </div>
        </div>

        {source === 'curseforge' && cfConfigured === false ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            CurseForge browsing isn't set up yet — an admin needs to add a CurseForge API key in Admin Settings.
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-dark-800">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  className="input pl-9"
                  placeholder="Search modpacks (e.g. all the mods, create, valhelsia)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="divide-y divide-dark-800/50">
              {searching ? (
                <div className="flex justify-center py-10"><Spinner /></div>
              ) : results.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <Boxes size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No modpacks found</p>
                </div>
              ) : (
                <>
                  {results.map((pack) => (
                    <div key={pack.id} className="flex items-start gap-4 px-5 py-4">
                      {pack.iconUrl ? (
                        <img src={pack.iconUrl} alt="" className="w-10 h-10 rounded-lg shrink-0 object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center shrink-0">
                          <Package size={18} className="text-slate-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-200">{pack.name}</p>
                          {pack.websiteUrl && (
                            <a href={pack.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-400">
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{pack.summary}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600">
                          <span className="flex items-center gap-1"><Download size={11} />{pack.downloads.toLocaleString()}</span>
                        </div>
                      </div>
                      <button className="btn-primary btn-sm shrink-0" onClick={() => openPack(pack)} disabled={isBusy}>
                        View versions
                      </button>
                    </div>
                  ))}
                  {results.length < totalHits && (
                    <div className="p-4 flex justify-center">
                      <button className="btn-secondary btn-sm" onClick={() => runSearch(results.length, true)} disabled={loadingMore}>
                        {loadingMore ? <Spinner size="sm" /> : `Load more (${totalHits - results.length} remaining)`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <Modal isOpen={!!selectedPack} onClose={() => setSelectedPack(null)} title={`Install "${selectedPack?.name}"`} size="lg">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {loadingVersions ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No versions available for this pack.</p>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-lg border border-dark-700 bg-dark-800/40">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{v.label}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-600 mt-0.5 flex-wrap">
                    <span>{new Date(v.date).toLocaleDateString()}</span>
                    {v.gameVersions?.slice(0, 3).map((gv) => (
                      <span key={gv} className="px-1.5 py-0.5 rounded bg-dark-800 text-slate-500">{gv}</span>
                    ))}
                    {v.loaders?.map((l) => (
                      <span key={l} className={`px-1.5 py-0.5 rounded ${l.toLowerCase() === 'fabric' ? 'bg-panel-500/15 text-panel-400' : 'bg-yellow-500/10 text-yellow-500'}`}>{l}</span>
                    ))}
                  </div>
                </div>
                <button className="btn-primary btn-sm shrink-0" onClick={() => setConfirmVersion(v)} disabled={isBusy}>
                  Install
                </button>
              </div>
            ))
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmVersion}
        onClose={() => setConfirmVersion(null)}
        onConfirm={install}
        title="Install modpack?"
        message={`This wipes all current files on this server, reinstalls it onto Fabric, and installs "${selectedPack?.name} — ${confirmVersion?.label}". This cannot be undone.`}
        confirmLabel="Wipe & Install"
        isLoading={installing}
      />

      {!isBusy && serverStatus === 'INSTALL_FAILED' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-red-400 text-xs">
          <AlertTriangle size={14} className="shrink-0" /> The last install attempt failed — check the console for details, then try again.
        </div>
      )}
    </div>
  );
}
