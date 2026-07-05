import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, CheckSquare, Square, Download, PackagePlus } from 'lucide-react';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';

interface Category { slug: string; label: string; }
interface StoreEgg { path: string; name: string; group: string; }
interface Nest { id: string; name: string; }

type CategoryImportStatus = 'pending' | 'running' | 'done' | 'error';
interface CategoryImportState {
  slug: string;
  label: string;
  status: CategoryImportStatus;
  imported: number;
  failed: number;
  total: number;
  error?: string;
}

export function AdminEggStorePage() {
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [nestMode, setNestMode] = useState<'new' | 'existing'>('new');
  const [nestId, setNestId] = useState('');
  const [nestName, setNestName] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmImportAll, setConfirmImportAll] = useState(false);
  const [importAllProgress, setImportAllProgress] = useState<CategoryImportState[] | null>(null);
  const queryClient = useQueryClient();

  const {
    data: categories, isLoading: loadingCategories, isError: categoriesError, error: categoriesErrorObj, refetch: refetchCategories,
  } = useQuery({
    queryKey: ['egg-store-categories'],
    queryFn: () => api.get('/egg-store/categories').then((r) => r.data.data as Category[]),
    retry: 1,
  });

  const { data: nests } = useQuery({
    queryKey: ['admin-nests'],
    queryFn: () => api.get('/eggs/nests').then((r) => r.data.data as Nest[]),
  });

  const { data: eggs, isLoading: loadingEggs, isError: eggsError } = useQuery({
    queryKey: ['egg-store-category', activeCategory?.slug],
    queryFn: () => api.get(`/egg-store/categories/${activeCategory!.slug}`).then((r) => r.data.data as StoreEgg[]),
    enabled: !!activeCategory,
  });

  const openCategory = (c: Category) => {
    setActiveCategory(c);
    setSelected(new Set());
    setSearch('');
    setNestMode('new');
    setNestName(c.label);
    setNestId('');
  };

  const filtered = (eggs || []).filter(
    (e) => !search.trim() || (e.name + ' ' + e.group).toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((e) => e.path)));

  const doImport = async () => {
    if (!activeCategory) return;
    if (selected.size === 0) { toast.error('Select at least one egg'); return; }
    if (nestMode === 'existing' && !nestId) { toast.error('Pick a nest'); return; }
    if (nestMode === 'new' && !nestName.trim()) { toast.error('Nest name is required'); return; }

    setImporting(true);
    try {
      const { data } = await api.post('/egg-store/import-bulk', {
        slug: activeCategory.slug,
        paths: Array.from(selected),
        ...(nestMode === 'existing' ? { nestId } : { nestName: nestName.trim() }),
      });
      const results = data.data as Array<{ path: string; success: boolean; error?: string }>;
      const ok = results.filter((r) => r.success).length;
      const failed = results.length - ok;
      if (failed === 0) toast.success(`Imported ${ok} egg${ok !== 1 ? 's' : ''}`);
      else toast.error(`Imported ${ok}, ${failed} failed`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-eggs'] });
      queryClient.invalidateQueries({ queryKey: ['admin-nests'] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // Imports every category into its own nest (named after the category
  // label) — one bulk call per category, sequential so we don't hammer the
  // community CDN with everything at once. Each category maxes out around
  // ~120 eggs today, comfortably under the /import-bulk 150-per-call cap.
  const runImportAll = async () => {
    if (!categories || categories.length === 0) return;
    setConfirmImportAll(false);
    setActiveCategory(null);
    setImportAllProgress(categories.map((c) => ({ slug: c.slug, label: c.label, status: 'pending', imported: 0, failed: 0, total: 0 })));

    for (const c of categories) {
      setImportAllProgress((prev) => prev && prev.map((p) => (p.slug === c.slug ? { ...p, status: 'running' } : p)));
      try {
        const { data: listData } = await api.get(`/egg-store/categories/${c.slug}`);
        const paths = (listData.data as StoreEgg[]).map((e) => e.path);
        if (paths.length === 0) {
          setImportAllProgress((prev) => prev && prev.map((p) => (p.slug === c.slug ? { ...p, status: 'done', total: 0 } : p)));
          continue;
        }
        const { data: importData } = await api.post('/egg-store/import-bulk', {
          slug: c.slug,
          paths,
          nestName: c.label,
        });
        const results = importData.data as Array<{ success: boolean }>;
        const imported = results.filter((r) => r.success).length;
        setImportAllProgress((prev) => prev && prev.map((p) => (
          p.slug === c.slug ? { ...p, status: 'done', total: results.length, imported, failed: results.length - imported } : p
        )));
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } };
        setImportAllProgress((prev) => prev && prev.map((p) => (
          p.slug === c.slug ? { ...p, status: 'error', error: e.response?.data?.message || 'Failed' } : p
        )));
      }
    }

    queryClient.invalidateQueries({ queryKey: ['admin-eggs'] });
    queryClient.invalidateQueries({ queryKey: ['admin-nests'] });
    toast.success('Import All finished — see the summary below');
  };

  const grouped = filtered.reduce<Record<string, StoreEgg[]>>((acc, e) => {
    const key = e.group || 'Other';
    (acc[key] ||= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {activeCategory && (
            <button className="btn-secondary btn-sm shrink-0" onClick={() => setActiveCategory(null)}>
              <ArrowLeft size={14} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Community Egg Store</h1>
            <p className="text-slate-400 text-sm mt-1">
              Real, community-maintained eggs from the pelican-eggs project — fetched live, hundreds of games and services. Have your own custom egg instead? Import it as JSON from the Eggs page.
            </p>
          </div>
        </div>
        {!activeCategory && !importAllProgress && (
          <button className="btn-primary shrink-0" onClick={() => setConfirmImportAll(true)} disabled={!categories?.length}>
            <PackagePlus size={16} /> Import All Categories
          </button>
        )}
      </div>

      {importAllProgress ? (
        <div className="card p-4 space-y-2">
          {importAllProgress.map((p) => (
            <div key={p.slug} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-zinc-800">
              <span className="text-sm text-zinc-200">{p.label}</span>
              {p.status === 'pending' && <span className="text-xs text-zinc-600">Queued</span>}
              {p.status === 'running' && <span className="text-xs text-amber-400 flex items-center gap-1.5"><Spinner size="sm" /> Importing…</span>}
              {p.status === 'done' && (
                <span className="text-xs text-panel-400">
                  {p.total === 0 ? 'No eggs found' : `Imported ${p.imported}/${p.total}`}
                  {p.failed > 0 && ` (${p.failed} failed)`}
                </span>
              )}
              {p.status === 'error' && <span className="text-xs text-red-400">{p.error || 'Failed'}</span>}
            </div>
          ))}
          {importAllProgress.every((p) => p.status === 'done' || p.status === 'error') && (
            <button className="btn-secondary btn-sm mt-2" onClick={() => setImportAllProgress(null)}>Close</button>
          )}
        </div>
      ) : !activeCategory ? (
        loadingCategories ? (
          <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        ) : categoriesError ? (
          <div className="card p-8 text-center space-y-3">
            <p className="text-red-400 font-medium">Couldn't load categories</p>
            <p className="text-xs text-zinc-500 font-mono break-all max-w-lg mx-auto">
              {(categoriesErrorObj as { response?: { status?: number; data?: { message?: string } }; message?: string })?.response
                ? `HTTP ${(categoriesErrorObj as { response?: { status?: number } }).response?.status} — ${(categoriesErrorObj as { response?: { data?: { message?: string } } }).response?.data?.message || 'no message'}`
                : (categoriesErrorObj as Error)?.message || 'Unknown error'}
            </p>
            <p className="text-xs text-zinc-600">
              This means the panel's frontend can't reach the new <code>/egg-store</code> API route — check that the API was actually restarted with the latest code (not an old process still holding the port).
            </p>
            <button className="btn-secondary btn-sm" onClick={() => refetchCategories()}>Retry</button>
          </div>
        ) : (categories || []).length === 0 ? (
          <div className="card p-8 text-center text-slate-500 text-sm">No categories returned by the API.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {(categories || []).map((c) => (
              <button
                key={c.slug}
                onClick={() => openCategory(c)}
                className="card p-5 text-left hover:border-brand-500/50 transition-colors"
              >
                <p className="font-semibold text-slate-100">{c.label}</p>
                <p className="text-xs text-slate-500 mt-1">Browse &amp; import</p>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  className="input pl-8"
                  placeholder={`Search ${activeCategory.label}...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="btn-secondary btn-sm shrink-0" onClick={toggleAll} disabled={filtered.length === 0}>
                {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-2 shrink-0">
                <button type="button" className={nestMode === 'new' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setNestMode('new')}>New Nest</button>
                <button type="button" className={nestMode === 'existing' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setNestMode('existing')}>Existing Nest</button>
              </div>
              {nestMode === 'new' ? (
                <input className="input flex-1 min-w-[160px]" placeholder="Nest name" value={nestName} onChange={(e) => setNestName(e.target.value)} />
              ) : (
                <select className="input flex-1 min-w-[160px]" value={nestId} onChange={(e) => setNestId(e.target.value)}>
                  <option value="">Select a nest…</option>
                  {(nests || []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              )}
              <button className="btn-primary shrink-0" onClick={doImport} disabled={importing || selected.size === 0}>
                {importing ? <Spinner size="sm" /> : <Download size={14} />}
                Import Selected ({selected.size})
              </button>
            </div>
          </div>

          {loadingEggs ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : eggsError ? (
            <div className="card p-12 text-center text-slate-500 text-sm">Couldn't reach the community egg repository. Try again shortly.</div>
          ) : filtered.length === 0 ? (
            <div className="card p-12 text-center text-slate-500 text-sm">No eggs match your search.</div>
          ) : (
            <div className="space-y-5">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  {group !== 'Other' && <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-2">{group}</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {items.map((e) => (
                      <label key={e.path} className="flex items-center gap-2.5 p-3 rounded-lg border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors">
                        <input type="checkbox" className="shrink-0" checked={selected.has(e.path)} onChange={() => toggle(e.path)} />
                        <span className="text-sm text-zinc-200 truncate">{e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={confirmImportAll}
        onClose={() => setConfirmImportAll(false)}
        onConfirm={runImportAll}
        title="Import All Categories"
        message="This imports every egg from every category (Minecraft, SteamCMD games, voice servers, databases, and more — roughly 280+ eggs) into their own nests. It can take a few minutes. Continue?"
        confirmLabel="Import Everything"
        variant="warning"
      />
    </div>
  );
}
