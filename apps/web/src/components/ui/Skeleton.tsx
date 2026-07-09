import { cn } from '@/lib/utils';

// Primitive shimmer block. Everything else in this file composes these into
// the shape of the real content it stands in for, so the loading state has
// the same layout as the loaded state (no jump when data arrives).
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

// Mirrors MetricStrip's card-with-divided-cells shape so the dashboard/admin
// overview don't collapse-then-expand when their numbers load.
export function MetricStripSkeleton({ cells = 5 }: { cells?: number }) {
  return (
    <div className="card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-dark-800">
      {Array.from({ length: cells }).map((_, i) => (
        <div key={i} className="px-4 py-3.5">
          <Skeleton className="h-2.5 w-16 mb-2.5" />
          <Skeleton className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

// Generic table-body placeholder sized to match the real rows (avatar dot +
// two-line label + trailing cells). `columns` controls how many trailing
// cells shimmer per row so it lines up with the real header.
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-dark-800/60">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-2 w-2 rounded-full shrink-0" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-40 mb-1.5" />
            <Skeleton className="h-2 w-24" />
          </div>
          {Array.from({ length: Math.max(0, columns - 1) }).map((_, c) => (
            <Skeleton key={c} className="h-3 w-12 hidden sm:block" />
          ))}
        </div>
      ))}
    </div>
  );
}

// A single generic content card (header line + a few body lines), for pages
// that show one or two panels rather than a table.
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-5">
      <Skeleton className="h-3.5 w-32 mb-4" />
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}
