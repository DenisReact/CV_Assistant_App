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
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
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
 */
function isRetryable(error: unknown): boolean {
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
