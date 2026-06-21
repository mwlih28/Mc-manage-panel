import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import api from '@/lib/axios';
import { Egg } from '@/types';
import { Spinner } from '@/components/ui/Spinner';

export function AdminEggsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-eggs'],
    queryFn: () => api.get('/eggs').then((r) => r.data.data),
  });

  const eggs: Egg[] = data || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Eggs</h1>
        <p className="text-slate-400 text-sm mt-1">Server configuration templates</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {eggs.map((egg) => (
            <div key={egg.id} className="card p-5">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2.5 rounded-lg bg-panel-500/20">
                  <Package size={18} className="text-panel-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-100">{egg.name}</p>
                  <p className="text-xs text-slate-500">{egg.nest?.name}</p>
                </div>
                {egg._count && (
                  <span className="badge badge-blue">{egg._count.servers} servers</span>
                )}
              </div>

              {egg.description && (
                <p className="text-xs text-slate-400 mb-3">{egg.description}</p>
              )}

              <div className="space-y-1">
                <p className="text-xs text-slate-500 font-medium">Docker Image</p>
                <p className="text-xs font-mono text-slate-400 bg-dark-950/60 px-2 py-1 rounded break-all">
                  {egg.dockerImage}
                </p>
              </div>

              {egg.variables && egg.variables.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dark-800">
                  <p className="text-xs text-slate-500 mb-2">{egg.variables.length} variables</p>
                  <div className="flex flex-wrap gap-1">
                    {egg.variables.slice(0, 3).map((v) => (
                      <span key={v.id} className="text-[10px] font-mono bg-dark-950/60 px-1.5 py-0.5 rounded text-slate-400">
                        {v.envVariable}
                      </span>
                    ))}
                    {egg.variables.length > 3 && (
                      <span className="text-[10px] text-slate-500">+{egg.variables.length - 3} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
