import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingsService } from 'src/ai/embeddings/embeddings.service';
import {
  ChunksRepository,
  type RetrievedChunk,
} from 'src/features/documents/chunks.repository';

export interface RetrieveOptions {
  /**
   * Required, not optional: it becomes a `WHERE` clause on the search, so
   * tenant isolation is enforced in SQL rather than by callers remembering to
   * filter afterwards.
   */
  userId: string;

  /** Already rewritten to stand alone, if the caller does conversational rewriting. */
  query: string;

  /**
   * Restricts the search to these documents. Omit to search everything the user
   * owns; an empty array means "nothing matched" and correctly retrieves
   * nothing, rather than silently widening back to all documents.
   */
  documentIds?: string[];

  topK?: number;

  /**
   * Similarity floor, below which a hit is dropped rather than passed to the
   * model. This is what makes an honest "I don't know" possible — without it,
   * the nearest chunks are always returned, however irrelevant, and the model
   * dutifully builds an answer out of them.
   */
  minScore?: number;

  /** Caps how much evidence reaches the prompt, after the floor has applied. */
  maxContextTokens?: number;
  /**
   * Document id to the name the caller refers to it by, such as "Job #2". Used
   * to label each evidence block so the model answers in the same terms the user
   * asked in. Falls back to the document kind when absent.
   */
  labels?: Map<string, string>;
}

export interface CitedChunk extends RetrievedChunk {
  /**
   * 1-based number this chunk is labelled with in the prompt, and therefore the
   * `[n]` the model cites. Assigned after filtering, so the numbering the model
   * sees has no gaps, and persisted as the citation rank so a stored answer's
   * markers still resolve to the right chunk when the message is re-read.
   */
  position: number;
}

export interface RetrievalResult {
  /** Ordered by relevance; empty when nothing cleared the floor. */
  chunks: CitedChunk[];
  /** The same chunks rendered as labelled evidence blocks for the prompt. */
  context: string;
}

/**
 * Enough for a question that spans a resume and two or three postings, without
 * diluting the prompt. The floor below usually binds first anyway.
 */
const DEFAULT_TOP_K = 8;

/**
 * Tuned against this corpus: cosine similarity on these embeddings puts a
 * genuinely on-topic chunk well above this, while an unrelated section of the
 * same resume falls below. Too high and valid questions get "I don't know";
 * too low and the model is handed noise and cites it.
 */
const DEFAULT_MIN_SCORE = 0.35;

/** Leaves room for the system prompt, the history window and the answer itself. */
const DEFAULT_MAX_CONTEXT_TOKENS = 6000;

/**
 * The read half of the RAG pipeline: question in, ranked evidence plus a
 * prompt-ready context block out.
 *
 * It deliberately stops short of the model. Nothing here generates anything —
 * which keeps "what did we retrieve" separable from "what did it say" when an
 * answer looks wrong, and lets features that need evidence without an answer
 * use it directly.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunksRepository,
  ) {}

  /**
   * Embeds the query, searches, then narrows twice: by relevance, then by
   * budget. The order matters — filtering first means the budget is spent on
   * chunks worth including, rather than being exhausted by high-ranked-but-weak
   * hits that should not have been there at all.
   *
   * An empty `chunks` is a normal outcome, not an error: it is the signal for
   * callers to answer "nothing in your documents covers that" without spending
   * a generation call.
   */
  async retrieve(options: RetrieveOptions): Promise<RetrievalResult> {
    const {
      userId,
      query,
      documentIds,
      topK = DEFAULT_TOP_K,
      minScore = DEFAULT_MIN_SCORE,
      maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS,
      labels,
    } = options;

    const embedding = await this.embeddings.embedQuery(query);

    const hits = await this.chunks.search({
      userId,
      embedding,
      limit: topK,
      documentIds,
    });

    const relevant = hits.filter((hit) => hit.score >= minScore);

    const chunks = this.applyTokenBudget(relevant, maxContextTokens).map(
      (chunk, index) => ({ ...chunk, position: index + 1 }),
    );

    this.logger.log(
      `retrieval k=${hits.length} kept=${chunks.length} top=${hits[0]?.score.toFixed(3) ?? 'n/a'} floor=${minScore}`,
    );

    return { chunks, context: this.buildContext(chunks, labels) };
  }

  /**
   * Renders chunks as numbered, labelled evidence blocks.
   *
   * The label is the point: presenting a chunk as `[2] Job #3 — "..."` lets the
   * model answer in the same vocabulary the user asked in, and lets the reader
   * check a claim against a specific document. Unlabelled evidence produces
   * answers that discuss "the job description" when three are in scope.
   */
  buildContext(chunks: CitedChunk[], labels?: Map<string, string>): string {
    if (chunks.length === 0) {
      return '';
    }

    return chunks
      .map((chunk) => {
        const label = labels?.get(chunk.documentId) ?? this.describe(chunk);

        return `[${chunk.position}] ${label} — "${chunk.documentTitle}"\n${chunk.content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Fills the budget in relevance order, skipping anything that would overflow
   * it.
   *
   * Skips rather than stops: one unusually long chunk near the top should cost
   * itself, not every less relevant but perfectly useful chunk behind it.
   * Relative order is preserved, so the numbering still runs best-first.
   */
  private applyTokenBudget(
    hits: RetrievedChunk[],
    maxTokens: number,
  ): RetrievedChunk[] {
    const kept: RetrievedChunk[] = [];
    let total = 0;

    for (const hit of hits) {
      if (total + hit.tokenCount > maxTokens) {
        continue;
      }

      kept.push(hit);
      total += hit.tokenCount;
    }

    return kept;
  }

  /**
   * Fallback label for callers that pass no label map. Generic on purpose —
   * inventing a specific-looking name here would put a term in the prompt that
   * the user never used.
   */
  private describe(chunk: RetrievedChunk): string {
    return chunk.documentKind === 'RESUME' ? 'Resume' : 'Job description';
  }
}
