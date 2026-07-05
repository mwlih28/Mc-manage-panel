import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Users, Cpu, Package,
  Activity, Wrench, LogOut, ChevronLeft, KeyRound, Code2, Webhook, ArrowRightLeft
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';

const adminNavItems = [
  { to: '/admin',          icon: LayoutDashboard, label: 'Overview',  exact: true },
  { to: '/admin/servers',  icon: Server,          label: 'Servers' },
  { to: '/admin/users',    icon: Users,           label: 'Users' },
  { to: '/admin/nodes',    icon: Cpu,             label: 'Nodes' },
  { to: '/admin/eggs',     icon: Package,         label: 'Eggs' },
  { to: '/admin/activity',   icon: Activity,  label: 'Activity' },
  { to: '/admin/webhooks',   icon: Webhook,   label: 'Webhooks' },
  { to: '/admin/migration',  icon: ArrowRightLeft, label: 'Migration' },
  { to: '/admin/api-keys',   icon: KeyRound,  label: 'API Keys' },
  { to: '/admin/api-docs',   icon: Code2,     label: 'API Reference' },
  { to: '/admin/settings',   icon: Wrench,    label: 'Settings' },
];

export function AdminSidebar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

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
    <aside
      className="fixed inset-y-0 left-0 z-40 w-60 flex flex-col"
      style={{ background: '#080a0c', borderRight: '1px solid #1a1f25' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid #1a1f25' }}>
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="h-8 w-8 rounded-lg object-contain bg-zinc-900 p-0.5" />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Wrench size={14} className="text-amber-400" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight">{siteName}</p>
          <p className="text-[9px] text-amber-600 font-mono uppercase tracking-wider">Admin Panel</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 scrollbar-none">
        <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">Management</p>
        <ul className="space-y-0.5">
          {adminNavItems.map(({ to, icon: Icon, label, exact }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={exact}
                className={({ isActive }) => cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100',
                  isActive
                    ? 'text-amber-300 bg-amber-500/10 border-l-2 border-amber-400'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent'
                )}
              >
                <Icon size={14} />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Back to user panel */}
        <div className="mt-6">
          <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">Navigation</p>
          <ul className="space-y-0.5">
            <li>
              <a
                href="/dashboard"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100 text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.03] border-l-2 border-transparent"
              >
                <ChevronLeft size={14} />
                <span>Back to Panel</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>

      {/* User footer */}
      <div className="p-2" style={{ borderTop: '1px solid #1a1f25' }}>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg">
          <div className="h-7 w-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 text-[10px] font-bold shrink-0">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
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
    </aside>
  );
}
