import { useState, useRef } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';

export function RegisterPage() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', username: '', password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);
  const { setAuth, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const captchaEnabled = settings?.['captcha.provider'] === 'hcaptcha' && !!settings?.['captcha.siteKey'];
  const siteName = settings?.['app.name'] || 'Kretase';
  const logoUrl = settings?.['app.logo'];

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaEnabled && !captchaToken) {
      toast.error('Please complete the captcha');
      return;
    }
    setIsLoading(true);

    try {
      const { data } = await api.post('/auth/register', { ...form, captchaToken });
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success('Account created successfully!');
      navigate('/dashboard');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Registration failed');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: '#0B0C0E' }}
    >
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: 420,
          background: 'radial-gradient(ellipse 60% 100% at 50% 0%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%)',
        }}
      />

      <div className="w-full max-w-sm relative z-10">
        <div className="flex flex-col items-center mb-7">
          <img src={logoUrl || '/brand/kretase-logo-128.png'} alt="logo" className="h-10 w-10 rounded-lg object-contain mb-3.5" />
          <h1 className="text-lg font-semibold text-white tracking-tight">Create account</h1>
          <p className="text-zinc-500 text-xs mt-1">Join {siteName}</p>
        </div>

        <div className="rounded-xl p-8" style={{ background: '#131417', border: '1px solid #1C1E22', boxShadow: '0 12px 32px -16px rgba(0,0,0,0.4)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First Name</label>
                <input type="text" className="input" placeholder="John" value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })} required autoFocus />
              </div>
              <div>
                <label className="label">Last Name</label>
                <input type="text" className="input" placeholder="Doe" value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
              </div>
            </div>

            <div>
              <label className="label">Username</label>
              <input type="text" className="input" placeholder="johndoe" value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>

            <div>
              <label className="label">Email address</label>
              <input type="email" className="input" placeholder="john@example.com" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>

            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="••••••••" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
              <p className="text-xs text-zinc-600 mt-1.5">Minimum 8 characters</p>
            </div>

            {captchaEnabled && (
              <div className="flex justify-center">
                <HCaptcha
                  ref={captchaRef}
                  sitekey={settings!['captcha.siteKey']}
                  theme="dark"
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken('')}
                />
              </div>
            )}

            <button type="submit" className="w-full btn-primary py-2.5 justify-center mt-2" disabled={isLoading}>
              {isLoading ? <><Spinner size="sm" /> Creating...</> : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-xs text-zinc-600 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-zinc-400 hover:text-white transition-colors">Sign in</Link>
          </p>
        </div>

        <p className="text-center text-[10px] text-zinc-800 mt-5">
          {siteName} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
