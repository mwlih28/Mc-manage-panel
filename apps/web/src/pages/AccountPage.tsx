import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { User, Lock, Key, ShieldCheck, Mail, ShieldAlert, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { Spinner } from '@/components/ui/Spinner';
import toast from 'react-hot-toast';
import { SUPPORTED_LANGUAGES } from '@/i18n';

export function AccountPage() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuthStore();
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    language: user?.language || 'en',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // ── 2FA state ────────────────────────────────────────────────────────────────
  const [twoFaSetup, setTwoFaSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaDisableCode, setTwoFaDisableCode] = useState('');
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  // ── SMTP state ───────────────────────────────────────────────────────────────
  const [smtpForm, setSmtpForm] = useState({ host: '', port: '587', user: '', pass: '', from: '' });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);

  useEffect(() => {
    api.get('/users/profile/smtp').then(({ data }) => {
      setSmtpForm({
        host: data.host || '',
        port: String(data.port || 587),
        user: data.user || '',
        pass: '',
        from: data.from || '',
      });
    }).catch(() => {});
  }, []);

  const profileMutation = useMutation({
    mutationFn: (data: typeof profileForm) => api.patch('/users/profile/me', data),
    onSuccess: ({ data }) => {
      setUser(data.data);
      i18n.changeLanguage(data.data.language);
      toast.success(t('account.profileUpdated'));
    },
    onError: () => toast.error(t('account.profileUpdateFailed')),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.patch('/users/profile/me', data),
    onSuccess: () => {
      toast.success(t('account.passwordUpdated'));
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || t('account.passwordUpdateFailed'));
    },
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error(t('account.passwordsDoNotMatch'));
      return;
    }
    passwordMutation.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  // ── 2FA handlers ─────────────────────────────────────────────────────────────
  const setup2fa = async () => {
    setTwoFaLoading(true);
    try {
      const { data } = await api.post('/users/profile/2fa/setup');
      setTwoFaSetup({ qrCode: data.qrCode, secret: data.secret });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to setup 2FA');
    } finally {
      setTwoFaLoading(false);
    }
  };

  const enable2fa = async () => {
    setTwoFaLoading(true);
    try {
      await api.post('/users/profile/2fa/enable', { code: twoFaCode });
      toast.success('2FA enabled successfully');
      setTwoFaSetup(null);
      setTwoFaCode('');
      // Refresh user to get updated twoFactor flag
      const { data } = await api.get('/users/profile/me');
      setUser(data.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Invalid code');
    } finally {
      setTwoFaLoading(false);
    }
  };

  const disable2fa = async () => {
    setTwoFaLoading(true);
    try {
      await api.delete('/users/profile/2fa', { data: { code: twoFaDisableCode } });
      toast.success('2FA disabled');
      setTwoFaDisableCode('');
      // Refresh user
      const { data } = await api.get('/users/profile/me');
      setUser(data.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Invalid code');
    } finally {
      setTwoFaLoading(false);
    }
  };

  // ── SMTP handlers ─────────────────────────────────────────────────────────────
  const saveSmtp = async () => {
    setSmtpLoading(true);
    try {
      await api.put('/users/profile/smtp', smtpForm);
      toast.success(t('account.smtpSaved'));
    } catch {
      toast.error(t('account.smtpSaveFailed'));
    } finally {
      setSmtpLoading(false);
    }
  };

  const testSmtp = async () => {
    setSmtpTesting(true);
    try {
      const { data } = await api.post('/users/profile/smtp/test');
      toast.success(data.message || 'Test email sent');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || t('account.smtpTestFailed'));
    } finally {
      setSmtpTesting(false);
    }
  };

  const scrollTo2fa = () => {
    document.getElementById('two-factor-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-white">{t('account.title')}</h1>
        <p className="text-zinc-500 text-sm mt-1">{t('account.subtitle')}</p>
      </div>

      {/* 2FA warning banner — shown only when 2FA is not enabled */}
      {!user?.twoFactor && (
        <button
          onClick={scrollTo2fa}
          className="w-full flex items-center gap-4 px-5 py-4 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 hover:border-amber-500/50 transition-all text-left group"
        >
          <div className="flex-shrink-0 p-2.5 rounded-lg bg-amber-500/20">
            <ShieldAlert size={20} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">{t('account.secureAccount')}</p>
            <p className="text-xs text-amber-400/70 mt-0.5">{t('account.secureAccountSub')}</p>
          </div>
          <ArrowRight size={16} className="text-amber-400/60 group-hover:text-amber-300 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>
      )}

      {/* Profile info */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <User size={14} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-100">{t('account.profileInfo')}</h2>
        </div>
        <div className="card-body">
          {/* Avatar */}
          <div className="flex items-center gap-4 mb-6">
            <div className="h-14 w-14 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white text-xl font-bold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div>
              <p className="font-semibold text-zinc-100">{user?.firstName} {user?.lastName}</p>
              <p className="text-sm text-zinc-400">{user?.email}</p>
              <p className="text-xs text-zinc-600">@{user?.username}</p>
            </div>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); profileMutation.mutate(profileForm); }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('account.firstName')}</label>
                <input
                  className="input"
                  value={profileForm.firstName}
                  onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">{t('account.lastName')}</label>
                <input
                  className="input"
                  value={profileForm.lastName}
                  onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('account.language')}</label>
              <select
                className="input"
                value={profileForm.language}
                onChange={(e) => setProfileForm({ ...profileForm, language: e.target.value })}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={profileMutation.isPending}
            >
              {profileMutation.isPending ? <Spinner size="sm" /> : t('account.saveChanges')}
            </button>
          </form>
        </div>
      </div>

      {/* Password */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Lock size={14} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-100">{t('account.changePassword')}</h2>
        </div>
        <div className="card-body">
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="label">{t('account.currentPassword')}</label>
              <input
                type="password"
                className="input"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">{t('account.newPassword')}</label>
              <input
                type="password"
                className="input"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="label">{t('account.confirmNewPassword')}</label>
              <input
                type="password"
                className="input"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                required
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={passwordMutation.isPending}
            >
              {passwordMutation.isPending ? <Spinner size="sm" /> : t('account.updatePassword')}
            </button>
          </form>
        </div>
      </div>

      {/* Two-Factor Authentication */}
      <div className="card" id="two-factor-section">
        <div className="card-header flex items-center gap-2">
          <ShieldCheck size={14} className={user?.twoFactor ? 'text-emerald-400' : 'text-amber-400'} />
          <h2 className="text-sm font-semibold text-zinc-100">{t('account.twoFactorAuth')}</h2>
          {!user?.twoFactor && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium uppercase tracking-wide">
              {t('account.notEnabled')}
            </span>
          )}
          {user?.twoFactor && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium uppercase tracking-wide">
              {t('account.active')}
            </span>
          )}
        </div>
        <div className="p-6">
          {user?.twoFactor ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                {t('account.twoFaEnabled')}
              </div>
              <p className="text-xs text-zinc-500">{t('account.twoFaDisableHint')}</p>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="6-digit code"
                  maxLength={6}
                  value={twoFaDisableCode}
                  onChange={e => setTwoFaDisableCode(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  className="btn-danger btn-sm shrink-0"
                  disabled={twoFaLoading || twoFaDisableCode.length < 6}
                  onClick={disable2fa}
                >
                  {twoFaLoading ? <Spinner size="sm" /> : t('account.disable2fa')}
                </button>
              </div>
            </div>
          ) : !twoFaSetup ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">{t('account.twoFaProtectHint')}</p>
              <button className="btn-secondary btn-sm" onClick={setup2fa} disabled={twoFaLoading}>
                {twoFaLoading ? <Spinner size="sm" /> : t('account.enable2fa')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">{t('account.twoFaScanHint')}</p>
              <img src={twoFaSetup.qrCode} alt="QR Code" className="w-40 h-40 rounded-lg bg-white p-2" />
              <p className="text-xs text-zinc-500">
                {t('account.enterManually')}{' '}
                <code className="text-zinc-300 font-mono bg-zinc-900 px-1 rounded">{twoFaSetup.secret}</code>
              </p>
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="Enter 6-digit code to verify"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
                <button
                  className="btn-primary btn-sm shrink-0"
                  disabled={twoFaLoading || twoFaCode.length < 6}
                  onClick={enable2fa}
                >
                  {twoFaLoading ? <Spinner size="sm" /> : t('account.verifyAndEnable')}
                </button>
              </div>
              <button
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                onClick={() => setTwoFaSetup(null)}
              >
                {t('account.cancel')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SMTP Settings */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Mail size={14} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-100">{t('account.smtpSettings')}</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-zinc-400">{t('account.smtpSub')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('account.smtpHost')}</label>
              <input
                className="input"
                placeholder="smtp.example.com"
                value={smtpForm.host}
                onChange={e => setSmtpForm(f => ({ ...f, host: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('account.port')}</label>
              <input
                className="input"
                placeholder="587"
                value={smtpForm.port}
                onChange={e => setSmtpForm(f => ({ ...f, port: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('account.username')}</label>
              <input
                className="input"
                placeholder="user@example.com"
                value={smtpForm.user}
                onChange={e => setSmtpForm(f => ({ ...f, user: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('login.password')}</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={smtpForm.pass}
                onChange={e => setSmtpForm(f => ({ ...f, pass: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="label">{t('account.fromAddress')}</label>
            <input
              className="input"
              placeholder="noreply@example.com"
              value={smtpForm.from}
              onChange={e => setSmtpForm(f => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={saveSmtp} disabled={smtpLoading}>
              {smtpLoading ? <Spinner size="sm" /> : t('account.saveSmtp')}
            </button>
            <button className="btn-secondary btn-sm" onClick={testSmtp} disabled={smtpTesting}>
              {smtpTesting ? <Spinner size="sm" /> : t('account.sendTestEmail')}
            </button>
          </div>
        </div>
      </div>

      {/* API Key section */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Key size={14} className="text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-100">{t('account.apiKeys')}</h2>
        </div>
        <div className="card-body">
          <p className="text-sm text-zinc-400 mb-3">
            {t('account.apiKeysSub')}
          </p>
          <button className="btn-secondary btn-sm">
            <Key size={14} /> {t('account.createApiKey')}
          </button>
        </div>
      </div>
    </div>
  );
}
