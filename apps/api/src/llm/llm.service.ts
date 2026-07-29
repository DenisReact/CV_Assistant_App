import type { Schema } from '@google/genai';

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
  /** Narrows the parsed value; a model can satisfy a schema and still surprise you. */
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

/**
 * The port every feature service generates text through.
 *
 * Abstract class rather than interface because Nest can use it directly as an
 * injection token — consumers depend on `LlmService`, the module decides which
 * adapter that resolves to, and swapping providers is a one-line binding change
 * plus a new adapter file. Nothing outside this folder may import an LLM SDK.
 *
 */
export abstract class LlmService {
  abstract get modelName(): string;

  abstract generate(options: GenerateOptions): Promise<LlmResult>;

  /**
   * Generation constrained to a JSON schema, so the result is structurally
   * valid by construction rather than by prompt-and-hope.
   */
  abstract generateJson<T>(
    options: GenerateJsonOptions<T>,
  ): Promise<LlmJsonResult<T>>;
}
