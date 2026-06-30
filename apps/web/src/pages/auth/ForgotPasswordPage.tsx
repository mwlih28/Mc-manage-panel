import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, MailCheck } from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQuery } from '@tanstack/react-query';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'Kretase';
  const logoUrl = settings?.['app.logo'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Something went wrong');
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
          {!sent ? (
            <>
              <h2 className="text-sm font-semibold text-zinc-200 mb-2">Reset your password</h2>
              <p className="text-xs text-zinc-500 mb-6">Enter your account email and we'll send you a reset link.</p>
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
                <button type="submit" className="w-full btn-primary py-2.5 justify-center mt-2" disabled={isLoading}>
                  {isLoading ? <><Spinner size="sm" /> Sending...</> : 'Send reset link'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-2">
              <MailCheck size={28} className="mx-auto text-green-400 mb-3" />
              <h2 className="text-sm font-semibold text-zinc-200 mb-2">Check your email</h2>
              <p className="text-xs text-zinc-500">
                If an account exists for <span className="text-zinc-300">{email}</span>, a reset link is on its way.
              </p>
            </div>
          )}
          <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-6">
            <ArrowLeft size={12} /> Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
