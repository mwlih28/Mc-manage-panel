import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Server, Settings, LogOut, Shield, Sparkles, Image } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';

// PANEL_VERSION is the release tag install/update-panel.sh resolved at
// deploy time (e.g. "v1.2.0"), or "main" when running an untagged checkout
// — only prefix with "v" when it actually looks like a version number.
function formatPanelVersion(version?: string): string {
  if (!version) return '';
  return /^v?\d/.test(version) ? `v${version.replace(/^v/, '')}` : version;
}

export function Sidebar() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';

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

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    logout();
    navigate('/login');
    toast.success(t('sidebar.loggedOut'));
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 w-60 flex flex-col"
      style={{ background: '#0a0a0c', borderRight: '1px solid #1e1e22' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid #1e1e22' }}>
        <img src={logoUrl || '/brand/kretase-logo-128.png'} alt="logo" className="h-8 w-8 rounded-lg object-contain shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight">{siteName}</p>
          <p className="text-[9px] text-zinc-600 font-mono">{formatPanelVersion(panelVersion)}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5 scrollbar-none">
        <div>
          <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">{t('sidebar.user')}</p>
          <ul className="space-y-0.5">
            {userNavItems.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100',
                    isActive
                      ? 'text-white bg-panel-500/[0.12] border-l-2 border-panel-500'
                      : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent'
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
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100',
                      isActive
                        ? 'text-white bg-panel-500/[0.12] border-l-2 border-panel-500'
                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent'
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
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent"
                >
                  <Shield size={14} />
                  <span>{t('sidebar.adminPanel')}</span>
                  <span className="ml-auto text-[9px] text-zinc-700">↗</span>
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
          <div className="h-7 w-7 rounded-full bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
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
    </aside>
  );
}
