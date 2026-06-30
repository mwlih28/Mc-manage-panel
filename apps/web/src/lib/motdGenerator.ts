// Procedural MOTD generator — no external AI service, fully self-contained.
// Produces Minecraft server.properties-ready strings using §-formatting codes.

export type MotdTheme = 'survival' | 'creative' | 'minigame' | 'hardcore' | 'random';

interface ThemeBank {
  colors: string[];
  accents: string[];
  glyphs: string[];
  taglines: string[];
  subtitles: string[];
}

const THEMES: Exclude<MotdTheme, 'random'>[] = ['survival', 'creative', 'minigame', 'hardcore'];

const BANKS: Record<Exclude<MotdTheme, 'random'>, ThemeBank> = {
  survival: {
    colors: ['a', '2', 'e'],
    accents: ['7', 'f'],
    glyphs: ['⛏', '🌲', '⚔', '🏕'],
    taglines: ['Survive. Build. Thrive.', 'Your adventure starts here', 'Craft your legacy', 'Mine, build, survive'],
    subtitles: ['Now accepting new settlers', 'Fresh world, endless possibilities', 'Join the community today', 'Active & friendly staff'],
  },
  creative: {
    colors: ['b', '3', 'd'],
    accents: ['f', '7'],
    glyphs: ['🎨', '🏗', '✦', '💎'],
    taglines: ['Build without limits', 'Your imagination, our world', 'Creative freedom awaits', 'Design. Create. Inspire.'],
    subtitles: ['WorldEdit enabled', 'Unlimited blocks, zero limits', 'Showcase your builds', 'Plot worlds available'],
  },
  minigame: {
    colors: ['c', '6', 'e'],
    accents: ['f', '7'],
    glyphs: ['⚡', '🎮', '🏆', '🔥'],
    taglines: ['Fast-paced fun, every round', 'Play. Win. Repeat.', 'New games every hour', 'Compete for the top spot'],
    subtitles: ['Now with 10+ minigames', 'Join a match in seconds', 'Climb the leaderboard', 'Events every weekend'],
  },
  hardcore: {
    colors: ['4', 'c', '8'],
    accents: ['7', 'f'],
    glyphs: ['☠', '⚔', '🔥', '💀'],
    taglines: ['One life. No mercy.', 'Death is permanent', 'Only the strong survive', 'Hardcore rules apply'],
    subtitles: ['Permadeath enabled', 'No respawns, no second chances', 'Last one standing wins', 'Are you brave enough?'],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMotd(serverName: string, theme: MotdTheme = 'random', count = 5): string[] {
  const name = serverName.trim() || 'My Server';
  const variants: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = theme === 'random' ? pick(THEMES) : theme;
    const bank = BANKS[t];
    const c = pick(bank.colors);
    const a = pick(bank.accents);
    const glyph = pick(bank.glyphs);
    const tagline = pick(bank.taglines);
    const subtitle = pick(bank.subtitles);
    const useSubtitle = Math.random() > 0.5;
    const line1 = `§l§${c}${glyph} ${name} ${glyph}§r`;
    const line2 = `§${a}${useSubtitle ? subtitle : tagline}`;
    variants.push(`${line1}\n${line2}`);
  }
  return variants;
}

const COLOR_MAP: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF',
  c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

export interface MotdSegment {
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
}

export function parseMotdLines(motd: string): MotdSegment[][] {
  return motd.split('\n').map((line) => {
    const segments: MotdSegment[] = [];
    let color = '#FFFFFF';
    let bold = false;
    let italic = false;
    let buffer = '';
    const flush = () => {
      if (buffer) segments.push({ text: buffer, color, bold, italic });
      buffer = '';
    };
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '§' && i + 1 < line.length) {
        const code = line[i + 1].toLowerCase();
        // §x§R§R§G§G§B§B — Minecraft 1.16+ per-character RGB hex color
        if (code === 'x' && line.slice(i, i + 14).match(/^§x(§[0-9a-f]){6}$/i)) {
          flush();
          const hexDigits = line.slice(i + 2, i + 14).replace(/§/g, '');
          color = `#${hexDigits}`;
          bold = false;
          italic = false;
          i += 13;
          continue;
        }
        if (COLOR_MAP[code]) {
          flush();
          color = COLOR_MAP[code];
          bold = false;
          italic = false;
        } else if (code === 'l') {
          flush();
          bold = true;
        } else if (code === 'o') {
          flush();
          italic = true;
        } else if (code === 'r') {
          flush();
          color = '#FFFFFF';
          bold = false;
          italic = false;
        }
        i++;
        continue;
      }
      buffer += line[i];
    }
    flush();
    return segments;
  });
}

// ── RGB gradient text (Minecraft 1.16+ §x§R§R§G§G§B§B per-character hex) ──────
// Same output format as tools like birdflop.com/resources/rgb — a smooth
// multi-stop gradient applied character-by-character, no external service.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function generateGradientText(text: string, colors: string[], bold = false): string {
  const chars = Array.from(text);
  const n = chars.length;
  if (n === 0 || colors.length < 2) return text;

  const stops = colors.map(hexToRgb);
  const segCount = stops.length - 1;
  const prefix = bold ? '§l' : '';
  let result = '';

  for (let i = 0; i < n; i++) {
    if (chars[i] === ' ') { result += ' '; continue; }
    const t = n === 1 ? 0 : i / (n - 1);
    const segIdx = Math.min(Math.floor(t * segCount), segCount - 1);
    const segT = t * segCount - segIdx;
    const [r1, g1, b1] = stops[segIdx];
    const [r2, g2, b2] = stops[segIdx + 1];
    const hex = rgbToHex(r1 + (r2 - r1) * segT, g1 + (g2 - g1) * segT, b1 + (b2 - b1) * segT);
    const code = `§x${hex.split('').map((d) => `§${d}`).join('')}`;
    result += `${code}${prefix}${chars[i]}`;
  }
  return result;
}
