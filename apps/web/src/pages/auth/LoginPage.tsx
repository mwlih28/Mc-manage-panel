import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { Server, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { setAuth, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  useEffect(() => {
    api.get('/auth/setup/status').then(({ data }) => {
      setNeedsSetup(data.needsSetup);
    }).finally(() => setCheckingSetup(false));
  }, []);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <Spinner size="lg" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome back, ${data.user.firstName}!`);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-panel-500 to-panel-700 flex items-center justify-center shadow-xl shadow-panel-900/30 mb-4">
            <Server size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">MC Manage Panel</h1>
          <p className="text-slate-500 text-sm mt-1">Game Server Management</p>
        </div>

        {/* Form */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-base font-semibold text-slate-100">Sign in to your account</h2>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Email address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary w-full justify-center py-2.5"
                disabled={isLoading}
              >
                {isLoading ? <Spinner size="sm" /> : 'Sign in'}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-dark-800 text-center">
              <p className="text-sm text-slate-500">
                Don't have an account?{' '}
                <Link to="/register" className="text-panel-400 hover:text-panel-300 transition-colors">
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* Demo credentials */}
        <div className="mt-4 p-4 rounded-lg bg-dark-900/50 border border-dark-800 text-center">
          <p className="text-xs text-slate-500 mb-2">Demo credentials</p>
          <div className="space-y-1">
            <p className="text-xs text-slate-400">
              <span className="text-panel-400">Admin:</span> admin@example.com / Admin123!
            </p>
            <p className="text-xs text-slate-400">
              <span className="text-green-400">User:</span> user@example.com / User123!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
