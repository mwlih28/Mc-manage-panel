import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, LayoutDashboard, Server as ServerIcon, Settings as SettingsIcon, Shield,
  Sparkles, Image as ImageIcon, Play, Square, RotateCw, Zap, Users, Boxes,
  Network, Webhook, KeyRound, Store, CreditCard, ArrowRightLeft, Activity,
  CornerDownLeft, Search as SearchIcon, type LucideIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { useCommandPalette } from '@/store/commandPaletteStore';
import { Server as ServerType } from '@/types';
import { getServerStatusDot } from '@/lib/utils';

// A single actionable row in the palette. `keywords` widen fuzzy matching
// beyond the visible title (e.g. an admin page titled "Nodes" also matches
// "server host machine"). `perform` is what runs on Enter/click.
interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  icon: LucideIcon;
  keywords?: string;
  perform: () => void | Promise<void>;
}

// Lightweight subsequence fuzzy match + score. Not a full fuzzy lib (keeps
// the zero-new-dependency posture) — good enough to rank "srv" above "server
// settings" when typing toward a specific server. Higher score = better.
// Exported for unit testing the ranking behavior.
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) {
    // Contiguous match — strongly preferred, and even more so at a word start.
    const atBoundary = direct === 0 || /\s|[-_/]/.test(t[direct - 1]);
    return 1000 - direct + (atBoundary ? 200 : 0);
  }
  // Subsequence fallback: every query char appears in order.
  let ti = 0;
  let hits = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return -1;
    if (found === ti) hits++; // reward adjacency
    ti = found + 1;
  }
  return 100 + hits;
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const navigate = useNavigate();
  const location = useLocation();
  // When the palette is opened from inside the admin shell, admin pages should
  // navigate in the same tab (you're already there); from the user panel they
  // open in a new tab, since admin is a separate surface reached that way.
  const inAdmin = location.pathname.startsWith('/admin');
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Only fetch the server list while the palette is actually open, and reuse
  // any cached copy the servers page already loaded. Capped at a generous
  // page size so the palette can jump to any server without its own paging.
  const { data: serversData } = useQuery({
    queryKey: ['command-palette-servers'],
    queryFn: () => api.get('/servers', { params: { perPage: 200 } }).then((r) => r.data),
    enabled: isOpen,
    staleTime: 30_000,
  });
  const servers: ServerType[] = serversData?.data || [];

  async function runPower(server: ServerType, action: 'start' | 'stop' | 'restart' | 'kill') {
    close();
    const verb = { start: 'Starting', stop: 'Stopping', restart: 'Restarting', kill: 'Killing' }[action];
    const t = toast.loading(`${verb} ${server.name}…`);
    try {
      await api.post(`/servers/${server.id}/power`, { action });
      toast.success(`${verb.replace('ing', 'ed')} ${server.name}`, { id: t });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['command-palette-servers'] });
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || `Could not ${action} ${server.name}`, { id: t });
    }
  }

  const commands: Command[] = useMemo(() => {
    const go = (to: string) => () => { close(); navigate(to); };
    // Admin destinations: navigate in-tab when already inside the admin shell,
    // otherwise open in a new tab (the user panel treats admin as a separate
    // surface). One helper so every admin command picks the right behavior.
    const goAdmin = (to: string) => (inAdmin
      ? () => { close(); navigate(to); }
      : () => { close(); window.open(to, '_blank', 'noopener,noreferrer'); });

    const nav: Command[] = [
      { id: 'nav-dashboard', title: 'Dashboard', group: 'Navigation', icon: LayoutDashboard, keywords: 'home overview', perform: go('/dashboard') },
      { id: 'nav-servers', title: 'Servers', group: 'Navigation', icon: ServerIcon, keywords: 'game instances list', perform: go('/servers') },
      { id: 'nav-account', title: 'Account settings', group: 'Navigation', icon: SettingsIcon, keywords: 'profile password 2fa security preferences', perform: go('/account') },
      { id: 'nav-motd', title: 'MOTD Generator', group: 'Tools', icon: Sparkles, keywords: 'message of the day', perform: go('/tools/motd-generator') },
      { id: 'nav-logo', title: 'Logo Generator', group: 'Tools', icon: ImageIcon, keywords: 'brand icon ai', perform: go('/tools/logo-generator') },
    ];

    const admin: Command[] = isAdmin ? [
      { id: 'adm-overview', title: 'Admin · Overview', group: 'Admin', icon: Shield, keywords: 'admin panel stats', perform: goAdmin('/admin') },
      { id: 'adm-servers', title: 'Admin · Servers', group: 'Admin', icon: ServerIcon, keywords: 'all servers manage', perform: goAdmin('/admin/servers') },
      { id: 'adm-users', title: 'Admin · Users', group: 'Admin', icon: Users, keywords: 'accounts members roles', perform: goAdmin('/admin/users') },
      { id: 'adm-nodes', title: 'Admin · Nodes', group: 'Admin', icon: Network, keywords: 'wings host machine daemon', perform: goAdmin('/admin/nodes') },
      { id: 'adm-eggs', title: 'Admin · Eggs', group: 'Admin', icon: Boxes, keywords: 'templates games startup', perform: goAdmin('/admin/eggs') },
      { id: 'adm-eggstore', title: 'Admin · Egg Store', group: 'Admin', icon: Store, keywords: 'community import templates', perform: goAdmin('/admin/eggs/store') },
      { id: 'adm-webhooks', title: 'Admin · Webhooks', group: 'Admin', icon: Webhook, keywords: 'discord notifications events', perform: goAdmin('/admin/webhooks') },
      { id: 'adm-integrations', title: 'Admin · Billing & Store', group: 'Admin', icon: CreditCard, keywords: 'stripe paytr tebex payments money', perform: goAdmin('/admin/integrations') },
      { id: 'adm-migration', title: 'Admin · Migration', group: 'Admin', icon: ArrowRightLeft, keywords: 'pterodactyl import move', perform: goAdmin('/admin/migration') },
      { id: 'adm-apikeys', title: 'Admin · API Keys', group: 'Admin', icon: KeyRound, keywords: 'tokens automation access', perform: goAdmin('/admin/api-keys') },
      { id: 'adm-activity', title: 'Admin · Activity Log', group: 'Admin', icon: Activity, keywords: 'audit history events', perform: goAdmin('/admin/activity') },
      { id: 'adm-settings', title: 'Admin · Settings', group: 'Admin', icon: SettingsIcon, keywords: 'smtp branding config storage', perform: goAdmin('/admin/settings') },
    ] : [];

    const serverCmds: Command[] = servers.flatMap((s) => {
      const rows: Command[] = [{
        id: `srv-${s.id}`,
        title: s.name,
        subtitle: s.uuidShort,
        group: 'Servers',
        icon: ServerIcon,
        keywords: `${s.uuidShort} ${s.status} open manage console`,
        perform: () => { close(); navigate(`/servers/${s.id}`); },
      }];
      // Only surface power actions that make sense for the current state, so
      // the palette never offers "Start" on an already-running server.
      const running = s.status === 'RUNNING';
      const stopped = s.status === 'OFFLINE' || s.status === 'INSTALL_FAILED';
      if (stopped || s.status === 'UNKNOWN') {
        rows.push({ id: `srv-${s.id}-start`, title: `Start ${s.name}`, subtitle: 'Power action', group: 'Server actions', icon: Play, keywords: `${s.uuidShort} boot run power`, perform: () => runPower(s, 'start') });
      }
      if (running || s.status === 'STARTING' || s.status === 'UNKNOWN') {
        rows.push({ id: `srv-${s.id}-restart`, title: `Restart ${s.name}`, subtitle: 'Power action', group: 'Server actions', icon: RotateCw, keywords: `${s.uuidShort} reboot power`, perform: () => runPower(s, 'restart') });
        rows.push({ id: `srv-${s.id}-stop`, title: `Stop ${s.name}`, subtitle: 'Power action', group: 'Server actions', icon: Square, keywords: `${s.uuidShort} halt shutdown power`, perform: () => runPower(s, 'stop') });
        rows.push({ id: `srv-${s.id}-kill`, title: `Kill ${s.name}`, subtitle: 'Force stop', group: 'Server actions', icon: Zap, keywords: `${s.uuidShort} force terminate power`, perform: () => runPower(s, 'kill') });
      }
      return rows;
    });

    return [...nav, ...admin, ...serverCmds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, isAdmin, inAdmin, navigate, close]);

  // Rank all commands by fuzzy score against the query, keep only matches,
  // then re-group for display. Sorting is stable within a group by score.
  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.keywords || '') - 50) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.c);
  }, [commands, query]);

  // Group the flat, score-sorted list back into labelled sections while
  // preserving each group's best-match order.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      if (!map.has(c.group)) { map.set(c.group, []); order.push(c.group); }
      map.get(c.group)!.push(c);
    }
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  // A flat, display-ordered index so ↑/↓ can walk across group boundaries.
  const flatOrdered = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Reset transient UI each time the palette opens, and focus the input.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      // Defer focus until after the element is painted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  // Keep the highlighted row scrolled into view as it moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!isOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatOrdered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flatOrdered[activeIndex]?.perform();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl rounded-2xl border overflow-hidden shadow-2xl animate-slide-up"
        style={{ background: '#0F1013', borderColor: 'rgba(255,255,255,0.08)' }}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b" style={{ borderColor: '#1C1E22' }}>
          <Search size={16} className="text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers, actions, pages…"
            className="flex-1 bg-transparent py-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:block text-[10px] font-mono text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2 scrollbar-none">
          {flatOrdered.length === 0 ? (
            <div className="px-4 py-10 text-center text-zinc-600">
              <SearchIcon size={22} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No results for “{query}”</p>
            </div>
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group} className="mb-1">
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-700">{group}</p>
                {items.map((cmd) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const active = idx === activeIndex;
                  const Icon = cmd.icon;
                  const isServerRow = cmd.group === 'Servers';
                  const srv = isServerRow ? servers.find((s) => s.id === cmd.id.replace('srv-', '')) : undefined;
                  return (
                    <button
                      key={cmd.id}
                      data-index={idx}
                      onMouseMove={() => setActiveIndex(idx)}
                      onClick={() => cmd.perform()}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${active ? 'bg-panel-500/[0.14]' : 'hover:bg-white/[0.03]'}`}
                    >
                      {srv ? (
                        <span className={`h-2 w-2 rounded-full shrink-0 ${getServerStatusDot(srv.status)}`} />
                      ) : (
                        <Icon size={15} className={active ? 'text-panel-300' : 'text-zinc-500'} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm truncate ${active ? 'text-white' : 'text-zinc-200'}`}>{cmd.title}</span>
                        {cmd.subtitle && <span className="block text-[11px] text-zinc-600 font-mono truncate">{cmd.subtitle}</span>}
                      </span>
                      {active && (
                        <span className="flex items-center gap-1 text-[10px] text-zinc-500 shrink-0">
                          <CornerDownLeft size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t text-[10px] text-zinc-600" style={{ borderColor: '#1C1E22' }}>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="font-mono border border-zinc-800 rounded px-1">↑</kbd><kbd className="font-mono border border-zinc-800 rounded px-1">↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="font-mono border border-zinc-800 rounded px-1">↵</kbd> select</span>
          </span>
          <span className="font-mono">{flatOrdered.length} result{flatOrdered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
