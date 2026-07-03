import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn, formatBytes } from '@/lib/utils';
import {
  Search, Package, Download, Trash2, RefreshCw, ArrowUpCircle,
  Power, PowerOff, ExternalLink, X, Users, ArrowDownToLine,
} from 'lucide-react';

interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  follows: number;
  icon_url?: string;
  categories: string[];
  author: string;
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  loaders: string[];
  game_versions: string[];
  files: { url: string; filename: string; primary: boolean; size: number }[];
}

interface FileEntry {
  name: string;
  size: number;
  isFile: boolean;
  isDir: boolean;
  modifiedAt: string;
}

interface ManifestEntry {
  projectId: string;
  versionId: string;
  title: string;
  iconUrl?: string;
}

type Manifest = Record<string, ManifestEntry>;

interface ModrinthFileMatch {
  projectId: string;
  projectTitle: string;
  iconUrl: string | null;
  versionId: string;
  versionNumber: string;
}

interface CurseForgeFileMatch {
  modId: number;
  modName: string;
  iconUrl: string | null;
  fileId: number;
  fileName: string;
  latestFileId: number;
  latestFileName: string;
}

interface DetectedEntry {
  filename: string;
  source: 'modrinth' | 'curseforge';
  title: string;
  iconUrl?: string | null;
  hasUpdate: boolean;
  modrinth?: { projectId: string; latestVersion?: ModrinthVersion };
  curseforge?: { modId: number; latestFileId: number };
}

const SORT_OPTIONS = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Most Downloads' },
  { id: 'follows', label: 'Most Followed' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently Updated' },
];

// Genre tags only — loader tags (paper/spigot/bukkit/etc.) are handled
// separately via MC version + loader matching, not shown as filter chips.
const CATEGORIES = [
  'adventure', 'decoration', 'economy', 'equipment', 'game-mechanics',
  'library', 'magic', 'management', 'minigame', 'mobs', 'optimization',
  'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen',
];

const MANIFEST_PATH = '/plugins/.kretase-manifest.json';
const PREFERRED_LOADERS = ['paper', 'purpur', 'folia', 'spigot', 'bukkit'];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function pickBestVersion(versions: ModrinthVersion[], mcVersion?: string): { version: ModrinthVersion; exact: boolean } {
  let candidates = versions;
  let exact = true;
  if (mcVersion) {
    const exactMatch = versions.filter((v) => v.game_versions?.includes(mcVersion));
    if (exactMatch.length > 0) {
      candidates = exactMatch;
    } else {
      exact = false;
      const majorMinor = mcVersion.split('.').slice(0, 2).join('.');
      const minorMatch = versions.filter((v) =>
        v.game_versions?.some((gv) => gv === majorMinor || gv.startsWith(`${majorMinor}.`))
      );
      if (minorMatch.length > 0) candidates = minorMatch;
    }
  }
  const best = candidates.find((v) => v.loaders?.some((l) => PREFERRED_LOADERS.includes(l.toLowerCase()))) ?? candidates[0];
  return { version: best, exact };
}

