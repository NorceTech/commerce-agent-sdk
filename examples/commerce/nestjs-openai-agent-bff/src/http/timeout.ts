import { AppError } from '../errors/AppError.js';

/**
 * Wraps an async function with a timeout using AbortController.
 * 
 * The function receives an AbortSignal that should be passed to fetch-based calls
 * to enable proper request cancellation when the timeout fires.
 * 
 * @param fn - Async function that receives an AbortSignal and returns a Promise
 * @param ms - Timeout in milliseconds
 * @param label - Label for the operation (used in error messages)
 * @returns Promise that resolves with the function result or rejects with AppError on timeout
 * @throws AppError with category TIMEOUT if the operation times out
 * 
 * @example
 * ```ts
 * const result = await withTimeout(
 *   (signal) => fetch(url, { signal }),
 *   5000,
 *   'OAuth token fetch'
 * );
 * ```
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, ms);

  try {
    const result = await fn(signal);
    return result;
  } catch (error) {
    // Check if this was an abort due to our timeout
    if (signal.aborted) {
      throw AppError.timeout(label, ms, error instanceof Error ? error : undefined);
    }
    // Re-throw other errors as-is
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Type guard to check if an error is an AbortError.
 * Useful for distinguishing timeout aborts from other errors.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      (error as Error & { code?: string }).code === 'ABORT_ERR' ||
      (error as Error & { code?: string }).code === 'ERR_ABORTED'
    );
  }
  return false;
}
