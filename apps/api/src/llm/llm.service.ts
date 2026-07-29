import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, type Schema } from '@google/genai';

const DEFAULT_MODEL = 'gemini-3.6-flash';

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

export interface LlmTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  system: string;
  turns: LlmTurn[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateJsonOptions<T> extends GenerateOptions {
  schema: Schema;
  validate?: (value: unknown) => T;
}

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}

export interface LlmJsonResult<T> extends Omit<LlmResult, 'text'> {
  data: T;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('GEMINI_API_KEY')?.trim() ?? '';

    this.configured = apiKey.length > 0;
    this.client = new GoogleGenAI({ apiKey });
    this.model = config.get<string>('GEMINI_CHAT_MODEL') ?? DEFAULT_MODEL;
  }

  get modelName(): string {
    return this.model;
  }

  async generate(options: GenerateOptions): Promise<LlmResult> {
    return this.call(options);
  }

  async generateJson<T>(
    options: GenerateJsonOptions<T>,
  ): Promise<LlmJsonResult<T>> {
    const result = await this.call(options, options.schema);

    let parsed: unknown;

    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new ServiceUnavailableException(
        'Model returned malformed JSON despite a constrained schema',
      );
    }

    return {
      data: options.validate ? options.validate(parsed) : (parsed as T),
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
    };
  }

  private async call(
    options: GenerateOptions,
    schema?: Schema,
  ): Promise<LlmResult> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const started = Date.now();

    const response = await this.withRetry(() =>
      this.client.models.generateContent({
        model: this.model,
        contents: options.turns.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        })),
        config: {
          systemInstruction: options.system,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 2048,
          ...(schema
            ? { responseMimeType: 'application/json', responseSchema: schema }
            : {}),
        },
      }),
    );

    const text = response.text;

    if (!text) {
      throw new ServiceUnavailableException(
        'Model returned an empty response; it may have hit a safety filter or the output token cap',
      );
    }

    const usage = response.usageMetadata;

    return {
      text,
      model: this.model,
      promptTokens: usage?.promptTokenCount ?? null,
      completionTokens: usage?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - started,
    };
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
          `Generation attempt ${attempt} failed, retrying in ${delay}ms: ${this.describe(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new ServiceUnavailableException(
      `Generation provider unavailable: ${this.describe(lastError)}`,
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
