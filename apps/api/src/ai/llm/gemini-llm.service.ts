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

/**
 * Gemini implementation of {@link LlmService}, and the only file in the API
 * allowed to know that Gemini is what's behind the port.
 *
 * Everything vendor-shaped is confined here: the `model` role name, the
 * `responseSchema` mechanism for JSON mode, usage-metadata field names, and the
 * fact that an empty response is a plausible outcome rather than an error.
 * Callers above see neutral turns in and {@link LlmResult} out.
 */
@Injectable()
export class GeminiLlmService extends LlmService {
  private readonly logger = new Logger(GeminiLlmService.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly configured: boolean;

  /**
   * A missing key is recorded, not thrown on. `GEMINI_API_KEY` is optional at
   * bootstrap by design (see EnvironmentVariables) so the API still starts for
   * sign-in, upload and validation work; the failure is raised at the point of
   * use with a message naming the variable.
   */
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

  /**
   * `responseSchema` makes malformed JSON very unlikely but not impossible —
   * a response truncated at `maxOutputTokens` is cut off mid-object and still
   * arrives as a successful call. Parsing is therefore guarded, and the failure
   * is reported as a provider problem rather than surfacing a raw SyntaxError.
   */
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

  /**
   * The single path to the provider, so retries, timing and the empty-response
   * check exist once and cannot drift between text and JSON generation.
   *
   * Latency is measured around the retry loop rather than inside it: what
   * matters to the caller is how long the request took, not how long the last
   * successful attempt took.
   */
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
      (signal) =>
        this.client.models.generateContent({
          model: this.model,
          // Gemini calls the assistant role "model"; the rest of the app uses
          // the conventional names and this adapter translates.
          contents: options.turns.map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.content }],
          })),
          config: {
            abortSignal: signal,
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
