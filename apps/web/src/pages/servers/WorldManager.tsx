import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { cn, formatBytes } from '@/lib/utils';
import {
  Search, Globe2, Download, Trash2, RefreshCw, CheckCircle2,
  ExternalLink, Mountain, ArrowDownToLine, Info,
} from 'lucide-react';

interface WorldEntry {
  name: string;
  size: number;
  active: boolean;
}

interface CurseForgeWorldSummary {
  id: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  downloadCount: number;
  websiteUrl: string;
}

interface CurseForgeWorldFile {
  id: number;
  fileName: string;
  displayName: string;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function slugifyWorldName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'world';
}

export function WorldManager({ serverId }: { serverId: string }) {
  const [worlds, setWorlds] = useState<WorldEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorldEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [cfConfigured, setCfConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 400);
  const [results, setResults] = useState<CurseForgeWorldSummary[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [installTarget, setInstallTarget] = useState<CurseForgeWorldSummary | null>(null);
  const [installFiles, setInstallFiles] = useState<CurseForgeWorldFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [worldName, setWorldName] = useState('');
  const [installing, setInstalling] = useState(false);

  const loadWorlds = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/servers/${serverId}/worlds`);
      setWorlds(data.worlds || []);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to load worlds');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { loadWorlds(); }, [loadWorlds]);

  useEffect(() => {
    api.get('/curseforge/status').then(({ data }) => setCfConfigured(!!data.configured)).catch(() => setCfConfigured(false));
  }, []);

  const runSearch = useCallback(async (index: number, append: boolean) => {
    if (!cfConfigured) return;
    if (append) setLoadingMore(true); else setSearching(true);
    try {
      const { data } = await api.get('/curseforge/worlds/search', { params: { query: debouncedQuery, index, pageSize: 20 } });
      setResults((prev) => (append ? [...prev, ...(data.results ?? [])] : (data.results ?? [])));
      setTotalHits(data.totalCount ?? 0);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to search premade worlds');
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  }, [debouncedQuery, cfConfigured]);

  useEffect(() => { if (cfConfigured) runSearch(0, false); }, [runSearch, cfConfigured]);

  const switchActive = async (world: WorldEntry) => {
    setSwitching(world.name);
    try {
      await api.put(`/servers/${serverId}/worlds/active`, { name: world.name });
      toast.success(`Active world set to "${world.name}" — restart the server to load it`);
      loadWorlds();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to switch world');
    } finally {
      setSwitching(null);
    }
  };

  const downloadWorld = async (world: WorldEntry) => {
    setDownloading(world.name);
    try {
      const res = await api.get(`/servers/${serverId}/worlds/${encodeURIComponent(world.name)}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${world.name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download world');
    } finally {
      setDownloading(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/servers/${serverId}/worlds/${encodeURIComponent(deleteTarget.name)}`);
      toast.success(`World "${deleteTarget.name}" deleted`);
      setWorlds((prev) => prev.filter((w) => w.name !== deleteTarget.name));
      setDeleteTarget(null);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to delete world');
    } finally {
      setDeleting(false);
    }
  };

  const openInstall = async (world: CurseForgeWorldSummary) => {
    setInstallTarget(world);
    setWorldName(slugifyWorldName(world.name));
    setInstallFiles([]);
    setLoadingFiles(true);
    try {
      const { data } = await api.get(`/curseforge/worlds/${world.id}/files`);
      const files: CurseForgeWorldFile[] = (data.files ?? []).filter((f: CurseForgeWorldFile) => !!f.downloadUrl);
      setInstallFiles(files);
    } catch {
      toast.error('Failed to load download options for this world');
    } finally {
      setLoadingFiles(false);
    }
  };

  const install = async (file: CurseForgeWorldFile) => {
    if (!file.downloadUrl) return;
    const name = slugifyWorldName(worldName);
    if (worlds.some((w) => w.name === name)) {
      toast.error(`A world named "${name}" already exists`);
      return;
    }
    setInstalling(true);
    try {
      await api.post(`/servers/${serverId}/worlds/install`, { url: file.downloadUrl, name });
      toast.success(`World "${name}" installed`);
      setInstallTarget(null);
      loadWorlds();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to install world');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Your worlds */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Your Worlds</h3>
            <p className="text-xs text-slate-500 mt-0.5">{worlds.length} world(s) on this server</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={loadWorlds}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <div className="divide-y divide-dark-800/50">
          {loading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : worlds.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Globe2 size={28} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No worlds found</p>
            </div>
          ) : (
            worlds.map((world) => (
              <div key={world.name} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-md bg-dark-800 flex items-center justify-center shrink-0">
                  <Globe2 size={14} className="text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200 truncate font-mono">{world.name}</span>
                    {world.active && (
                      <span className="badge text-[10px] bg-panel-500/15 text-panel-400 flex items-center gap-1 shrink-0">
                        <CheckCircle2 size={10} /> Active
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-slate-600 shrink-0">{formatBytes(world.size)}</span>
                {!world.active && (
                  <button
                    className="btn-secondary btn-sm shrink-0"
                    onClick={() => switchActive(world)}
                    disabled={switching === world.name}
                  >
                    {switching === world.name ? <Spinner size="sm" /> : 'Set Active'}
                  </button>
                )}
                <button
                  className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-dark-700 rounded transition-colors shrink-0"
                  onClick={() => downloadWorld(world)}
                  disabled={downloading === world.name}
                  title="Download as .zip"
                >
                  {downloading === world.name ? <Spinner size="sm" /> : <ArrowDownToLine size={14} />}
                </button>
                <button
                  className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors shrink-0 disabled:opacity-30 disabled:hover:text-slate-500 disabled:hover:bg-transparent"
                  onClick={() => setDeleteTarget(world)}
                  disabled={world.active}
                  title={world.active ? 'Cannot delete the active world' : 'Delete'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Premade worlds (CurseForge) */}
      {cfConfigured === false ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-dark-800/50 border border-dark-700 text-slate-500 text-xs">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>The premade world browser isn't set up yet — an admin needs to add a CurseForge API key in Admin Settings.</span>
        </div>
      ) : cfConfigured === true ? (
        <div className="card">
          <div className="card-header">
            <h3 className="text-sm font-semibold text-slate-100">Premade Worlds</h3>
            <p className="text-xs text-slate-500 mt-0.5">Browse and install ready-made worlds — castles, mansions, and more</p>
          </div>
          <div className="p-4 border-b border-dark-800">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                className="input pl-9"
                placeholder="Search worlds (e.g. castle, mansion, skyblock)..."
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
                <Mountain size={32} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">No worlds found</p>
              </div>
            ) : (
              <>
                {results.map((world) => (
                  <div key={world.id} className="flex items-start gap-4 px-5 py-4">
                    {world.logoUrl ? (
                      <img src={world.logoUrl} alt="" className="w-10 h-10 rounded-lg shrink-0 object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center shrink-0">
                        <Mountain size={18} className="text-slate-500" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-200">{world.name}</p>
                        {world.websiteUrl && (
                          <a
                            href={world.websiteUrl} target="_blank" rel="noopener noreferrer"
                            className="text-slate-600 hover:text-slate-400" title="View on CurseForge"
                          ><ExternalLink size={11} /></a>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{world.summary}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600">
                        <span className="flex items-center gap-1"><Download size={11} />{world.downloadCount.toLocaleString()}</span>
                      </div>
                    </div>
                    <button className="btn-primary btn-sm shrink-0" onClick={() => openInstall(world)}>
                      <Download size={13} /> Install
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
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete world?"
        message={`This will permanently delete "${deleteTarget?.name}". This cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleting}
      />

      <Modal isOpen={!!installTarget} onClose={() => setInstallTarget(null)} title={`Install "${installTarget?.name}"`} size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">World folder name</label>
            <input
              type="text"
              className="input font-mono"
              value={worldName}
              onChange={(e) => setWorldName(e.target.value)}
              onBlur={(e) => setWorldName(slugifyWorldName(e.target.value))}
            />
            <p className="text-xs text-slate-600 mt-1">This will be installed as a new world alongside your existing ones. Set it active afterward to load it.</p>
          </div>
          <div>
            <label className="label">Choose a version to download</label>
            {loadingFiles ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : installFiles.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">No downloadable files available for this world.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {installFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-3 p-3 rounded-lg border border-dark-700 bg-dark-800/40">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">{file.displayName}</p>
                      <div className="flex items-center gap-2 text-xs text-slate-600 mt-0.5">
                        <span>{formatBytes(file.fileLength)}</span>
                        <span>{new Date(file.fileDate).toLocaleDateString()}</span>
                        {file.gameVersions?.slice(0, 3).map((gv) => (
                          <span key={gv} className={cn('px-1.5 py-0.5 rounded bg-dark-800 text-slate-500')}>{gv}</span>
                        ))}
                      </div>
                    </div>
                    <button className="btn-primary btn-sm shrink-0" onClick={() => install(file)} disabled={installing}>
                      {installing ? <Spinner size="sm" /> : 'Install'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
