import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/lib/axios';
import { Server as ServerIcon } from 'lucide-react';
import { PublicStatusCard, PublicStatusCardProps } from '@/components/PublicStatusCard';

type PublicStatus = Omit<PublicStatusCardProps, 'allowCustomCss'>;

export function PublicStatusPage() {
  const { slug } = useParams();
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.get(`/public/status/${slug}`)
        .then(({ data }) => { if (!cancelled) setStatus(data); })
        .catch(() => { if (!cancelled) setNotFound(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#08080a' }}>
        <div className="w-8 h-8 rounded-full border-2 border-dark-700 border-t-panel-500 animate-spin" />
      </div>
    );
  }

  if (notFound || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#08080a' }}>
        <div className="card card-body text-center py-12 max-w-md w-full">
          <ServerIcon size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400">This status page doesn't exist or isn't public.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <PublicStatusCard {...status} allowCustomCss />
    </div>
  );
}
