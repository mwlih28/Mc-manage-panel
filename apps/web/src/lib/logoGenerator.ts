// Procedural server logo generator — deterministic SVG composition, no external
// AI service or trained model involved. Fully self-contained and free to run.

export type LogoShape = 'hexagon' | 'shield' | 'diamond' | 'circle' | 'square';

export interface LogoSpec {
  shape: LogoShape;
  gradientFrom: string;
  gradientTo: string;
  letter: string;
  seed: number;
}

const PALETTES: [string, string][] = [
  ['#10b981', '#059669'],
  ['#6366f1', '#4338ca'],
  ['#f59e0b', '#d97706'],
  ['#ef4444', '#b91c1c'],
  ['#06b6d4', '#0e7490'],
  ['#a78bfa', '#7c3aed'],
  ['#22d3ee', '#0891b2'],
  ['#f472b6', '#db2777'],
  ['#84cc16', '#4d7c0f'],
];

const SHAPES: LogoShape[] = ['hexagon', 'shield', 'diamond', 'circle', 'square'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateLogos(serverName: string, count = 6): LogoSpec[] {
  const letter = (serverName.trim()[0] || 'K').toUpperCase();
  const out: LogoSpec[] = [];
  for (let i = 0; i < count; i++) {
    const palette = pick(PALETTES);
    out.push({
      shape: pick(SHAPES),
      gradientFrom: palette[0],
      gradientTo: palette[1],
      letter,
      seed: Math.random(),
    });
  }
  return out;
}

function shapePath(shape: LogoShape): string {
  switch (shape) {
    case 'hexagon': return 'M100,10 L180,55 L180,145 L100,190 L20,145 L20,55 Z';
    case 'diamond': return 'M100,10 L190,100 L100,190 L10,100 Z';
    case 'shield': return 'M100,15 L175,40 L175,100 Q175,160 100,185 Q25,160 25,100 L25,40 Z';
    default: return '';
  }
}

export function logoSpecToSvgString(spec: LogoSpec, gradId: string): string {
  const { shape, gradientFrom, gradientTo, letter, seed } = spec;

  // Deterministic pseudo-random "pixel" accents from the seed, so the same
  // spec always renders the same logo (useful for re-rendering after reload).
  const rnd = (n: number) => {
    const x = Math.sin(seed * 999 + n * 137.5) * 10000;
    return x - Math.floor(x);
  };
  const pixels = Array.from({ length: 6 }, (_, i) => {
    const x = 30 + rnd(i) * 140;
    const y = 30 + rnd(i + 50) * 140;
    const s = 6 + rnd(i + 100) * 10;
    const op = 0.08 + rnd(i + 150) * 0.12;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="#ffffff" opacity="${op.toFixed(2)}" />`;
  }).join('');

  const shapeEl = shape === 'circle'
    ? `<circle cx="100" cy="100" r="90" fill="url(#${gradId})" />`
    : shape === 'square'
      ? `<rect x="15" y="15" width="170" height="170" rx="28" fill="url(#${gradId})" />`
      : `<path d="${shapePath(shape)}" fill="url(#${gradId})" />`;

  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${gradientFrom}" />
      <stop offset="100%" stop-color="${gradientTo}" />
    </linearGradient>
  </defs>
  ${shapeEl}
  ${pixels}
  <text x="100" y="106" text-anchor="middle" dominant-baseline="middle" font-family="'Segoe UI', system-ui, sans-serif" font-weight="800" font-size="92" fill="#ffffff">${letter}</text>
</svg>`;
}
