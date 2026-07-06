import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, Server, Shield, Gauge, AlertTriangle, Flame } from 'lucide-react';
import api from '@/lib/axios';
import { ActivityLog } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';

function PropertiesSummary({ properties }: { properties: string }) {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(properties); } catch { /* not JSON, ignore */ }
  const entries = Object.entries(parsed).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return null;
  return (
    <p className="text-xs text-slate-600 mt-0.5 truncate">
      {entries.map(([k, v]) => `${k}: ${v}`).join(' · ')}
    </p>
  );
}

function getEventIcon(event: string) {
  if (event.startsWith('auth:')) return <Shield size={14} className="text-zinc-500" />;
  if (event === 'server:security-alert') return <AlertTriangle size={14} className="text-[#F0954D]" />;
  if (event === 'server:crash') return <Flame size={14} className="text-[#F27074]" />;
  if (event === 'server:auto-optimize') return <Gauge size={14} className="text-[#4DD9E8]" />;
  if (event.startsWith('server:power')) return <Activity size={14} className="text-[#F0B93D]" />;
  if (event.includes('delete')) return <XCircle size={14} className="text-[#F27074]" />;
  if (event.includes('create')) return <CheckCircle size={14} className="text-[#3EC896]" />;
  return <Server size={14} className="text-panel-400" />;
}

export function AdminActivityPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/stats').then((r) => r.data.data),
  });

  const activities: ActivityLog[] = data?.recentActivity || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Activity Log</h1>
        <p className="text-slate-400 text-sm mt-1">Most recent {activities.length ? activities.length : ''} panel events</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : activities.length === 0 ? (
        <div className="card p-10 text-center text-slate-600">
          <Activity size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="card divide-y divide-dark-800">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="mt-0.5 shrink-0">{getEventIcon(activity.event)}</div>
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
                  <p className="text-xs text-slate-600 mt-0.5">{activity.ip}</p>
                )}
                <PropertiesSummary properties={activity.properties} />
              </div>
              <time className="text-xs text-slate-600 shrink-0 font-mono">
                {formatDateTime(activity.timestamp)}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
