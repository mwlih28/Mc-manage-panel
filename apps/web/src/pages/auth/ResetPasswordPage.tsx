import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQuery } from '@tanstack/react-query';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'Kretase';
  const logoUrl = settings?.['app.logo'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setIsLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Reset link is invalid or has expired');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0a0a0c' }}>
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="w-full max-w-sm relative z-10">
        <div className="flex flex-col items-center mb-8">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl object-contain mb-4" />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4">
              <ShieldCheck size={20} className="text-zinc-300" />
            </div>
          )}
          <h1 className="text-xl font-bold text-white tracking-tight">{siteName}</h1>
        </div>

        <div className="rounded-2xl p-8" style={{ background: '#111113', border: '1px solid #1e1e22' }}>
          {!token ? (
            <p className="text-sm text-zinc-400 text-center">
              Missing reset token. Use the link from your email, or{' '}
              <Link to="/forgot-password" className="text-zinc-200 hover:underline">request a new one</Link>.
            </p>
          ) : done ? (
            <div className="text-center py-2">
              <CheckCircle2 size={28} className="mx-auto text-green-400 mb-3" />
              <h2 className="text-sm font-semibold text-zinc-200 mb-2">Password updated</h2>
              <p className="text-xs text-zinc-500">Redirecting you to login...</p>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-zinc-200 mb-6">Choose a new password</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">New password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-10"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoFocus
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
                <div>
                  <label className="label">Confirm password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input"
                    placeholder="Repeat password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="w-full btn-primary py-2.5 justify-center mt-2" disabled={isLoading}>
                  {isLoading ? <><Spinner size="sm" /> Updating...</> : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
