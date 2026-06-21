import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, Server, Shield } from 'lucide-react';
import api from '@/lib/axios';
import { ActivityLog } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

function getEventIcon(event: string) {
  if (event.startsWith('auth:')) return <Shield size={14} className="text-blue-400" />;
  if (event.startsWith('server:power')) return <Activity size={14} className="text-yellow-400" />;
  if (event.includes('delete')) return <XCircle size={14} className="text-red-400" />;
  if (event.includes('create')) return <CheckCircle size={14} className="text-green-400" />;
  return <Server size={14} className="text-panel-400" />;
}

function getEventColor(event: string): string {
  if (event.startsWith('auth:')) return 'bg-blue-500/10 border-blue-500/20';
  if (event.includes('delete')) return 'bg-red-500/10 border-red-500/20';
  if (event.includes('create')) return 'bg-green-500/10 border-green-500/20';
  return 'bg-dark-900 border-dark-800';
}

export function AdminActivityPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats', page],
    queryFn: () => api.get('/stats').then((r) => r.data.data),
  });

  const activities: ActivityLog[] = data?.recentActivity || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Activity Log</h1>
        <p className="text-slate-400 text-sm mt-1">Recent panel activity</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className={`flex items-start gap-4 p-4 rounded-xl border ${getEventColor(activity.event)}`}
            >
              <div className="mt-0.5">{getEventIcon(activity.event)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-200">{activity.event}</span>
                  {activity.user && (
                    <span className="text-xs text-slate-500">
                      by <span className="text-slate-400">{activity.user.username}</span>
                    </span>
                  )}
                </div>
                {activity.ip && (
                  <p className="text-xs text-slate-500 mt-0.5">from {activity.ip}</p>
                )}
              </div>
              <time className="text-xs text-slate-500 shrink-0">
                {formatDateTime(activity.timestamp)}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
