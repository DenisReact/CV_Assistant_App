import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, type Schema } from '@google/genai';
import { withRetry } from 'src/common/retry';
import {
  LlmService,
  type GenerateJsonOptions,
  type GenerateOptions,
  type LlmJsonResult,
  type LlmResult,
} from './llm.service';

const DEFAULT_MODEL = 'gemini-3.6-flash';

@Injectable()
export class GeminiLlmService extends LlmService {
  private readonly logger = new Logger(GeminiLlmService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    super();

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

    const response = await withRetry(
      () =>
        this.client.models.generateContent({
          model: this.model,
          // Gemini calls the assistant role "model"; the rest of the app uses
          // the conventional names and this adapter translates.
          contents: options.turns.map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.content }],
          })),
          config: {
            systemInstruction: options.system,
            // Low by default: this app answers from retrieved evidence, and
            // creative variation reads as the model inventing experience.
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxOutputTokens ?? 2048,
            ...(schema
              ? { responseMimeType: 'application/json', responseSchema: schema }
              : {}),
          },
        }),
      { label: 'Generation', logger: this.logger },
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
}
