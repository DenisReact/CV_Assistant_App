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
      className={`rounded-xl border border-line bg-surface p-5 ${className}`}
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
    primary: 'bg-accent text-white hover:opacity-90',
    ghost: 'border border-line text-ink hover:bg-canvas',
    danger: 'text-bad hover:bg-bad-soft',
  }[variant];

  return (
    <button
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

const STATUS_STYLES: Record<DocumentStatus, string> = {
  PENDING: 'bg-warn-soft text-warn',
  PROCESSING: 'bg-warn-soft text-warn',
  READY: 'bg-good-soft text-good',
  FAILED: 'bg-bad-soft text-bad',
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {(status === 'PENDING' || status === 'PROCESSING') && (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}

function scoreTone(score: number): { text: string; bg: string; bar: string } {
  if (score >= 70) {
    return { text: 'text-good', bg: 'bg-good-soft', bar: 'bg-good' };
  }

  if (score >= 40) {
    return { text: 'text-warn', bg: 'bg-warn-soft', bar: 'bg-warn' };
  }

  return { text: 'text-bad', bg: 'bg-bad-soft', bar: 'bg-bad' };
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);

  return (
    <div
      className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-xl ${tone.bg}`}
    >
      <span className={`text-xl font-semibold ${tone.text}`}>{score}</span>
      <span className={`text-[10px] ${tone.text} opacity-70`}>/ 100</span>
    </div>
  );
}

export function ScoreBar({ label, score }: { label: string; score: number }) {
  const tone = scoreTone(score);

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={`font-medium ${tone.text}`}>{score}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

const SEVERITY_STYLES: Record<GapSeverity, string> = {
  CRITICAL: 'bg-bad-soft text-bad',
  IMPORTANT: 'bg-warn-soft text-warn',
  NICE_TO_HAVE: 'bg-canvas text-muted',
};

export function SeverityTag({ severity }: { severity: GapSeverity }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${SEVERITY_STYLES[severity]}`}
    >
      {severity.replace(/_/g, ' ')}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {children}
    </div>
  );
}
