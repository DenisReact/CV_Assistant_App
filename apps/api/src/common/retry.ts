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

  throw new ServiceUnavailableException(
    `${options.label} provider unavailable: ${describeError(lastError)}`,
  );
}

/**
 * Only rate limits and transient server/network failures are worth retrying.
 * Retrying a 400 just burns quota to receive the same rejection again.
 */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;

  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }

  return /429|rate limit|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    describeError(error),
  );
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
