import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';

// Shared across Sidebar/AdminSettingsPage/tool pages and the theme injector
// so they all read the same cached copy instead of each firing their own
// GET /settings request.
export function useSettings() {
  return useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get('/settings').then((r) => r.data as Record<string, string>),
    staleTime: 60000,
  });
}
