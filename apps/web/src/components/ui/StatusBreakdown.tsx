// A proportional stacked bar + legend for a small set of status counts —
// shared between Dashboard and Admin Overview so both read the same way.
export function StatusBreakdown({ counts, dotClass }: {
  counts: Record<string, number>;
  dotClass: (status: string) => string;
}) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const total = entries.reduce((a, [, count]) => a + count, 0);

  if (total === 0) return <p className="text-xs text-slate-600">No data yet</p>;

  return (
    <>
      <div className="flex h-2 rounded-full overflow-hidden bg-dark-950">
        {entries.map(([status, count]) => (
          <div
            key={status}
            className={dotClass(status).replace(' animate-pulse', '')}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="space-y-1.5 mt-3">
        {entries.map(([status, count]) => (
          <div key={status} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-400 capitalize">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass(status).replace(' animate-pulse', '')}`} />
              {status.toLowerCase()}
            </span>
            <span className="font-mono text-slate-300">{count}</span>
          </div>
        ))}
      </div>
    </>
  );
}
