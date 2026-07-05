import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/axios';
import { Spinner } from '@/components/ui/Spinner';
import toast from 'react-hot-toast';

// Landing page for the redirect Discord OAuth sends the browser back to
// (apps/api/src/routes/auth.ts's /auth/discord/callback). The API can only
// hand off via a full-page redirect, not a fetch response, so it puts the
// token pair in the query string here; this page's only job is to store
// them and fetch the user record, exactly like a normal password login does
// right after POST /auth/login resolves.
export function DiscordCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth, setTokens } = useAuthStore();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');
    if (!accessToken || !refreshToken) {
      navigate('/login?error=discord_invalid', { replace: true });
      return;
    }

    setTokens(accessToken, refreshToken);
    api.get('/auth/me')
      .then(({ data }) => {
        setAuth(data.user, accessToken, refreshToken);
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        toast.error('Discord login failed');
        navigate('/login', { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0c' }}>
      <Spinner size="lg" />
    </div>
  );
}
