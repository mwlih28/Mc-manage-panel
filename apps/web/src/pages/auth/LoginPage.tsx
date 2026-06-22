import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { Server, Eye, EyeOff, Zap } from 'lucide-react';
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
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: '#070a0f' }}
    >
      {/* Animated background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(99,102,241,0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.8) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />
      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-panel-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-emerald-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-panel-400 via-panel-600 to-panel-800 flex items-center justify-center shadow-2xl shadow-panel-900/50">
              <Server size={30} className="text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-900/50">
              <Zap size={10} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">MC Manage Panel</h1>
          <p className="text-slate-500 text-sm mt-2">High-performance game server management</p>
        </div>

        {/* Form card */}
        <div
          className="rounded-2xl border border-white/[0.06] shadow-2xl overflow-hidden"
          style={{ background: 'rgba(15,20,30,0.85)', backdropFilter: 'blur(20px)' }}
        >
          <div className="px-8 pt-8 pb-2">
            <h2 className="text-lg font-semibold text-slate-100">Sign in to your account</h2>
            <p className="text-slate-500 text-sm mt-1">Enter your credentials to continue</p>
          </div>

          <div className="px-8 pb-8 pt-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="label">Email address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@example.com"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-semibold text-sm text-white transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: isLoading ? undefined : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  boxShadow: isLoading ? undefined : '0 4px 24px rgba(99,102,241,0.35)',
                }}
                disabled={isLoading}
              >
                {isLoading ? <><Spinner size="sm" /> Signing in...</> : 'Sign in'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-white/[0.06] text-center">
              <p className="text-sm text-slate-500">
                Don't have an account?{' '}
                <Link to="/register" className="text-panel-400 hover:text-panel-300 font-medium transition-colors">
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          MC Manage Panel &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
