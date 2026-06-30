import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQuery } from '@tanstack/react-query';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  // 2FA state
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [pendingToken, setPendingToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const { setAuth, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'Kretase';
  const siteDesc = settings?.['app.description'] || 'Game server management';
  const logoUrl  = settings?.['app.logo'];

  useEffect(() => {
    api.get('/auth/setup/status').then(({ data }) => {
      setNeedsSetup(data.needsSetup);
    }).finally(() => setCheckingSetup(false));
  }, []);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (needsSetup)      return <Navigate to="/setup"     replace />;
  if (checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0c' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.requiresTwoFactor) {
        setPendingToken(data.pendingToken);
        setRequiresTwoFactor(true);
        setIsLoading(false);
        return;
      }
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

  const handleTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { data } = await api.post('/auth/2fa/verify', { pendingToken, code: twoFactorCode });
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome back, ${data.user.firstName}!`);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Invalid code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#0a0a0c' }}
    >
      {/* Subtle grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl object-contain mb-4" />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4">
              <ShieldCheck size={20} className="text-zinc-300" />
            </div>
          )}
          <h1 className="text-xl font-bold text-white tracking-tight">{siteName}</h1>
          <p className="text-zinc-500 text-xs mt-1">{siteDesc}</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8" style={{ background: '#111113', border: '1px solid #1e1e22' }}>
          {!requiresTwoFactor ? (
            <>
              <h2 className="text-sm font-semibold text-zinc-200 mb-6">Sign in to your account</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="label mb-0">Password</label>
                    <Link to="/forgot-password" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Forgot password?</Link>
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-10"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full btn-primary py-2.5 justify-center mt-2"
                  disabled={isLoading}
                >
                  {isLoading ? <><Spinner size="sm" /> Signing in...</> : 'Sign in'}
                </button>
              </form>
              <p className="text-center text-xs text-zinc-600 mt-5">
                No account?{' '}
                <Link to="/register" className="text-zinc-400 hover:text-white transition-colors">Create one</Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-6">
                <ShieldCheck size={16} className="text-zinc-300" />
                <h2 className="text-sm font-semibold text-zinc-200">Two-factor authentication</h2>
              </div>
              <p className="text-xs text-zinc-500 mb-5">Enter the 6-digit code from your authenticator app.</p>
              <form onSubmit={handleTwoFactor} className="space-y-4">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="input text-center tracking-[0.3em] text-lg font-mono"
                  placeholder="000000"
                  value={twoFactorCode}
                  onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                  required
                />
                <button type="submit" className="w-full btn-primary py-2.5 justify-center" disabled={isLoading}>
                  {isLoading ? <><Spinner size="sm" /> Verifying...</> : 'Verify'}
                </button>
                <button
                  type="button"
                  className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
                  onClick={() => { setRequiresTwoFactor(false); setPendingToken(''); setTwoFactorCode(''); }}
                >
                  Back to login
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-[10px] text-zinc-800 mt-5">
          {siteName} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
