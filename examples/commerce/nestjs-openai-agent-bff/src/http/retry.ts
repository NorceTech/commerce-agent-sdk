import pino from 'pino';

const logger = pino({ name: 'retry' });

/**
 * Options for the retryAsync function.
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (not including the initial attempt).
   * Default: 2
   */
  retries?: number;

  /**
   * Base delay in milliseconds for exponential backoff.
   * Actual delay = baseDelayMs * 2^attempt + jitter
   * Default: 500
   */
  baseDelayMs?: number;

  /**
   * Maximum random jitter in milliseconds to add to the delay.
   * Helps prevent thundering herd problems.
   * Default: 200
   */
  jitter?: number;

  /**
   * Function to determine if an error should trigger a retry.
   * Return true to retry, false to fail immediately.
   * Default: () => true (retry all errors)
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;

  /**
   * Label for logging purposes.
   */
  label?: string;
}

/**
 * Default retry options.
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'label'>> = {
  retries: 2,
  baseDelayMs: 500,
  jitter: 200,
};

/**
 * Calculates the delay for a given retry attempt using exponential backoff with jitter.
 * 
 * @param attempt - The current retry attempt (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param jitter - Maximum jitter in milliseconds
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, baseDelayMs: number, jitter: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const randomJitter = Math.random() * jitter;
  return exponentialDelay + randomJitter;
}

/**
 * Wraps an async function with retry logic using exponential backoff.
 * 
 * @param fn - Async function to execute with retries
 * @param options - Retry configuration options
 * @returns Promise that resolves with the function result or rejects after all retries exhausted
 * 
 * @example
 * ```ts
 * const result = await retryAsync(
 *   () => fetchData(),
 *   {
 *     retries: 2,
 *     baseDelayMs: 500,
 *     jitter: 200,
 *     shouldRetry: (err) => isTransientError(err),
 *     label: 'MCP call'
 *   }
 * );
 * ```
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = DEFAULT_OPTIONS.retries,
    baseDelayMs = DEFAULT_OPTIONS.baseDelayMs,
    jitter = DEFAULT_OPTIONS.jitter,
    shouldRetry = () => true,
    label = 'operation',
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we've exhausted retries
      if (attempt >= retries) {
        logger.warn(
          { label, attempt, totalAttempts: retries + 1, error: error instanceof Error ? error.message : String(error) },
          'All retry attempts exhausted'
        );
        throw error;
      }

      // Check if this error is retryable
      if (!shouldRetry(error, attempt)) {
        logger.debug(
          { label, attempt, error: error instanceof Error ? error.message : String(error) },
          'Error is not retryable, failing immediately'
        );
        throw error;
      }

      // Calculate delay and wait before retrying
      const delay = calculateDelay(attempt, baseDelayMs, jitter);
      logger.debug(
        { label, attempt, nextAttempt: attempt + 1, delayMs: Math.round(delay), error: error instanceof Error ? error.message : String(error) },
        'Retrying after transient error'
      );

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
