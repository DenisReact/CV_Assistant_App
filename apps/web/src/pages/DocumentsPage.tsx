import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { DocumentKind, DocumentView } from '../lib/types';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  StatusBadge,
} from '../components/ui';

const ACCEPT = '.pdf,.docx,.txt,.md';

/** Ingestion is a few seconds of network work, so a short poll is enough. */
const POLL_INTERVAL_MS = 2000;

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setDocuments(await api.listDocuments());
  }, []);

  useEffect(() => {
    refresh()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Failed to load'),
      )
      .finally(() => setLoading(false));
  }, [refresh]);

  /*
   * Upload returns 202 and indexes in the background, so the list has to be
   * re-read until nothing is in flight. The interval is torn down as soon as
   * everything settles rather than running for the life of the page.
   */
  const settling = documents.some(
    (document) => document.status === 'PENDING' || document.status === 'PROCESSING',
  );

  useEffect(() => {
    if (!settling) {
      return;
    }

    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [settling, refresh]);

  async function upload(file: File, kind: DocumentKind) {
    setError(null);
    setUploading(true);

    try {
      await api.uploadDocument(file, kind);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteDocument(id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed');
    }
  }

  async function reprocess(id: string) {
    try {
      await api.reprocessDocument(id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reprocess failed');
    }
  }

  const resumes = documents.filter((document) => document.kind === 'RESUME');
  const jobs = documents.filter(
    (document) => document.kind === 'JOB_DESCRIPTION',
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="mt-1 text-sm text-muted">
          Upload a resume and the job descriptions you want to be compared
          against. PDF, DOCX, TXT and Markdown are supported.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-4 sm:grid-cols-2">
        <UploadBox
          kind="RESUME"
          title="Resume"
          hint="Your CV"
          disabled={uploading}
          onFile={upload}
        />
        <UploadBox
          kind="JOB_DESCRIPTION"
          title="Job description"
          hint="One posting per file"
          disabled={uploading}
          onFile={upload}
        />
      </div>

      {loading ? (
        <Empty>Loading…</Empty>
      ) : documents.length === 0 ? (
        <Empty>Nothing uploaded yet.</Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <DocumentList
            heading="Resumes"
            documents={resumes}
            onRemove={remove}
            onReprocess={reprocess}
          />
          <DocumentList
            heading="Job descriptions"
            documents={jobs}
            onRemove={remove}
            onReprocess={reprocess}
          />
        </div>
      )}
    </div>
  );
}

function UploadBox({
  kind,
  title,
  hint,
  disabled,
  onFile,
}: {
  kind: DocumentKind;
  title: string;
  hint: string;
  disabled: boolean;
  onFile: (file: File, kind: DocumentKind) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);

        const file = event.dataTransfer.files[0];

        if (file) {
          onFile(file, kind);
        }
      }}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
        dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
      }`}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            onFile(file, kind);
          }

          // Reset so re-selecting the same filename fires change again.
          event.target.value = '';
        }}
      />

      <div className="mt-3">
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {disabled ? 'Uploading…' : 'Choose file'}
        </Button>
      </div>
    </div>
  );
}

function DocumentList({
  heading,
  documents,
  onRemove,
  onReprocess,
}: {
  heading: string;
  documents: DocumentView[];
  onRemove: (id: string) => void;
  onReprocess: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
        {heading}
      </h2>

      {documents.length === 0 ? (
        <Empty>None yet.</Empty>
      ) : (
        <div className="space-y-3">
          {documents.map((document) => (
            <Card key={document.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{document.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {document.sourceFilename}
                  </p>
                </div>
                <StatusBadge
                  status={document.status}
                  chunkCount={document.chunkCount}
                />
              </div>

              {document.error && (
                <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">
                  {document.error}
                </p>
              )}

              <div className="mt-3 flex gap-1">
                {document.status === 'FAILED' && (
                  <Button
                    variant="ghost"
                    onClick={() => onReprocess(document.id)}
                  >
                    Retry
                  </Button>
                )}
                <Button variant="danger" onClick={() => onRemove(document.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
