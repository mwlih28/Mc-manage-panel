import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

// Standardizes the "there's nothing here yet" panel that was hand-rolled
// slightly differently on every list page (varying icon sizes, colors, copy
// placement). One component → consistent empty states across the whole panel,
// with an optional primary call-to-action so an empty list can offer the
// obvious next step (e.g. "Create your first webhook") right where the user
// is already looking.
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  // `card` wraps it in the standard panel surface (most list pages want this);
  // `bare` is for when the caller already provides the surrounding card.
  variant?: 'card' | 'bare';
}

export function EmptyState({ icon: Icon, title, description, action, variant = 'card' }: EmptyStateProps) {
  const inner = (
    <div className="text-center">
      <div className="mx-auto mb-4 w-14 h-14 rounded-2xl flex items-center justify-center bg-white/[0.03] border border-white/[0.06]">
        <Icon size={26} className="text-zinc-600" />
      </div>
      <p className="text-zinc-200 font-medium text-sm">{title}</p>
      {description && <p className="text-zinc-500 text-xs mt-1.5 max-w-sm mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );

  if (variant === 'bare') return <div className="py-12">{inner}</div>;
  return <div className="card p-12">{inner}</div>;
}
