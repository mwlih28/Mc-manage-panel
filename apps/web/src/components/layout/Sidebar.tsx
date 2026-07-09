import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Server, Settings, LogOut, Shield, Sparkles, Image, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { useCommandPalette } from '@/store/commandPaletteStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';

// Slides a highlight pill behind whichever nav link is currently active,
// measuring against the scrollable <nav> so it stays correct through
// collapsible sections instead of a plain per-item background class.
function useActiveNavPill(navRef: RefObject<HTMLElement>) {
  const location = useLocation();
  const [style, setStyle] = useState<{ top: number; height: number; opacity: number }>({ top: 0, height: 0, opacity: 0 });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('a.active');
    if (!active) { setStyle((s) => ({ ...s, opacity: 0 })); return; }
    const navRect = nav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    setStyle({ top: itemRect.top - navRect.top + nav.scrollTop, height: itemRect.height, opacity: 1 });
  }, [location.pathname, navRef]);

  return style;
}

// PANEL_VERSION is whatever install/update-panel.sh wrote at deploy time —
// a release tag like "v1.2.0" on a released install, but the raw git branch
// name (e.g. "main" or a feature branch) on a branch-tracking install. Only
// show a label when it actually looks like a release version; a branch name
// isn't meaningful to an end user and just clutters the corner, so hide it.
function formatPanelVersion(version?: string): string {
  if (!version) return '';
  return /^v?\d/.test(version) ? `v${version.replace(/^v/, '')}` : '';
}

export function Sidebar() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';
  const navRef = useRef<HTMLElement>(null);
  const pill = useActiveNavPill(navRef);
  const openPalette = useCommandPalette((s) => s.open);
  // Show the platform-appropriate shortcut hint (⌘K on Mac, Ctrl K elsewhere).
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const userNavItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard') },
    { to: '/servers',   icon: Server,          label: t('sidebar.servers') },
    { to: '/account',  icon: Settings,         label: t('sidebar.account') },
  ];

  const toolNavItems = [
    { to: '/tools/motd-generator', icon: Sparkles, label: t('sidebar.motdGenerator') },
    { to: '/tools/logo-generator', icon: Image,    label: t('sidebar.logoGenerator') },
  ];

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'Kretase';
  const logoUrl = settings?.['app.logo'];
  const aiToolsEnabled = settings?.['features.aiTools'] !== 'false';
  // Sourced from PANEL_VERSION in .env, which install/update-panel.sh keep
  // in sync with the actual release tag deployed — not a hardcoded string
  // that would silently go stale after every update.
  const panelVersion = settings?.['app.version'];
  const { data: updateCheck } = useUpdateCheck();

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    logout();
    navigate('/login');
    toast.success(t('sidebar.loggedOut'));
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 p-2 flex flex-col">
      <div
        className="flex flex-col h-full rounded-2xl border overflow-hidden"
        style={{ background: '#0B0C0E', borderColor: 'rgba(255,255,255,0.06)' }}
      >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid #1C1E22' }}>
        <div className="relative shrink-0">
          <div
            className="absolute inset-0 rounded-lg blur-md opacity-40"
            style={{ background: 'radial-gradient(circle, rgba(46,111,238,0.55) 0%, rgba(46,111,238,0) 70%)' }}
          />
          <img src={logoUrl || '/brand/kretase-logo-128.png'} alt="logo" className="relative h-8 w-8 rounded-lg object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight">{siteName}</p>
          <p className="text-[9px] text-zinc-600 font-mono">{formatPanelVersion(panelVersion)}</p>
        </div>
      </div>

      {/* Command palette trigger — keeps the ⌘K feature discoverable rather
          than hidden behind a shortcut only power users would find. */}
      <div className="px-2 pt-3">
        <button
          onClick={openPalette}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-200 border border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
        >
          <Search size={14} />
          <span className="flex-1 text-left">{t('sidebar.search', 'Search…')}</span>
          <kbd className="text-[10px] font-mono text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav ref={navRef} className="relative flex-1 overflow-y-auto px-2 py-4 space-y-5 scrollbar-none">
        <div
          className="absolute left-2 right-2 rounded-lg bg-panel-500/[0.12] border-l-2 border-panel-500 pointer-events-none transition-all duration-300 ease-out"
          style={{ top: pill.top, height: pill.height, opacity: pill.opacity }}
        />
        <div>
          <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">{t('sidebar.user')}</p>
          <ul className="space-y-0.5">
            {userNavItems.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) => cn(
                    'relative z-10 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100',
                    isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
                  )}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        {aiToolsEnabled && (
          <div>
            <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">{t('sidebar.tools')}</p>
            <ul className="space-y-0.5">
              {toolNavItems.map(({ to, icon: Icon, label }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) => cn(
                      'relative z-10 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100',
                      isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
                    )}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Admin panel shortcut — opens in a new tab */}
        {isAdmin && (
          <div>
            <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">{t('sidebar.admin')}</p>
            <ul className="space-y-0.5">
              <li>
                <a
                  href="/admin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative z-10 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100 text-zinc-500 hover:text-zinc-200"
                >
                  <Shield size={14} />
                  <span>{t('sidebar.adminPanel')}</span>
                  {updateCheck?.updateAvailable ? (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-panel-400 animate-pulse" title={`Update available: ${updateCheck.latestVersion}`} />
                  ) : (
                    <span className="ml-auto text-[9px] text-zinc-700">↗</span>
                  )}
                </a>
              </li>
            </ul>
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="p-2" style={{ borderTop: '1px solid #1e1e22' }}>
        <div
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.04]"
          onClick={() => navigate('/account')}
        >
          <img
            src={user?.avatarUrl || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user?.username || user?.email || 'user')}`}
            alt=""
            className="h-7 w-7 rounded-lg bg-panel-500/15 border border-panel-500/25 shrink-0 object-cover"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 truncate leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[9px] text-zinc-600 truncate">
              {isAdmin ? t('sidebar.administrator') : user?.email}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
            className="p-1 rounded text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            title={t('sidebar.logout')}
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
      </div>
    </aside>
  );
}
