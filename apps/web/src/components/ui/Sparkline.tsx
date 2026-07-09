// A tiny inline-SVG trend line — deliberately NOT recharts, so it stays a
// few hundred bytes and doesn't drag the heavy charting chunk onto the
// dashboard just to draw a 24-point line per row. Renders nothing when there
// isn't enough data to show a trend (a single point isn't a line).
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  // Fixed upper bound for the y-axis (e.g. a server's CPU limit %). When
  // omitted the line auto-scales to its own min/max, which exaggerates tiny
  // idle wiggles — pass this to keep bars comparable to an absolute ceiling.
  max?: number;
  className?: string;
}

export function Sparkline({ data, width = 72, height = 22, color = '#4C8DFF', max, className }: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <div
        className={className}
        style={{ width, height }}
        aria-hidden
      />
    );
  }

  const hi = max ?? Math.max(...data);
  const lo = Math.min(...data, 0);
  const range = hi - lo || 1;
  // Leave a 1px breathing margin top/bottom so the peak/trough aren't clipped.
  const pad = 1;
  const usableH = height - pad * 2;
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((v - lo) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  // Close the shape down to the baseline for a subtle area fill under the line.
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const gradId = `spark-${color.replace('#', '')}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
