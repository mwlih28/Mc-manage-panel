import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Users, Cpu, Settings,
  LogOut, Shield, Activity, Package, Wrench
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';

const userNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/servers',   icon: Server,          label: 'Servers' },
  { to: '/account',  icon: Settings,         label: 'Account' },
];

const adminNavItems = [
  { to: '/admin',          icon: Shield,          label: 'Overview',  exact: true },
  { to: '/admin/servers',  icon: Server,          label: 'Servers' },
  { to: '/admin/users',    icon: Users,           label: 'Users' },
  { to: '/admin/nodes',    icon: Cpu,             label: 'Nodes' },
  { to: '/admin/eggs',     icon: Package,         label: 'Eggs' },
  { to: '/admin/activity', icon: Activity,        label: 'Activity' },
  { to: '/admin/settings', icon: Wrench,          label: 'Settings' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';

  // Load site name from settings
  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'MC Panel';

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  const logoUrl = settings?.['app.logo'];

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 w-60 flex flex-col"
      style={{ background: '#0a0a0c', borderRight: '1px solid #1e1e22' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid #1e1e22' }}>
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="h-8 w-8 rounded-lg object-contain bg-zinc-900 p-0.5" />
        ) : (
          <div className="h-8 w-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
            <Server size={14} className="text-zinc-300" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate leading-tight">{siteName}</p>
          <p className="text-[9px] text-zinc-600 font-mono">v1.0.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5 scrollbar-none">
        <div>
          <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">User</p>
          <ul className="space-y-0.5">
            {userNavItems.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100',
                    isActive
                      ? 'text-white bg-white/[0.06] border-l-2 border-white'
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

        {isAdmin && (
          <div>
            <p className="px-3 mb-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">Admin</p>
            <ul className="space-y-0.5">
              {adminNavItems.map(({ to, icon: Icon, label, exact }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={exact}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-100',
                      isActive
                        ? 'text-white bg-white/[0.06] border-l-2 border-white'
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
              {isAdmin ? 'Administrator' : user?.email}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
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
