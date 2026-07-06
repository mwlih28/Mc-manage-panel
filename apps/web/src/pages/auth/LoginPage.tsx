import { useState, useEffect, useRef } from 'react';
import { Navigate, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { useQuery } from '@tanstack/react-query';

export function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);
  // 2FA state
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [pendingToken, setPendingToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const { setAuth, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  // Discord OAuth hands off failures and "still need 2FA" back to /login via
  // query params (it can only redirect the browser, not return a fetch
  // response) — pick those up the same way a password-login 2FA prompt or
  // error toast would appear.
  useEffect(() => {
    const discordError = searchParams.get('error');
    const discordPendingToken = searchParams.get('pendingToken');
    if (discordError) {
      const messages: Record<string, string> = {
        discord_cancelled: 'Discord login was cancelled.',
        discord_not_configured: 'Discord login is not configured.',
        discord_invalid: 'Discord login link expired — please try again.',
        discord_email_unverified: 'Your Discord account needs a verified email to sign in.',
        discord_failed: 'Discord login failed. Please try again.',
      };
      toast.error(messages[discordError] || 'Discord login failed.');
      setSearchParams({}, { replace: true });
    } else if (searchParams.get('requiresTwoFactor') && discordPendingToken) {
      setPendingToken(discordPendingToken);
      setRequiresTwoFactor(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const DISCORD_LOGIN_URL = import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api/v1/auth/discord`
    : '/api/v1/auth/discord';

  const { data: settings } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then(r => r.data as Record<string, string>),
    staleTime: 60000,
  });
  const siteName = settings?.['app.name'] || 'Kretase';
  const siteDesc = settings?.['app.description'] || 'Game server management';
  const logoUrl  = settings?.['app.logo'];
  const captchaEnabled = settings?.['captcha.provider'] === 'hcaptcha' && !!settings?.['captcha.siteKey'];

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
    if (captchaEnabled && !captchaToken) {
      toast.error('Please complete the captcha');
      return;
    }
    setIsLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password, captchaToken });
      if (data.requiresTwoFactor) {
        setPendingToken(data.pendingToken);
        setRequiresTwoFactor(true);
        setIsLoading(false);
        return;
      }
      setAuth(data.user, data.accessToken, data.refreshToken);
      toast.success(t('login.welcomeBack', { name: data.user.firstName }));
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || t('login.loginFailed'));
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
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
      toast.success(t('login.welcomeBack', { name: data.user.firstName }));
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || t('login.invalidCode'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: '#0B0C0E' }}
    >
      {/* Subtle grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Soft accent glow anchored behind the card — gives the page a focal
          point instead of a flat card floating in empty space. */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 720, height: 720,
          background: 'radial-gradient(circle, rgba(34,168,120,0.16) 0%, rgba(34,168,120,0) 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%, -55%)',
        }}
      />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src={logoUrl || '/brand/kretase-logo-128.png'} alt="logo" className="h-12 w-12 rounded-xl object-contain mb-4" />
          <h1 className="text-xl font-bold text-white tracking-tight">{siteName}</h1>
          <p className="text-zinc-500 text-xs mt-1">{siteDesc}</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8" style={{ background: 'rgba(19,20,23,0.9)', border: '1px solid #1C1E22', backdropFilter: 'blur(8px)', boxShadow: '0 24px 60px -20px rgba(0,0,0,0.5)' }}>
          {!requiresTwoFactor ? (
            <>
              <h2 className="text-sm font-semibold text-zinc-200 mb-6">{t('login.signInTitle')}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">{t('login.email')}</label>
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
                    <label className="label mb-0">{t('login.password')}</label>
                    <Link to="/forgot-password" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">{t('login.forgotPassword')}</Link>
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

                <button
                  type="submit"
                  className="w-full btn-primary py-2.5 justify-center mt-2"
                  disabled={isLoading}
                >
                  {isLoading ? <><Spinner size="sm" /> {t('login.signingIn')}</> : t('login.signIn')}
                </button>
              </form>

              {settings?.['discord.oauth.enabled'] === 'true' && (
                <>
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-zinc-800" />
                    <span className="text-[10px] uppercase tracking-wider text-zinc-700">or</span>
                    <div className="flex-1 h-px bg-zinc-800" />
                  </div>
                  <a
                    href={DISCORD_LOGIN_URL}
                    className="w-full btn-secondary py-2.5 justify-center flex items-center gap-2"
                  >
                    <Bot size={15} /> Continue with Discord
                  </a>
                </>
              )}

              <p className="text-center text-xs text-zinc-600 mt-5">
                {t('login.noAccount')}{' '}
                <Link to="/register" className="text-zinc-400 hover:text-white transition-colors">{t('login.createOne')}</Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-6">
                <ShieldCheck size={16} className="text-zinc-300" />
                <h2 className="text-sm font-semibold text-zinc-200">{t('login.twoFactorTitle')}</h2>
              </div>
              <p className="text-xs text-zinc-500 mb-5">{t('login.twoFactorSub')}</p>
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
                  {isLoading ? <><Spinner size="sm" /> {t('login.verifying')}</> : t('login.verify')}
                </button>
                <button
                  type="button"
                  className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
                  onClick={() => { setRequiresTwoFactor(false); setPendingToken(''); setTwoFactorCode(''); }}
                >
                  {t('login.backToLogin')}
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
