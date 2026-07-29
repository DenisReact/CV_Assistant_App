import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { withRetry } from '../../common/retry';
import { EMBEDDING_DIMENSIONS, EmbeddingsService } from './embeddings.service';

const DEFAULT_MODEL = 'gemini-embedding-001';

/**
 * The API caps instances per request. 32 stays comfortably inside that while
 * still amortising the round trip over a typical resume's worth of chunks.
 */
const BATCH_SIZE = 32;

/**
 * Gemini implementation of {@link EmbeddingsService}.
 *
 * `gemini-embedding-001` supports Matryoshka truncation, so it is asked for
 * {@link EMBEDDING_DIMENSIONS} directly rather than the model's native width.
 * Truncated vectors are no longer unit length, and pgvector's cosine operator
 * assumes they are — hence the explicit re-normalisation, which is the one
 * piece of maths in this class that is not optional.
 *
 * Everything the provider could get wrong is checked here rather than trusted
 * downstream: a short batch, a wrong-width vector, or a zero vector would each
 * degrade retrieval quietly instead of failing.
 */
@Injectable()
export class GeminiEmbeddingsService extends EmbeddingsService {
  private readonly logger = new Logger(GeminiEmbeddingsService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    super();

    const apiKey = config.get<string>('GEMINI_API_KEY')?.trim() ?? '';

    this.configured = apiKey.length > 0;

    if (!this.configured) {
      this.logger.warn(
        'GEMINI_API_KEY is not set — ingestion and retrieval will fail until it is',
      );
    }

    this.client = new GoogleGenAI({ apiKey });
    this.model = config.get<string>('GEMINI_EMBEDDING_MODEL') ?? DEFAULT_MODEL;
  }

  get modelName(): string {
    return this.model;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embedAll(texts, 'RETRIEVAL_DOCUMENT');
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedAll([text], 'RETRIEVAL_QUERY');

    return embedding;
  }

  /**
   * `taskType` is why the two public entry points are separate: the same text
   * embedded as a document and as a query lands in different places, and the
   * model is told which side of the comparison it is producing. Getting this
   * backwards costs retrieval quality with no visible error.
   *
   * Batches run sequentially rather than in parallel — the free tier rate-limits
   * per minute, and firing every batch at once turns a large upload into a wall
   * of 429s that the retry policy then has to unwind.
   */
  private async embedAll(
    texts: string[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (!this.configured) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const results: number[][] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      results.push(...(await this.embedBatch(batch, taskType)));
    }

    return results;
  }

  /**
   * The count check matters more than it looks: results are matched to their
   * inputs by index, so a provider that quietly drops one input would shift
   * every subsequent vector onto the wrong chunk.
   */
  private async embedBatch(
    batch: string[],
    taskType: string,
  ): Promise<number[][]> {
    const response = await withRetry(
      (signal) =>
        this.client.models.embedContent({
          model: this.model,
          contents: batch,
          config: {
            abortSignal: signal,
            taskType,
            outputDimensionality: EMBEDDING_DIMENSIONS,
          },
        }),
      { label: 'Embedding', logger: this.logger },
    );

    const embeddings = response.embeddings ?? [];

    if (embeddings.length !== batch.length) {
      throw new ServiceUnavailableException(
        `Embedding provider returned ${embeddings.length} vectors for ${batch.length} inputs`,
      );
    }

    return embeddings.map((embedding, index) => {
      const values = embedding.values;

      if (!values || values.length !== EMBEDDING_DIMENSIONS) {
        throw new ServiceUnavailableException(
          `Embedding ${index} has ${values?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }

      return this.normalise(values);
    });
  }

  /**
   * Scales to unit length, restoring the invariant truncation broke.
   *
   * A zero vector is rejected rather than passed through: it cannot be
   * normalised, and pgvector would return NaN distances for it, which sort
   * unpredictably instead of simply ranking last.
   */
  private normalise(values: number[]): number[] {
    const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));

    if (magnitude === 0) {
      throw new ServiceUnavailableException(
        'Embedding provider returned a zero vector',
      );
    }

    return values.map((v) => v / magnitude);
  }
}
