import { Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Extracted here because the embeddings and generation clients had the same
 * retry loop copy-pasted — and a policy that exists twice will drift twice.
 */
export interface RetryOptions {
  /** Names the caller in log lines and error messages, e.g. "Embedding". */
  label: string;
  logger: Logger;
  attempts?: number;
  baseDelayMs?: number;
  /** Per-attempt deadline. See {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

/**
 * Per-attempt deadline, not a total budget.
 *
 * Without one, a provider call that never returns holds the HTTP request open
 * for as long as the socket lives — observed in practice as a 74-second chat
 * response whose generation only took 1.2s. Generous enough that a slow but
 * healthy generation completes, short enough that a stall becomes a retry
 * instead of a hang.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Distinguishable so {@link isRetryable} can classify it without matching on
 * message text.
 */
export class OperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded its ${timeoutMs}ms deadline`);
    this.name = 'OperationTimeoutError';
  }
}

/**
 * Runs one attempt under a deadline, cancelling two ways.
 *
 * The signal lets the SDK abort its own request; the race guarantees this
 * resolves even if the SDK ignores it. Both are needed — the signal alone
 * trusts the provider client to honour cancellation, and the race alone leaves
 * an orphaned request in flight.
 *
 * Note the provider still bills work already done: aborting is a client-side
 * operation and does not stop the model.
 */
async function runWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OperationTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runWithDeadline(operation, options.label, timeoutMs);
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === attempts) {
        break;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);

      options.logger.warn(
        `${options.label} attempt ${attempt} failed, retrying in ${delay}ms: ${describeError(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Full provider error to the logs, one clean sentence to the client. The raw
  // payload is a page of provider JSON — useful for debugging, hostile as UI
  // copy, and occasionally leaks internals (project ids, quota names).
  options.logger.error(
    `${options.label} failed permanently: ${describeError(lastError)}`,
  );

  throw new ServiceUnavailableException(
    publicMessage(options.label, lastError),
  );
}

function publicMessage(label: string, error: unknown): string {
  if (statusOf(error) === 429) {
    return `${label} is rate-limited by the AI provider right now. Try again in a minute — if it persists, the free-tier daily quota is spent and resets at midnight Pacific time.`;
  }

  if (error instanceof OperationTimeoutError) {
    return `${label} took too long to respond. Please try again.`;
  }

  return `${label} provider is temporarily unavailable. Please try again shortly.`;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: number })?.status;

  if (typeof status === 'number') {
    return status;
  }

  return /429|RESOURCE_EXHAUSTED|rate limit/i.test(describeError(error))
    ? 429
    : undefined;
}

/**
 * Only rate limits and transient server/network failures are worth retrying.
 * Retrying a 400 just burns quota to receive the same rejection again.
 *
 * A deadline breach counts: the provider is reachable but this particular
 * request stalled, and a fresh one usually does not.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof OperationTimeoutError) {
    return true;
  }

  const status = statusOf(error);

  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }

  return /timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    describeError(error),
  );
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
