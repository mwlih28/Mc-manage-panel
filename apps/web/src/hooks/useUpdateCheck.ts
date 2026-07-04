import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
}

// Admin-only — the endpoint itself is gated, so this hook simply never
// fires the request for non-admins rather than letting it 403 in the
// background. Cached server-side for an hour, so a long staleTime here
// just avoids redundant requests on top of that.
export function useUpdateCheck() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  return useQuery({
    queryKey: ['update-check'],
    queryFn: () => api.get('/settings/update-check').then((r) => r.data as UpdateCheckResult),
    enabled: isAdmin,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: false,
  });
}
