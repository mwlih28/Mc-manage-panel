import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Users, Cpu, Package,
  Activity, Wrench, LogOut, ChevronLeft, KeyRound, Code2, Webhook, ArrowRightLeft, CreditCard
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';

// Slides a highlight pill behind whichever nav link is currently active,
// mirroring Sidebar.tsx's user-panel nav so both shells feel like one system.
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

const DISCORD_INVITE_URL = 'https://discord.gg/kretasecom';

function DiscordIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

// Grouped into labelled sections instead of one long flat list — a dozen
// undifferentiated links is hard to scan, whereas "where do I manage billing"
// vs "where are the developer tools" becomes obvious at a glance.
const adminNavGroups: { label: string; items: { to: string; icon: typeof Server; label: string; exact?: boolean }[] }[] = [
  {
    label: 'Management',
    items: [
      { to: '/admin',         icon: LayoutDashboard, label: 'Overview', exact: true },
      { to: '/admin/servers', icon: Server,          label: 'Servers' },
      { to: '/admin/users',   icon: Users,           label: 'Users' },
      { to: '/admin/nodes',   icon: Cpu,             label: 'Nodes' },
      { to: '/admin/eggs',    icon: Package,         label: 'Eggs' },
      { to: '/admin/activity', icon: Activity,       label: 'Activity' },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { to: '/admin/integrations', icon: CreditCard, label: 'Billing & Store' },
      { to: '/admin/webhooks',     icon: Webhook,    label: 'Webhooks' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { to: '/admin/api-keys', icon: KeyRound, label: 'API Keys' },
      { to: '/admin/api-docs', icon: Code2,    label: 'API Reference' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/admin/migration', icon: ArrowRightLeft, label: 'Migration' },
      { to: '/admin/settings',  icon: Wrench,         label: 'Settings' },
    ],
  },
];

export function AdminSidebar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const pill = useActiveNavPill(navRef);

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'Kretase';
  const logoUrl = settings?.['app.logo'];

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 p-2 flex flex-col">
      <div
        className="flex flex-col h-full rounded-2xl border overflow-hidden"
        style={{ background: '#080a0c', borderColor: '#1a1f25' }}
      >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid #1a1f25' }}>
        <div className="relative shrink-0">
          <div
            className="absolute inset-0 rounded-lg blur-md opacity-50"
            style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.5) 0%, rgba(245,158,11,0) 70%)' }}
          />
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="relative h-8 w-8 rounded-lg object-contain bg-zinc-900 p-0.5" />
          ) : (
            <div className="relative h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Wrench size={14} className="text-amber-400" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight">{siteName}</p>
          <p className="text-[9px] text-amber-600 font-mono uppercase tracking-wider">Admin Panel</p>
        </div>
      </div>

      {/* Navigation */}
      <nav ref={navRef} className="relative flex-1 overflow-y-auto px-2 py-4 space-y-5 scrollbar-none">
        <div
          className="absolute left-2 right-2 rounded-lg bg-amber-500/[0.12] border-l-2 border-amber-400 pointer-events-none transition-all duration-300 ease-out"
          style={{ top: pill.top, height: pill.height, opacity: pill.opacity }}
        />
        {adminNavGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label, exact }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={exact}
                    className={({ isActive }) => cn(
                      'relative z-10 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100',
                      isActive ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-200'
                    )}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Back to user panel */}
        <div>
          <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">Navigation</p>
          <ul className="space-y-0.5">
            <li>
              <a
                href="/dashboard"
                className="relative z-10 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100 text-zinc-500 hover:text-zinc-200"
              >
                <ChevronLeft size={14} />
                <span>Back to Panel</span>
              </a>
            </li>
            <li>
              <a
                href={DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100 text-zinc-500 hover:text-zinc-200"
              >
                <DiscordIcon />
                <span>Discord</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>

      {/* User footer */}
      <div className="p-2" style={{ borderTop: '1px solid #1a1f25' }}>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
          <img
            src={user?.avatarUrl || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user?.username || user?.email || 'admin')}`}
            alt=""
            className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 shrink-0 object-cover"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 truncate leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[9px] text-amber-700 truncate font-mono">Administrator</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1 rounded text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            title="Logout"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
      </div>
    </aside>
  );
}
