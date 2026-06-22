import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Users, Cpu, Settings,
  LogOut, Shield, Activity, Package, ChevronRight
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import toast from 'react-hot-toast';

const userNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/servers', icon: Server, label: 'Servers' },
  { to: '/account', icon: Settings, label: 'Account' },
];

const adminNavItems = [
  { to: '/admin', icon: Shield, label: 'Overview', exact: true },
  { to: '/admin/servers', icon: Server, label: 'Servers' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/nodes', icon: Cpu, label: 'Nodes' },
  { to: '/admin/eggs', icon: Package, label: 'Eggs' },
  { to: '/admin/activity', icon: Activity, label: 'Activity' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 flex flex-col" style={{ background: '#0b0e14', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="h-9 w-9 rounded-xl flex items-center justify-center shadow-lg shrink-0"
          style={{ background: 'linear-gradient(135deg, #6366f1, #4338ca)' }}>
          <Server size={17} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white tracking-tight">MC Panel</p>
          <p className="text-[10px] text-slate-600 font-mono">v1.0.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6 scrollbar-none">
        {/* User section */}
        <div>
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.4)' }}>
            User
          </p>
          <ul className="space-y-0.5">
            {userNavItems.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative',
                    isActive
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  )}
                  style={({ isActive }) => isActive ? {
                    background: 'rgba(99,102,241,0.12)',
                    borderLeft: '2px solid #6366f1',
                  } : { borderLeft: '2px solid transparent' }}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <ChevronRight size={12} className="ml-auto opacity-0 group-hover:opacity-40 transition-opacity" />
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        {/* Admin section */}
        {isAdmin && (
          <div>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.4)' }}>
              Administration
            </p>
            <ul className="space-y-0.5">
              {adminNavItems.map(({ to, icon: Icon, label, exact }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={exact}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group',
                      isActive
                        ? 'text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    )}
                    style={({ isActive }) => isActive ? {
                      background: 'rgba(99,102,241,0.12)',
                      borderLeft: '2px solid #6366f1',
                    } : { borderLeft: '2px solid transparent' }}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group transition-colors hover:bg-white/[0.04]"
          onClick={() => navigate('/account')}
        >
          <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366f1, #4338ca)' }}>
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: isAdmin ? '#a78bfa' : 'rgba(148,163,184,0.6)' }}>
              {isAdmin ? 'Administrator' : user?.email}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            title="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
