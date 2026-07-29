import { useState } from 'react';
import type { SessionFit } from '../lib/types';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  ScoreBadge,
  ScoreBar,
  SeverityTag,
} from './ui';

export function FitDashboard({
  fit,
  onRun,
  running,
  error,
}: {
  fit: SessionFit | null;
  onRun: (refresh: boolean) => void;
  running: boolean;
  error: string | null;
}) {
  const hasAnalyses = fit?.jobs.some((job) => job.analysis) ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Each job is scored against the resume with a full-document reading —
          gaps included, not just the parts that already match.
        </p>
        <div className="flex gap-2">
          {hasAnalyses && (
            <Button variant="ghost" onClick={() => onRun(true)} disabled={running}>
              Re-score
            </Button>
          )}
          <Button onClick={() => onRun(false)} disabled={running}>
            {running
              ? 'Scoring…'
              : hasAnalyses
                ? 'Score missing'
                : 'Run analysis'}
          </Button>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!fit || fit.jobs.length === 0 ? (
        <Empty>Attach a resume and at least one job description.</Empty>
      ) : (
        <div className="space-y-4">
          {fit.jobs.map((job) => (
            <JobCard key={job.documentId} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: SessionFit['jobs'][number] }) {
  const [open, setOpen] = useState(false);
  const analysis = job.analysis;

  if (!analysis) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <span className="mr-2 text-xs font-semibold text-accent">
              {job.label}
            </span>
            <span className="font-medium">{job.title}</span>
          </div>
          <span className="text-xs text-muted">
            {job.status === 'READY' ? 'Not scored yet' : job.status}
          </span>
        </div>
      </Card>
    );
  }

  const { breakdown } = analysis;

  return (
    <Card>
      <div className="flex items-start gap-4">
        <ScoreBadge score={analysis.overallScore} />

        <div className="min-w-0 flex-1">
          <div>
            <span className="mr-2 text-xs font-semibold text-accent">
              {job.label}
            </span>
            <span className="font-medium">{job.title}</span>
          </div>
          <p className="mt-1.5 text-sm text-muted">{breakdown.summary}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {breakdown.dimensions.map((dimension) => (
          <ScoreBar
            key={dimension.name}
            label={dimension.name}
            score={dimension.score}
          />
        ))}
      </div>

      <button
        onClick={() => setOpen((current) => !current)}
        className="mt-4 text-sm font-medium text-accent"
      >
        {open ? 'Hide details' : 'Show details'}
      </button>

      {open && (
        <div className="mt-4 grid gap-6 border-t border-line pt-4 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Matched skills
            </h3>
            {breakdown.matchedSkills.length === 0 ? (
              <p className="text-sm text-muted">None found.</p>
            ) : (
              <ul className="space-y-2">
                {breakdown.matchedSkills.map((match) => (
                  <li key={match.skill} className="text-sm">
                    <span className="font-medium text-good">{match.skill}</span>
                    <p className="text-xs text-muted">{match.evidence}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Gaps
            </h3>
            {breakdown.gaps.length === 0 ? (
              <p className="text-sm text-muted">No gaps identified.</p>
            ) : (
              <ul className="space-y-2">
                {breakdown.gaps.map((gap) => (
                  <li key={gap.skill} className="text-sm">
                    <span className="mr-2 font-medium">{gap.skill}</span>
                    <SeverityTag severity={gap.severity} />
                    <p className="mt-0.5 text-xs text-muted">{gap.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lg:col-span-2">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Interview talking points
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {breakdown.interviewTalkingPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-muted lg:col-span-2">
            Scored by {analysis.model} ·{' '}
            {new Date(analysis.computedAt).toLocaleString()}
          </p>
        </div>
      )}
    </Card>
  );
}
