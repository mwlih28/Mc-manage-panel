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

// `color` is intentionally unused — a different bullet color per metric
// (RAM=green, disk=blue, nodes=yellow...) read as decoration without
// meaning, since these are neutral counts, not statuses. Kept in the prop
// signature so existing call sites don't need touching; color is reserved
// for where it's actually meaningful, like the server status dot elsewhere.
export function Metric({ label, value }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider truncate mb-1.5">{label}</p>
      <p className="text-xl font-semibold text-white font-mono leading-none tabular-nums">{value}</p>
    </div>
  );
}
