import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Server as ServerIcon, Wifi, WifiOff, Megaphone } from 'lucide-react';
import { useSettings } from '@/hooks/useSettings';

export interface PublicStatusCardProps {
  name: string;
  description?: string | null;
  online: boolean;
  playerCount: number;
  maxPlayers: number | null;
  motd?: string | null;
  address?: string | null;
  accentColor?: string | null;
  banner?: string | null;
  logo?: string | null;
  announcement?: string | null;
  customCss?: string | null;
  /** Only true on the real public page — the in-panel editor preview never
   *  executes the owner's raw CSS against the rest of the app. */
  allowCustomCss?: boolean;
}

const DEFAULT_ACCENT = '#3b82f6';

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  if (Number.isNaN(n)) return '59, 130, 246';
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Eases the player-count number toward a new value instead of jump-cutting,
// so live refreshes feel alive rather than just re-rendering a static number.
function useCountUp(target: number, durationMs = 700): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return display;
}

export function PublicStatusCard({
  name, description, online, playerCount, maxPlayers, motd, address,
  accentColor, banner, logo, announcement, customCss, allowCustomCss,
}: PublicStatusCardProps) {
  const [copied, setCopied] = useState(false);
  const animatedCount = useCountUp(playerCount);
  const { data: settings } = useSettings();
  const hidePoweredBy = settings?.['whitelabel.hidePoweredBy'] === 'true';

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const accent = accentColor || DEFAULT_ACCENT;
  const accentRgb = hexToRgb(accent);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden"
      style={{ background: '#08080a', ['--accent' as string]: accent, ['--accent-rgb' as string]: accentRgb }}
    >
      <style>{`
        @keyframes ksp-drift1 { 0%,100% { transform: translate(-10%, -10%) scale(1); } 50% { transform: translate(10%, 5%) scale(1.15); } }
        @keyframes ksp-drift2 { 0%,100% { transform: translate(10%, 10%) scale(1); } 50% { transform: translate(-15%, -5%) scale(1.1); } }
        @keyframes ksp-float { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 0.5; } 90% { opacity: 0.5; } 100% { transform: translateY(-110%); opacity: 0; } }
        @keyframes ksp-ping { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(2.4); opacity: 0; } }
        @keyframes ksp-fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ksp-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.15); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes ksp-kenburns { 0% { transform: scale(1) translate(0,0); } 100% { transform: scale(1.12) translate(-1.5%, -1.5%); } }
        @keyframes ksp-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .ksp-blob { position: absolute; border-radius: 9999px; filter: blur(70px); pointer-events: none; }
        .ksp-particle { position: absolute; bottom: -10px; border-radius: 9999px; background: rgba(var(--accent-rgb), 0.7); animation: ksp-float linear infinite; }
        .ksp-card { animation: ksp-fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        .ksp-pop { animation: ksp-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ksp-banner { animation: ksp-kenburns 18s ease-in-out infinite alternate; }
        .ksp-announcement { background: linear-gradient(90deg, rgba(var(--accent-rgb),0.12) 0%, rgba(var(--accent-rgb),0.28) 50%, rgba(var(--accent-rgb),0.12) 100%); background-size: 200% 100%; animation: ksp-shimmer 5s linear infinite; }
        ${allowCustomCss && customCss ? customCss : ''}
      `}</style>

      <div className="ksp-blob" style={{ width: 500, height: 500, top: '-10%', left: '-5%', background: `rgba(${accentRgb}, 0.22)`, animation: 'ksp-drift1 16s ease-in-out infinite' }} />
      <div className="ksp-blob" style={{ width: 420, height: 420, bottom: '-15%', right: '-5%', background: `rgba(${accentRgb}, 0.16)`, animation: 'ksp-drift2 20s ease-in-out infinite' }} />
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="ksp-particle"
          style={{ left: `${(i * 7.3) % 100}%`, width: 3 + (i % 3), height: 3 + (i % 3), animationDuration: `${9 + (i % 6)}s`, animationDelay: `${i * 0.7}s` }}
        />
      ))}

      <div className="w-full max-w-md relative">
        <div
          className="ksp-card rounded-2xl overflow-hidden backdrop-blur-xl"
          style={{ background: 'rgba(17,17,19,0.75)', border: `1px solid rgba(${accentRgb}, 0.25)`, boxShadow: `0 0 60px -15px rgba(${accentRgb}, 0.35)` }}
        >
          <div className="h-24 relative overflow-hidden">
            <div
              className={banner ? 'ksp-banner absolute inset-0' : 'absolute inset-0'}
              style={{
                backgroundImage: banner
                  ? `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(17,17,19,0.95)), url(${banner})`
                  : `linear-gradient(135deg, rgba(${accentRgb}, 0.5), rgba(${accentRgb}, 0.05))`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          </div>

          <div className="px-6 -mt-8 relative">
            <div className="flex items-end gap-3">
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  className="w-16 h-16 rounded-2xl object-cover shrink-0 border-4"
                  style={{ borderColor: 'rgba(17,17,19,0.75)' }}
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 border-4" style={{ background: '#111113', borderColor: 'rgba(17,17,19,0.75)' }}>
                  <ServerIcon size={26} style={{ color: accent }} />
                </div>
              )}
              <div className="min-w-0 pb-1 flex items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {online && (
                    <span className="absolute inline-flex h-full w-full rounded-full" style={{ background: accent, animation: 'ksp-ping 1.8s cubic-bezier(0,0,0.2,1) infinite' }} />
                  )}
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: online ? accent : '#52525b' }} />
                </span>
                <span className="text-xs font-medium" style={{ color: online ? accent : '#71717a' }}>
                  {online ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            <h1 className="text-xl font-bold text-slate-100 mt-3 truncate">{name}</h1>
            {description && <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{description}</p>}
            {motd && (
              <p className="text-xs text-slate-500 mt-2 font-mono px-2.5 py-1.5 rounded-md bg-black/30 inline-block max-w-full truncate">
                {motd}
              </p>
            )}
          </div>

          {announcement && (
            <div className="mx-6 mt-4 ksp-announcement px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-medium" style={{ color: accent }}>
              <Megaphone size={13} className="shrink-0" />
              <span className="truncate">{announcement}</span>
            </div>
          )}

          <div className="p-6 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-slate-400">
                {online ? <Wifi size={15} /> : <WifiOff size={15} />}
                Players
              </span>
              <span className="text-sm font-semibold text-slate-200 tabular-nums">
                {animatedCount}{maxPlayers !== null ? ` / ${maxPlayers}` : ''}
              </span>
            </div>

            {address && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Server Address</p>
                <button
                  onClick={copyAddress}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-dark-900/70 border transition-colors text-left"
                  style={{ borderColor: copied ? accent : '#2a2a2e' }}
                >
                  <code className="text-sm truncate" style={{ color: accent }}>{address}</code>
                  <span key={copied ? 'check' : 'copy'} className="ksp-pop shrink-0">
                    {copied ? <Check size={14} style={{ color: accent }} /> : <Copy size={14} className="text-slate-500" />}
                  </span>
                </button>
              </div>
            )}
          </div>

          {!hidePoweredBy && (
            <div className="px-6 py-3 bg-black/20 text-center">
              <p className="text-[11px] text-slate-600">Powered by Kretase</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
