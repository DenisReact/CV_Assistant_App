import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { SessionFit, SessionView } from '../lib/types';
import { Chat } from '../components/Chat';
import { FitDashboard } from '../components/FitDashboard';
import { Button, Empty, ErrorNote } from '../components/ui';

type Tab = 'fit' | 'chat';

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionView | null>(null);
  const [fit, setFit] = useState<SessionFit | null>(null);
  const [tab, setTab] = useState<Tab>('fit');
  const [error, setError] = useState<string | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }

    const [sessionData, fitData] = await Promise.all([
      api.getSession(id),
      api.getFit(id),
    ]);

    setSession(sessionData);
    setFit(fitData);
  }, [id]);

  useEffect(() => {
    load()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [load]);

  const runFit = useCallback(
    (refresh: boolean) => {
      if (!id) {
        return;
      }

      setFitError(null);
      setRunning(true);

      // Sequential model calls server-side; a session with several jobs takes
      // tens of seconds, so results land in one update when done.
      api
        .runFit(id, refresh)
        .then(setFit)
        .catch((cause: unknown) =>
          setFitError(
            cause instanceof Error ? cause.message : 'Analysis failed',
          ),
        )
        .finally(() => setRunning(false));
    },
    [id],
  );

  async function remove() {
    if (!id || !window.confirm('Delete this comparison and its chat history?')) {
      return;
    }

    await api.deleteSession(id);
    navigate('/sessions');
  }

  if (loading) {
    return <Empty>Loading…</Empty>;
  }

  if (error || !session) {
    return <ErrorNote>{error ?? 'Not found'}</ErrorNote>;
  }

  const tabClass = (active: boolean) =>
    `rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
      active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
    }`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/sessions" className="text-xs text-muted hover:text-ink">
            ← Comparisons
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {session.title ?? session.resume?.title ?? 'Comparison'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {session.resume ? session.resume.title : 'No resume'} ·{' '}
            {session.jobs.map((job) => `#${job.label} ${job.title}`).join(' · ')}
          </p>
        </div>
        <Button variant="danger" onClick={() => void remove()}>
          Delete
        </Button>
      </div>

      <div className="flex gap-1 border-b border-line pb-3">
        <button className={tabClass(tab === 'fit')} onClick={() => setTab('fit')}>
          Fit dashboard
        </button>
        <button
          className={tabClass(tab === 'chat')}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
      </div>

      {tab === 'fit' ? (
        <FitDashboard
          fit={fit}
          onRun={runFit}
          running={running}
          error={fitError}
        />
      ) : (
        <Chat sessionId={session.id} />
      )}
    </div>
  );
}
