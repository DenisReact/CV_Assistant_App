import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useDeleteSession,
  useFit,
  useRunFit,
  useSession,
} from '../lib/queries';
import { Chat } from '../components/Chat';
import { FitDashboard } from '../components/FitDashboard';
import { Button, Empty, ErrorNote } from '../components/ui';

type Tab = 'fit' | 'chat';

export function SessionPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const sessionQuery = useSession(id);
  const fitQuery = useFit(id);
  const runFit = useRunFit(id);
  const deleteSession = useDeleteSession();

  const [tab, setTab] = useState<Tab>('fit');

  const session = sessionQuery.data;

  function handleDelete() {
    if (!window.confirm('Delete this comparison and its chat history?')) {
      return;
    }

    deleteSession.mutate(id, { onSuccess: () => navigate('/sessions') });
  }

  if (sessionQuery.isLoading) {
    return <Empty>Loading…</Empty>;
  }

  if (sessionQuery.error || !session) {
    return (
      <ErrorNote>{sessionQuery.error?.message ?? 'Not found'}</ErrorNote>
    );
  }

  const tabClass = (active: boolean) =>
    `border-b-2 px-1 pb-2 text-sm font-medium transition ${
      active
        ? 'border-accent text-ink'
        : 'border-transparent text-muted hover:text-ink'
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
            {session.jobs
              .map((job) => `#${job.label} ${job.title}`)
              .join(' · ')}
          </p>
        </div>
        <Button
          variant="danger"
          onClick={handleDelete}
          disabled={deleteSession.isPending}
        >
          Delete
        </Button>
      </div>

      <div className="flex gap-5 border-b border-line">
        <button
          className={tabClass(tab === 'fit')}
          onClick={() => setTab('fit')}
        >
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
          fit={fitQuery.data ?? null}
          onRun={(refresh) => runFit.mutate(refresh)}
          running={runFit.isPending}
          error={runFit.error?.message ?? fitQuery.error?.message ?? null}
        />
      ) : (
        <Chat sessionId={session.id} />
      )}
    </div>
  );
}
