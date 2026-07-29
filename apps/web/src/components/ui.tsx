import type { ReactNode } from 'react';
import type { DocumentStatus, GapSeverity } from '../lib/types';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-sm border border-line bg-surface p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary: 'bg-ink text-canvas hover:opacity-85',
    ghost: 'border border-line bg-surface text-ink hover:border-muted',
    danger: 'text-bad hover:bg-bad-soft',
  }[variant];

  return (
    <button
      {...props}
      className={`rounded-sm px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

const STATUS_DOT: Record<DocumentStatus, string> = {
  PENDING: 'bg-warn animate-pulse',
  PROCESSING: 'bg-warn animate-pulse',
  READY: 'bg-good',
  FAILED: 'bg-bad',
};

const STATUS_TEXT: Record<DocumentStatus, string> = {
  PENDING: 'text-warn',
  PROCESSING: 'text-warn',
  READY: 'text-good',
  FAILED: 'text-bad',
};

export function StatusBadge({
  status,
  chunkCount,
}: {
  status: DocumentStatus;
  chunkCount?: number;
}) {
  const label =
    status === 'READY' && chunkCount !== undefined
      ? `Ready · ${chunkCount} chunk${chunkCount === 1 ? '' : 's'}`
      : status.charAt(0) + status.slice(1).toLowerCase();

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase ${STATUS_TEXT[status]}`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {label}
    </span>
  );
}

function scoreTone(score: number): { text: string; bar: string } {
  if (score >= 70) {
    return { text: 'text-good', bar: 'bg-good' };
  }

  if (score >= 40) {
    return { text: 'text-warn', bar: 'bg-warn' };
  }

  return { text: 'text-bad', bar: 'bg-bad' };
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);

  return (
    <div className="w-16 shrink-0 text-center">
      <div
        className={`font-serif text-4xl leading-none tabular-nums ${tone.text}`}
      >
        {score}
      </div>
      <div className="mt-1 border-t border-line pt-1 text-[10px] tracking-wide text-muted uppercase">
        of 100
      </div>
    </div>
  );
}

export function ScoreBar({ label, score }: { label: string; score: number }) {
  const tone = scoreTone(score);

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={`font-medium tabular-nums ${tone.text}`}>{score}</span>
      </div>
      <div className="h-1 overflow-hidden bg-line">
        <div className={`h-full ${tone.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

const SEVERITY_STYLES: Record<GapSeverity, string> = {
  CRITICAL: 'border-bad text-bad',
  IMPORTANT: 'border-warn text-warn',
  NICE_TO_HAVE: 'border-line text-muted',
};

export function SeverityTag({ severity }: { severity: GapSeverity }) {
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${SEVERITY_STYLES[severity]}`}
    >
      {severity.replace(/_/g, ' ')}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-line p-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border-l-2 border-bad bg-bad-soft px-3 py-2 text-sm text-bad">
      {children}
    </div>
  );
}
