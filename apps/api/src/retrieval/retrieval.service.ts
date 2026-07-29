import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import {
  ChunksRepository,
  type RetrievedChunk,
} from '../documents/chunks.repository';

export interface RetrieveOptions {
  userId: string;
  query: string;
  documentIds?: string[];
  topK?: number;
  minScore?: number;
  maxContextTokens?: number;
  /**
   * Document id to the name the caller refers to it by, such as "Job #2". Used
   * to label each evidence block so the model answers in the same terms the user
   * asked in. Falls back to the document kind when absent.
   */
  labels?: Map<string, string>;
}

export interface CitedChunk extends RetrievedChunk {
  position: number;
}

export interface RetrievalResult {
  chunks: CitedChunk[];
  context: string;
}

const DEFAULT_TOP_K = 8;

const DEFAULT_MIN_SCORE = 0.35;

const DEFAULT_MAX_CONTEXT_TOKENS = 6000;

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly chunks: ChunksRepository,
  ) {}

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

    if (relevant.length < hits.length) {
      this.logger.debug(
        `Dropped ${hits.length - relevant.length} of ${hits.length} hits below score ${minScore}`,
      );
    }

    const chunks = this.applyTokenBudget(relevant, maxContextTokens).map(
      (chunk, index) => ({ ...chunk, position: index + 1 }),
    );

    return { chunks, context: this.buildContext(chunks, labels) };
  }

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

  private describe(chunk: RetrievedChunk): string {
    return chunk.documentKind === 'RESUME' ? 'Resume' : 'Job description';
  }
}
