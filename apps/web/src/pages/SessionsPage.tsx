import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { DocumentView, SessionView } from '../lib/types';
import { Button, Card, Empty, ErrorNote } from '../components/ui';

export function SessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [resumeId, setResumeId] = useState('');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    Promise.all([api.listSessions(), api.listDocuments()])
      .then(([sessionList, documentList]) => {
        setSessions(sessionList);
        setDocuments(documentList);

        // Pre-select the only resume when there is exactly one — the common
        // case, and one less click.
        const resumes = documentList.filter((d) => d.kind === 'RESUME');

        if (resumes.length === 1) {
          setResumeId(resumes[0].id);
        }
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, []);

  const resumes = useMemo(
    () => documents.filter((d) => d.kind === 'RESUME' && d.status === 'READY'),
    [documents],
  );
  const jobs = useMemo(
    () =>
      documents.filter(
        (d) => d.kind === 'JOB_DESCRIPTION' && d.status === 'READY',
      ),
    [documents],
  );

  function toggleJob(id: string) {
    setJobIds((current) =>
      current.includes(id)
        ? current.filter((j) => j !== id)
        : [...current, id],
    );
  }

  async function create() {
    setError(null);
    setCreating(true);

    try {
      const session = await api.createSession({
        resumeId: resumeId || undefined,
        jobIds,
        title: title.trim() || undefined,
      });

      navigate(`/sessions/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create');
      setCreating(false);
    }
  }

  if (loading) {
    return <Empty>Loading…</Empty>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Comparisons</h1>
        <p className="mt-1 text-sm text-muted">
          A comparison pairs one resume with the job descriptions you want it
          scored against, and keeps the conversation about them.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card>
        <h2 className="font-medium">New comparison</h2>

        {resumes.length === 0 || jobs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            You need at least one processed resume and one processed job
            description first —{' '}
            <Link to="/documents" className="text-accent underline">
              upload them here
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Resume</label>
              <select
                value={resumeId}
                onChange={(event) => setResumeId(event.target.value)}
                className="w-full max-w-md rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">Choose a resume…</option>
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Job descriptions
              </label>
              <div className="flex flex-wrap gap-2">
                {jobs.map((job) => {
                  const selected = jobIds.includes(job.id);
                  const label = selected
                    ? `#${jobIds.indexOf(job.id) + 1} ${job.title}`
                    : job.title;

                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => toggleJob(job.id)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                        selected
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line bg-surface text-muted hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Selection order sets the labels — the first becomes Job #1.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Title <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Berlin search, July"
                className="w-full max-w-md rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <Button
              onClick={() => void create()}
              disabled={creating || !resumeId || jobIds.length === 0}
            >
              {creating ? 'Creating…' : 'Create comparison'}
            </Button>
          </div>
        )}
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
          Existing
        </h2>

        {sessions.length === 0 ? (
          <Empty>No comparisons yet.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sessions.map((session) => (
              <Link key={session.id} to={`/sessions/${session.id}`}>
                <Card className="h-full transition hover:border-accent">
                  <p className="font-medium">
                    {session.title ?? session.resume?.title ?? 'Untitled'}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {session.resume
                      ? `Resume: ${session.resume.title}`
                      : 'No resume attached'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {session.jobs.length} job
                    {session.jobs.length === 1 ? '' : 's'} ·{' '}
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
