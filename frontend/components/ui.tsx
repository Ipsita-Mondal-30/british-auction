import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import type { Status } from '@/lib/api';
import { STATUS_LABEL } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      {...props}
      className={cx(
        'press inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line-strong bg-surface text-fg hover:bg-surface-2',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        className,
      )}
    />
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-panel', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  UPCOMING: 'border border-line-strong bg-surface text-fg',
  ACTIVE: 'bg-ok-soft text-ok',
  CLOSED: 'bg-surface-2 text-fg-2',
  FORCE_CLOSED: 'bg-danger-soft text-danger',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cx('inline-flex h-6 items-center rounded-md px-2 text-xs font-medium', STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function RankPill({ rank }: { rank: number }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 font-mono text-xs font-semibold tabular-nums',
        rank === 1 ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-fg-2',
      )}
    >
      L{rank}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass = (invalid?: boolean) =>
  cx(
    'h-9 w-full rounded-lg border bg-surface px-3 text-sm text-fg placeholder:text-fg-3',
    'transition-[border-color,box-shadow] duration-150',
    'focus:outline-none focus:ring-3',
    invalid ? 'border-danger focus:ring-danger/20' : 'border-line-strong focus:border-accent focus:ring-accent/20',
  );

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none', className)} />;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <span>{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export type IconMotion = 'gavel' | 'clock' | 'lock' | 'drop' | 'pop' | 'none';

/** Icon in a tile with an optional 2D motion (keyframes live in globals.css). */
export function MotionTile({
  icon: Glyph,
  motion,
  mode = 'idle',
  size = 14,
  className,
}: {
  icon: Icon;
  motion: IconMotion;
  mode?: 'idle' | 'once' | 'loop';
  size?: number;
  className?: string;
}) {
  return (
    <span data-mode={mode} className={cx('ico-tile grid shrink-0 place-items-center rounded-lg', className)}>
      <span className={cx('inline-flex', motion !== 'none' && `ico-${motion}`)}>
        <Glyph size={size} weight="bold" />
      </span>
    </span>
  );
}
