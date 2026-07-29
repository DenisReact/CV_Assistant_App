import type { Schema } from '@google/genai';

/**
 * One message in a conversation, in provider-neutral terms.
 *
 * The roles are the conventional `user`/`assistant` pair rather than any one
 * vendor's naming, so feature code never has to know what the current provider
 * calls things. Adapters translate at the edge.
 */
export interface LlmTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  /**
   * Behavioural instructions, sent out-of-band from the conversation rather
   * than prepended as a turn — the model weights it differently, and it stays
   * out of the history window callers pass in `turns`.
   */
  system: string;

  /**
   * The conversation so far, oldest first, with the current question last.
   * Callers are responsible for windowing this; the port does not truncate.
   */
  turns: LlmTurn[];

  /**
   * Defaults low (see the adapter). Raise only where variation is wanted —
   * in a grounded-answer app it usually reads as invented detail.
   */
  temperature?: number;

  /**
   * A cap, not a target. Hitting it truncates the answer mid-sentence rather
   * than erroring, so leave headroom for the longest legitimate response.
   */
  maxOutputTokens?: number;
}

export interface GenerateJsonOptions<T> extends GenerateOptions {
  /** Enforced by the provider, so the response parses by construction. */
  schema: Schema;
  /** Narrows the parsed value; a model can satisfy a schema and still surprise you. */
  validate?: (value: unknown) => T;
}

/**
 * The generated text plus the telemetry needed to answer "what did this cost
 * and how slow was it" per call. Persisting these alongside the message is what
 * makes cost and latency queryable per session and per user after the fact.
 */
export interface LlmResult {
  text: string;

  /**
   * The model that actually served the call, recorded rather than assumed:
   * stored answers stay attributable after the configured default moves on.
   */
  model: string;

  /** Null when the provider omits usage metadata — absent, not zero. */
  promptTokens: number | null;
  completionTokens: number | null;

  /** Wall-clock round trip including retries, measured by the adapter. */
  latencyMs: number;
}

export interface LlmJsonResult<T> extends Omit<LlmResult, 'text'> {
  /** Parsed and, if a validator was supplied, narrowed by it. */
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
 * Contract for implementations: throw `ServiceUnavailableException` for
 * anything the caller cannot fix (provider down, rate limited, empty or
 * unparseable response). Callers treat a returned result as usable text and do
 * not re-check it, so an implementation must never resolve with an empty
 * string.
 */
export abstract class LlmService {
  /** The configured model, for recording on whatever this call produces. */
  abstract get modelName(): string;

  abstract generate(options: GenerateOptions): Promise<LlmResult>;

  /**
   * Generation constrained to a JSON schema, so the result is structurally
   * valid by construction rather than by prompt-and-hope.
   *
   * Structural validity is not semantic validity — a schema fixes the shape but
   * not whether a score is inside its documented range. Pass `validate` for
   * anything that gets stored or shown.
   */
  abstract generateJson<T>(
    options: GenerateJsonOptions<T>,
  ): Promise<LlmJsonResult<T>>;
}
