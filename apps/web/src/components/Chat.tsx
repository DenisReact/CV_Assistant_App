import { useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import { useMessages, useSendMessage } from '../lib/queries';
import type { Citation, MessageView } from '../lib/types';
import { Button, Empty, ErrorNote } from './ui';

export function Chat({ sessionId }: { sessionId: string }) {
  const { data: messages = [], isLoading, error: loadError } = useMessages(sessionId);
  const send = useSendMessage(sessionId);

  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const busy = send.isPending;
  const error = loadError ?? send.error;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  function handleSend(event: FormEvent) {
    event.preventDefault();

    const content = draft.trim();

    if (!content || busy) {
      return;
    }

    setDraft('');
    send.mutate(content);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4">
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : messages.length === 0 ? (
          <Empty>
            Ask anything about the fit — &ldquo;How does my experience align
            with Job #1?&rdquo;, &ldquo;What should I prepare for an interview
            for Job #2?&rdquo;
          </Empty>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="size-2 animate-pulse rounded-full bg-accent" />
            Retrieving evidence and answering…
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && <ErrorNote>{error.message}</ErrorNote>}

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about your fit…"
          className="flex-1 rounded-sm border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" disabled={busy || draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: MessageView }) {
  if (message.role === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-sm bg-ink px-4 py-2.5 text-sm text-canvas">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[95%] rounded-sm border border-line bg-surface px-4 py-3">
      {/*
       * The model writes citation markers like [2] inline; they correspond to
       * the numbered list below the answer, same numbering both places.
       */}
      <div className="prose-sm space-y-2 text-sm leading-relaxed [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold">
        <Markdown>{message.content}</Markdown>
      </div>

      {message.citations.length > 0 && (
        <CitationList citations={message.citations} />
      )}

      {message.model && (
        <p className="mt-2 text-[11px] text-muted">
          {message.model}
          {message.latencyMs !== null && ` · ${message.latencyMs}ms`}
          {message.promptTokens !== null &&
            ` · ${message.promptTokens}→${message.completionTokens} tokens`}
        </p>
      )}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [openPosition, setOpenPosition] = useState<number | null>(null);

  const open = citations.find((c) => c.position === openPosition);

  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Sources
      </p>

      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <button
            key={citation.position}
            onClick={() =>
              setOpenPosition((current) =>
                current === citation.position ? null : citation.position,
              )
            }
            className={`rounded-sm border px-2 py-1 text-xs transition ${
              openPosition === citation.position
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-muted hover:text-ink'
            }`}
          >
            [{citation.position}] {citation.label}
            <span className="ml-1 opacity-60">
              {(citation.score * 100).toFixed(0)}%
            </span>
          </button>
        ))}
      </div>

      {open && <Excerpt citation={open} />}
    </div>
  );
}

function Excerpt({ citation }: { citation: Citation }) {
  return (
    <blockquote className="mt-2 rounded-sm bg-canvas p-3 text-xs leading-relaxed text-muted">
      <p className="mb-1 font-medium text-ink">
        {citation.label} — {citation.documentTitle} · chunk{' '}
        {citation.chunkIndex} · similarity {(citation.score * 100).toFixed(1)}%
      </p>
      &ldquo;{citation.excerpt}&rdquo;
    </blockquote>
  );
}
