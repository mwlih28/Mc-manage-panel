import { useState, useRef } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { Server } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-dark-950 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-panel-500 to-panel-700 flex items-center justify-center shadow-xl shadow-panel-900/30 mb-4">
            <Server size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Create Account</h1>
          <p className="text-slate-500 text-sm mt-1">Join Kretase</p>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-base font-semibold text-slate-100">Account Information</h2>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name</label>
                  <input type="text" className="input" placeholder="John" value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
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
                <p className="text-xs text-slate-500 mt-1">Minimum 8 characters</p>
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

              <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={isLoading}>
                {isLoading ? <Spinner size="sm" /> : 'Create Account'}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-dark-800 text-center">
              <p className="text-sm text-slate-500">
                Already have an account?{' '}
                <Link to="/login" className="text-panel-400 hover:text-panel-300 transition-colors">
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
