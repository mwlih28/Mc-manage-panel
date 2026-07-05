import { ReactNode } from 'react';

// A single card divided into equal cells, Grafana/Pterodactyl-style — used
// instead of separate spaced-out stat cards wherever a page needs a compact
// row of at-a-glance numbers (Dashboard, Admin Overview, etc).
export function MetricStrip({ children, columns = 6 }: { children: ReactNode; columns?: 4 | 5 | 6 }) {
  const colsClass = columns === 4
    ? 'sm:grid-cols-2 lg:grid-cols-4'
    : columns === 5
    ? 'sm:grid-cols-3 lg:grid-cols-5'
    : 'sm:grid-cols-3 lg:grid-cols-6';
  return (
    <div className={`card grid grid-cols-2 ${colsClass} divide-x divide-y sm:divide-y-0 divide-dark-800`}>
      {children}
    </div>
  );
}

export function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${color}`} />
        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider truncate">{label}</p>
      </div>
      <p className="text-lg font-bold text-white font-mono leading-none">{value}</p>
    </div>
  );
}