export function PluginManager({ serverId, mcVersion }: { serverId: string; mcVersion?: string }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 400);
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState('relevance');
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalHits, setTotalHits] = useState(0);

  const [installed, setInstalled] = useState<FileEntry[]>([]);
  const [manifest, setManifest] = useState<Manifest>({});
  const [installedLoading, setInstalledLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, ModrinthVersion>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [detected, setDetected] = useState<DetectedEntry[]>([]);

  const runSearch = useCallback(async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true); else setSearching(true);
    try {
      // Modrinth facets: outer groups are AND'd, entries within a group are
      // OR'd — selected categories should match ANY of them, not ALL, so
      // they all go in one group together.
      const facetGroups: string[][] = [['project_type:plugin']];
      if (categories.length > 0) facetGroups.push(categories.map((c) => `categories:${c}`));
      const params = new URLSearchParams({
        query: debouncedQuery,
        facets: JSON.stringify(facetGroups),
        index: sort,
        limit: '20',
        offset: String(offset),
      });
      const res = await fetch(`https://api.modrinth.com/v2/search?${params}`);
      const json = await res.json();
      setResults((prev) => (append ? [...prev, ...(json.hits ?? [])] : (json.hits ?? [])));
      setTotalHits(json.total_hits ?? 0);
    } catch {
      toast.error('Failed to search plugins');
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  }, [debouncedQuery, categories, sort]);

  useEffect(() => { runSearch(0, false); }, [runSearch]);

  const loadManifest = async (): Promise<Manifest> => {
    try {
      const { data } = await api.get(`/servers/${serverId}/files/contents`, { params: { file: MANIFEST_PATH } });
      return JSON.parse(data.content || '{}');
    } catch {
      return {};
    }
  };

  const saveManifest = async (m: Manifest) => {
    await api.post(`/servers/${serverId}/files/write`, { file: MANIFEST_PATH, content: JSON.stringify(m, null, 2) });
  };

  const loadInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const [{ data }, m] = await Promise.all([
        api.get(`/servers/${serverId}/files`, { params: { directory: '/plugins' } }),
        loadManifest(),
      ]);
      const jars = ((data.files as FileEntry[]) || []).filter(
        (f) => f.isFile && (f.name.endsWith('.jar') || f.name.endsWith('.jar.disabled'))
      );
      setInstalled(jars);
      setManifest(m);
      setDetected([]);
      setUpdates({});
    } catch {
      setInstalled([]);
    } finally {
      setInstalledLoading(false);
    }
  }, [serverId]);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const install = async (project: ModrinthProject) => {
    setInstalling(project.project_id);
    try {
      const versRes = await fetch(`https://api.modrinth.com/v2/project/${project.project_id}/version`);
      if (!versRes.ok) { toast.error('Could not fetch version list'); return; }
      const allVersions: ModrinthVersion[] = await versRes.json();
      if (!allVersions.length) { toast.error('No versions found for this plugin'); return; }

      const { version: best, exact } = pickBestVersion(allVersions, mcVersion);
      if (!best) { toast.error('No compatible version found'); return; }
      if (!mcVersion) toast('Tip: install a Paper version first for accurate matching.', { icon: 'ℹ️' });
      else if (!exact) toast(`No exact ${mcVersion} build — installed closest match.`, { icon: '⚠️' });

      const file = best.files.find((f) => f.primary) ?? best.files[0];
      if (!file) { toast.error('No downloadable file found'); return; }

      await api.post(`/servers/${serverId}/plugins/install`, { url: file.url, filename: file.filename, type: 'plugins' });

      const m = await loadManifest();
      m[file.filename] = { projectId: project.project_id, versionId: best.id, title: project.title, iconUrl: project.icon_url };
      await saveManifest(m);

      toast.success(`${project.title} installed`);
      loadInstalled();
    } catch {
      toast.error('Installation failed');
    } finally {
      setInstalling(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.post(`/servers/${serverId}/files/delete`, { files: [`/plugins/${deleteTarget.name}`] });
      const m = await loadManifest();
      delete m[deleteTarget.name];
      await saveManifest(m);
      toast.success(`${deleteTarget.name} deleted`);
      setInstalled((prev) => prev.filter((p) => p.name !== deleteTarget.name));
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete plugin');
    } finally {
      setDeleting(false);
    }
  };

  const toggleEnabled = async (file: FileEntry) => {
    setToggling(file.name);
    const isDisabled = file.name.endsWith('.disabled');
    const newName = isDisabled ? file.name.replace(/\.disabled$/, '') : `${file.name}.disabled`;
    try {
      await api.put(`/servers/${serverId}/files/rename`, { from: `/plugins/${file.name}`, to: `/plugins/${newName}` });
      const m = await loadManifest();
      if (m[file.name]) {
        m[newName] = m[file.name];
        delete m[file.name];
        await saveManifest(m);
      }
      toast.success(isDisabled ? 'Plugin enabled' : 'Plugin disabled');
      loadInstalled();
    } catch {
      toast.error('Failed to toggle plugin');
    } finally {
      setToggling(null);
    }
  };

  const checkUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const entries = Object.entries(manifest);
      const found: Record<string, ModrinthVersion> = {};
      for (const [filename, meta] of entries) {
        try {
          const res = await fetch(`https://api.modrinth.com/v2/project/${meta.projectId}/version`);
          const versions: ModrinthVersion[] = await res.json();
          const { version: latest } = pickBestVersion(versions, mcVersion);
          if (latest && latest.id !== meta.versionId) found[filename] = latest;
        } catch { /* skip this plugin, keep checking the rest */ }
      }
      setUpdates(found);

      // Files with no manifest entry (manually uploaded, or predating the
      // manifest) — identify them by hash instead of trusting a filename.
      const unmanaged = installed.filter((f) => !manifest[f.name]);
      const newDetected: DetectedEntry[] = [];
      if (unmanaged.length > 0) {
        try {
          const { data } = await api.get(`/servers/${serverId}/files/detect`, { params: { directory: '/plugins' } });
          const rows: { name: string; modrinth: ModrinthFileMatch | null; curseforge: CurseForgeFileMatch | null }[] = data.data || [];
          for (const row of rows) {
            if (row.modrinth) {
              let latestVersion: ModrinthVersion | undefined;
              try {
                const res = await fetch(`https://api.modrinth.com/v2/project/${row.modrinth.projectId}/version`);
                const versions: ModrinthVersion[] = await res.json();
                latestVersion = pickBestVersion(versions, mcVersion).version;
              } catch { /* still show current identity even if latest lookup fails */ }
              newDetected.push({
                filename: row.name, source: 'modrinth',
                title: row.modrinth.projectTitle, iconUrl: row.modrinth.iconUrl,
                hasUpdate: !!latestVersion && latestVersion.id !== row.modrinth.versionId,
                modrinth: { projectId: row.modrinth.projectId, latestVersion },
              });
            } else if (row.curseforge) {
              newDetected.push({
                filename: row.name, source: 'curseforge',
                title: row.curseforge.modName, iconUrl: row.curseforge.iconUrl,
                hasUpdate: row.curseforge.latestFileId !== row.curseforge.fileId,
                curseforge: { modId: row.curseforge.modId, latestFileId: row.curseforge.latestFileId },
              });
            }
          }
        } catch { /* detection endpoint unavailable — manifest-based results still shown */ }
      }
      setDetected(newDetected);

      const total = Object.keys(found).length + newDetected.filter((d) => d.hasUpdate).length;
      if (total === 0) toast.success('All plugins are up to date');
      else toast(`${total} update(s) available`, { icon: '⬆️' });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const applyDetectedUpdate = async (entry: DetectedEntry) => {
    setInstalling(entry.filename);
    try {
      if (entry.source === 'modrinth' && entry.modrinth?.latestVersion) {
        const file = entry.modrinth.latestVersion.files.find((f) => f.primary) ?? entry.modrinth.latestVersion.files[0];
        if (!file) return;
        await api.post(`/servers/${serverId}/files/delete`, { files: [`/plugins/${entry.filename}`] });
        await api.post(`/servers/${serverId}/plugins/install`, { url: file.url, filename: file.filename, type: 'plugins' });
        // Now that we know its identity, adopt it into the manifest so
        // future checks are instant instead of re-detecting by hash.
        const m = await loadManifest();
        m[file.filename] = { projectId: entry.modrinth.projectId, versionId: entry.modrinth.latestVersion.id, title: entry.title, iconUrl: entry.iconUrl || undefined };
        await saveManifest(m);
      } else if (entry.source === 'curseforge' && entry.curseforge) {
        const { data } = await api.get(`/curseforge/mods/${entry.curseforge.modId}/files`);
        const files: { id: number; downloadUrl: string | null; fileName: string }[] = data.files || [];
        const target = files.find((f) => f.id === entry.curseforge!.latestFileId);
        if (!target?.downloadUrl) { toast.error('No direct download available for the latest file'); return; }
        await api.post(`/servers/${serverId}/files/delete`, { files: [`/plugins/${entry.filename}`] });
        await api.post(`/servers/${serverId}/plugins/install`, { url: target.downloadUrl, filename: target.fileName, type: 'plugins' });
      }
      setDetected((prev) => prev.filter((d) => d.filename !== entry.filename));
      toast.success(`${entry.title} updated`);
      loadInstalled();
    } catch {
      toast.error('Update failed');
    } finally {
      setInstalling(null);
    }
  };

  const applyUpdate = async (filename: string) => {
    const latest = updates[filename];
    const meta = manifest[filename];
    if (!latest || !meta) return;
    setInstalling(filename);
    try {
      const file = latest.files.find((f) => f.primary) ?? latest.files[0];
      if (!file) return;
      await api.post(`/servers/${serverId}/files/delete`, { files: [`/plugins/${filename}`] });
      await api.post(`/servers/${serverId}/plugins/install`, { url: file.url, filename: file.filename, type: 'plugins' });

      const m = await loadManifest();
      delete m[filename];
      m[file.filename] = { projectId: meta.projectId, versionId: latest.id, title: meta.title, iconUrl: meta.iconUrl };
      await saveManifest(m);

      setUpdates((prev) => { const n = { ...prev }; delete n[filename]; return n; });
      toast.success(`${meta.title} updated to ${latest.version_number}`);
      loadInstalled();
    } catch {
      toast.error('Update failed');
    } finally {
      setInstalling(null);
    }
  };

  const toggleCategory = (cat: string) => {
    setCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  return (
    <div className="space-y-4">
      {/* Installed plugins */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Installed Plugins</h3>
            <p className="text-xs text-slate-500 mt-0.5">{installed.length} plugin(s) in /plugins</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={checkUpdates} disabled={checkingUpdates}>
              {checkingUpdates ? <Spinner size="sm" /> : <ArrowUpCircle size={13} />} Check Updates
            </button>
            <button className="btn-secondary btn-sm" onClick={loadInstalled}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
        <div className="divide-y divide-dark-800/50">
          {installedLoading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : installed.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Package size={28} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">No plugins installed</p>
            </div>
          ) : (
            installed.map((plugin) => {
              const isDisabled = plugin.name.endsWith('.disabled');
              const meta = manifest[plugin.name];
              const update = updates[plugin.name];
              return (
                <div key={plugin.name} className="flex items-center gap-3 px-4 py-3">
                  {meta?.iconUrl ? (
                    <img src={meta.iconUrl} alt="" className="w-8 h-8 rounded-md shrink-0 object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-dark-800 flex items-center justify-center shrink-0">
                      <Package size={14} className="text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm font-medium truncate', isDisabled ? 'text-slate-500' : 'text-slate-200')}>
                        {meta?.title ?? plugin.name.replace(/\.disabled$/, '')}
                      </span>
                      {isDisabled && <span className="badge text-[10px] bg-dark-700 text-slate-500 shrink-0">Disabled</span>}
                      {update && <span className="badge text-[10px] bg-blue-500/15 text-blue-400 shrink-0">Update available</span>}
                    </div>
                    <p className="text-xs text-slate-600 font-mono truncate">{plugin.name}</p>
                  </div>
                  <span className="text-xs text-slate-600 shrink-0">{formatBytes(plugin.size)}</span>
                  {update && (
                    <button
                      className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors shrink-0"
                      onClick={() => applyUpdate(plugin.name)}
                      disabled={installing === plugin.name}
                      title={`Update to ${update.version_number}`}
                    >
                      {installing === plugin.name ? <Spinner size="sm" /> : <ArrowDownToLine size={14} />}
                    </button>
                  )}
                  <button
                    className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-dark-700 rounded transition-colors shrink-0"
                    onClick={() => toggleEnabled(plugin)}
                    disabled={toggling === plugin.name}
                    title={isDisabled ? 'Enable' : 'Disable'}
                  >
                    {toggling === plugin.name ? <Spinner size="sm" /> : isDisabled ? <Power size={14} /> : <PowerOff size={14} />}
                  </button>
                  <button
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors shrink-0"
                    onClick={() => setDeleteTarget(plugin)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Hash-detected plugins that aren't tracked in the manifest yet
          (manually uploaded, or predate it) */}
      {detected.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="text-sm font-semibold text-slate-100">Detected (unmanaged)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Identified by file hash, not filename — installed outside this panel or before update-tracking was added.
            </p>
          </div>
          <div className="divide-y divide-dark-800/50">
            {detected.map((entry) => (
              <div key={entry.filename} className="flex items-center gap-3 px-4 py-3">
                {entry.iconUrl ? (
                  <img src={entry.iconUrl} alt="" className="w-8 h-8 rounded-md shrink-0 object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-md bg-dark-800 flex items-center justify-center shrink-0">
                    <Package size={14} className="text-slate-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200 truncate">{entry.title}</span>
                    <span className="badge text-[10px] bg-dark-700 text-slate-500 shrink-0 capitalize">{entry.source}</span>
                    {entry.hasUpdate && <span className="badge text-[10px] bg-blue-500/15 text-blue-400 shrink-0">Update available</span>}
                  </div>
                  <p className="text-xs text-slate-600 font-mono truncate">{entry.filename}</p>
                </div>
                {entry.hasUpdate && (
                  <button
                    className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors shrink-0"
                    onClick={() => applyDetectedUpdate(entry)}
                    disabled={installing === entry.filename}
                    title="Update"
                  >
                    {installing === entry.filename ? <Spinner size="sm" /> : <ArrowDownToLine size={14} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plugin marketplace */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-sm font-semibold text-slate-100">Plugin Marketplace</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Search and install plugins directly to your server
            {mcVersion && <span className="ml-1">— matching Minecraft {mcVersion}</span>}
          </p>
        </div>
        <div className="p-4 border-b border-dark-800 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                className="input pl-9"
                placeholder="Search plugins (e.g. WorldEdit, EssentialsX)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select className="input w-44" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors capitalize',
                  categories.includes(cat)
                    ? 'bg-panel-500/20 border-panel-500/40 text-panel-300'
                    : 'bg-dark-800 border-dark-700 text-slate-500 hover:text-slate-300 hover:border-dark-600'
                )}
              >
                {cat.replace('-', ' ')}
              </button>
            ))}
            {categories.length > 0 && (
              <button onClick={() => setCategories([])} className="px-2.5 py-1 rounded-full text-[11px] text-slate-500 hover:text-red-400 flex items-center gap-1">
                <X size={11} /> Clear
              </button>
            )}
          </div>
        </div>
        <div className="divide-y divide-dark-800/50">
          {searching ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Package size={32} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No plugins found</p>
            </div>
          ) : (
            <>
              {results.map((project) => (
                <div key={project.project_id} className="flex items-start gap-4 px-5 py-4">
                  {project.icon_url ? (
                    <img src={project.icon_url} alt="" className="w-10 h-10 rounded-lg shrink-0 object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center shrink-0">
                      <Package size={18} className="text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-200">{project.title}</p>
                      <a
                        href={`https://modrinth.com/plugin/${project.slug}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-slate-600 hover:text-slate-400"
                        title="View on Modrinth"
                      ><ExternalLink size={11} /></a>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{project.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600">
                      <span className="flex items-center gap-1"><Download size={11} />{project.downloads.toLocaleString()}</span>
                      <span className="flex items-center gap-1"><Users size={11} />{project.follows.toLocaleString()}</span>
                      <span>by {project.author}</span>
                    </div>
                    {project.categories?.filter((c) => CATEGORIES.includes(c)).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {project.categories.filter((c) => CATEGORIES.includes(c)).slice(0, 4).map((c) => (
                          <span key={c} className="px-1.5 py-0.5 rounded text-[10px] bg-dark-800 text-slate-500 capitalize">{c.replace('-', ' ')}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn-primary btn-sm shrink-0"
                    disabled={installing === project.project_id}
                    onClick={() => install(project)}
                  >
                    {installing === project.project_id ? <Spinner size="sm" /> : <><Download size={13} /> Install</>}
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

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete plugin?"
        message={`This will permanently delete ${deleteTarget?.name}. This cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleting}
      />
    </div>
  );
}
