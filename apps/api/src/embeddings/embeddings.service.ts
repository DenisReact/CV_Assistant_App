import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

export const EMBEDDING_DIMENSIONS = 768;

const DEFAULT_MODEL = 'gemini-embedding-001';

const BATCH_SIZE = 32;

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
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

  private async embedBatch(
    batch: string[],
    taskType: string,
  ): Promise<number[][]> {
    const response = await this.withRetry(() =>
      this.client.models.embedContent({
        model: this.model,
        contents: batch,
        config: {
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      }),
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

  private normalise(values: number[]): number[] {
    const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));

    if (magnitude === 0) {
      throw new ServiceUnavailableException(
        'Embedding provider returned a zero vector',
      );
    }

    return values.map((v) => v / magnitude);
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error) || attempt === MAX_ATTEMPTS) {
          break;
        }

        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Embedding attempt ${attempt} failed, retrying in ${delay}ms: ${this.describe(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new ServiceUnavailableException(
      `Embedding provider unavailable: ${this.describe(lastError)}`,
    );
  }

  private isRetryable(error: unknown): boolean {
    const status = (error as { status?: number })?.status;

    if (typeof status === 'number') {
      return status === 429 || status >= 500;
    }

    return /429|rate limit|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
      this.describe(error),
    );
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
