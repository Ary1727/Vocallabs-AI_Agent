export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
}

/**
 * Runs fn up to maxAttempts times, returning the first success. Throws the
 * last error if every attempt fails. Attempt count is returned alongside
 * the result because step_runs.attempt_count needs the real number, not
 * just success/failure.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<RetryResult<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < options.maxAttempts) {
        await sleep(options.delayMs);
      }
    }
  }
  throw new RetryExhaustedError(options.maxAttempts, lastError);
}

export class RetryExhaustedError extends Error {
  attempts: number;
  cause: unknown;
  constructor(attempts: number, cause: unknown) {
    super(`Failed after ${attempts} attempt(s): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
