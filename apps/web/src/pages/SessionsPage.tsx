import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateSession, useDocuments, useSessions } from '../lib/queries';
import { Button, Card, Empty, ErrorNote } from '../components/ui';

export function SessionsPage() {
  const navigate = useNavigate();
  const sessionsQuery = useSessions();
  const documentsQuery = useDocuments();
  const create = useCreateSession();

  const [resumeId, setResumeId] = useState('');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  const sessions = sessionsQuery.data ?? [];
  // Depend on query.data directly — it is referentially stable between
  // renders, whereas `data ?? []` mints a fresh array and defeats the memo.
  const documents = documentsQuery.data;

  const resumes = useMemo(
    () =>
      (documents ?? []).filter(
        (d) => d.kind === 'RESUME' && d.status === 'READY',
      ),
    [documents],
  );
  const jobs = useMemo(
    () =>
      (documents ?? []).filter(
        (d) => d.kind === 'JOB_DESCRIPTION' && d.status === 'READY',
      ),
    [documents],
  );

  useEffect(() => {
    if (resumes.length === 1) {
      setResumeId((current) => current || resumes[0].id);
    }
  }, [resumes]);

  const error = sessionsQuery.error ?? documentsQuery.error ?? create.error;

  function toggleJob(id: string) {
    setJobIds((current) =>
      current.includes(id) ? current.filter((j) => j !== id) : [...current, id],
    );
  }

  function handleCreate() {
    create.mutate(
      {
        resumeId: resumeId || undefined,
        jobIds,
        title: title.trim() || undefined,
      },
      { onSuccess: (session) => navigate(`/sessions/${session.id}`) },
    );
  }

  if (sessionsQuery.isLoading || documentsQuery.isLoading) {
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

      {error && <ErrorNote>{error.message}</ErrorNote>}

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
                className="w-full max-w-md rounded-sm border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
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
                      className={`rounded-sm border px-3 py-1.5 text-sm transition ${
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
                className="w-full max-w-md rounded-sm border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>

            <Button
              onClick={handleCreate}
              disabled={create.isPending || !resumeId || jobIds.length === 0}
            >
              {create.isPending ? 'Creating…' : 'Create comparison'}
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
