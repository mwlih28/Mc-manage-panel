import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Users, Cpu, Settings,
  LogOut, ChevronRight, Shield, Activity, Package
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
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    logout();
    navigate('/login');
    toast.success('Logged out successfully');
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 bg-dark-950 border-r border-dark-800 flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-dark-800">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-panel-500 to-panel-700 flex items-center justify-center shadow-lg">
          <Server size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100">MC Panel</p>
          <p className="text-xs text-slate-500">v1.0.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-none">
        {/* User section */}
        <div>
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            User
          </p>
          <ul className="space-y-0.5">
            {userNavItems.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) =>
                    cn('sidebar-item', isActive && 'active')
                  }
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <ChevronRight size={14} className="ml-auto opacity-0 group-hover:opacity-100" />
                </NavLink>
              </li>
            ))}
          </ul>
        </div>

        {/* Admin section */}
        {isAdmin && (
          <div>
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              Administration
            </p>
            <ul className="space-y-0.5">
              {adminNavItems.map(({ to, icon: Icon, label, exact }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={exact}
                    className={({ isActive }) =>
                      cn('sidebar-item', isActive && 'active')
                    }
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
      <div className="border-t border-dark-800 p-3">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-dark-800 transition-colors cursor-pointer group"
          onClick={() => navigate('/account')}
        >
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-panel-400 to-panel-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
