'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowRight,
  CheckCircle,
  ClockClockwise,
  FileText,
  Gavel,
  Info,
  LockSimple,
  TrendDown,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { MotionTile, type IconMotion } from '@/components/ui';

export type NotifyKind = 'bid' | 'extended' | 'outbid' | 'capped' | 'rfq' | 'success' | 'info' | 'error';

const KIND: Record<NotifyKind, { icon: Icon; tile: string; motion: IconMotion }> = {
  bid: { icon: Gavel, tile: 'bg-fg text-white', motion: 'gavel' },
  rfq: { icon: FileText, tile: 'bg-fg text-white', motion: 'pop' },
  extended: { icon: ClockClockwise, tile: 'bg-warn-soft text-warn', motion: 'clock' },
  outbid: { icon: TrendDown, tile: 'bg-danger-soft text-danger', motion: 'drop' },
  capped: { icon: LockSimple, tile: 'bg-surface-2 text-fg', motion: 'lock' },
  success: { icon: CheckCircle, tile: 'bg-ok-soft text-ok', motion: 'pop' },
  info: { icon: Info, tile: 'bg-surface-2 text-fg', motion: 'none' },
  error: { icon: WarningCircle, tile: 'bg-danger-soft text-danger', motion: 'none' },
};

export interface NotifyOptions {
  kind: NotifyKind;
  title: string;
  description?: string;
  /** Adds a "View auction" link. */
  href?: string;
  /** Same id updates the existing toast instead of stacking a new one. */
  id?: string;
  duration?: number;
}

/** App-wide toast. Headless Sonner: Sonner handles stacking, swipe and timers; the card is ours. */
export function notify({ kind, title, description, href, id, duration }: NotifyOptions) {
  const { icon, tile, motion } = KIND[kind];
  return toast.custom(
    (t) => (
      <div
        role={kind === 'outbid' || kind === 'error' ? 'alert' : 'status'}
        className="flex w-[min(380px,calc(100vw-32px))] items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-fg shadow-float"
      >
        <MotionTile icon={icon} motion={motion} mode="once" size={16} className={`size-8 ${tile}`} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-medium leading-snug">{title}</p>
          {description && <p className="mt-0.5 text-[13px] leading-snug text-fg-2">{description}</p>}
          {href && (
            <Link
              href={href}
              onClick={() => toast.dismiss(t)}
              className="group mt-2 inline-flex items-center gap-1 text-[13px] font-medium underline-offset-4 hover:underline"
            >
              View auction
              <ArrowRight size={12} weight="bold" className="transition-transform duration-150 group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
        <button
          onClick={() => toast.dismiss(t)}
          aria-label="Dismiss notification"
          className="press -mr-1 -mt-1 rounded-md p-1 text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
    ),
    { id, duration: duration ?? (kind === 'outbid' ? 9000 : 6000) },
  );
}
