import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Server, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';

export function SetupPage() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', username: '', password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { setAuth, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/auth/setup/status').then(({ data }) => {
      setNeedsSetup(data.needsSetup);
    }).finally(() => setChecking(false));
  }, []);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!needsSetup) return <Navigate to="/login" replace />;

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { data } = await api.post('/auth/setup', form);
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(`Welcome, ${data.user.firstName}! Admin account created.`);
      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string; errors?: { msg: string }[] } } };
      const msg = error.response?.data?.message
        || error.response?.data?.errors?.[0]?.msg
        || 'Setup failed';
      toast.error(msg);
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
          <h1 className="text-2xl font-bold text-slate-100">Kretase</h1>
          <p className="text-slate-500 text-sm mt-1">Initial Setup</p>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="text-base font-semibold text-slate-100">Create Administrator Account</h2>
            <p className="text-xs text-slate-500 mt-1">
              No users exist yet. Create the first admin account to get started.
            </p>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name</label>
                  <input className="input" placeholder="John" value={form.firstName} onChange={f('firstName')} required />
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input className="input" placeholder="Doe" value={form.lastName} onChange={f('lastName')} required />
                </div>
              </div>
              <div>
                <label className="label">Email address</label>
                <input type="email" className="input" placeholder="admin@example.com" value={form.email} onChange={f('email')} required />
              </div>
              <div>
                <label className="label">Username</label>
                <input className="input" placeholder="admin" value={form.username} onChange={f('username')} required minLength={3} maxLength={20} pattern="[a-zA-Z0-9_]+" title="Letters, numbers, underscores only" />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={f('password')}
                    required
                    minLength={8}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">Minimum 8 characters</p>
              </div>

              <button type="submit" className="btn-primary w-full justify-center py-2.5 mt-2" disabled={isLoading}>
                {isLoading ? <Spinner size="sm" /> : 'Create Admin Account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
