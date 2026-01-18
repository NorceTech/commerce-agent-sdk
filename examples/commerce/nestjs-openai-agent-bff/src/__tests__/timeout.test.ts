import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    port: 3000,
    openai: {
      apiKey: 'test-api-key',
      model: 'gpt-4o-mini',
    },
    norce: {
      mcp: {
        baseUrl: 'https://test.api.norce.tech/mcp/commerce',
        defaultApplicationId: 'test-app-id',
        allowedApplicationIds: [],
      },
      oauth: {
        tokenUrl: 'https://test.auth.norce.tech/token',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
      },
    },
    session: {
      ttlSeconds: 1800,
    },
    agent: {
      maxRounds: 6,
      maxToolCallsPerRound: 3,
    },
    timeouts: {
      oauthMs: 5000,
      mcpCallMs: 10000,
      openaiMs: 20000,
    },
    retry: {
      maxAttempts: 2,
      baseDelayMs: 500,
      jitterMs: 200,
    },
    debug: false,
    limits: {
      bodyLimitBytes: 131072,
      maxMessageChars: 4000,
      maxMessageTokensEst: 1200,
    },
  },
}));

import { withTimeout, isAbortError } from '../http/timeout.js';
import { AppError } from '../errors/AppError.js';

describe('withTimeout', () => {
  it('should resolve when function completes before timeout', async () => {
    const result = await withTimeout(
      async () => 'success',
      1000,
      'test operation'
    );
    expect(result).toBe('success');
  });

  it('should pass AbortSignal to the function', async () => {
    let receivedSignal: AbortSignal | undefined;
    
    await withTimeout(
      async (signal) => {
        receivedSignal = signal;
        return 'done';
      },
      1000,
      'test operation'
    );
    
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('should throw AppError with TIMEOUT category when signal-aware function times out', async () => {
    const slowOperation = async (signal: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        const timeoutId = setTimeout(() => resolve('too late'), 200);
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    await expect(
      withTimeout(slowOperation, 50, 'slow operation')
    ).rejects.toMatchObject({
      category: 'TIMEOUT',
      code: 'TIMEOUT_REQUEST',
      httpStatus: 504,
    });
  });

  it('should include operation label and timeout in error details', async () => {
    const slowOperation = async (signal: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        const timeoutId = setTimeout(() => resolve('too late'), 200);
        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };

    try {
      await withTimeout(slowOperation, 50, 'my-operation');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.details?.operation).toBe('my-operation');
      expect(appError.details?.timeoutMs).toBe(50);
    }
  });

  it('should re-throw non-timeout errors as-is', async () => {
    const failingOperation = async () => {
      throw new Error('Custom error');
    };

    await expect(
      withTimeout(failingOperation, 1000, 'failing operation')
    ).rejects.toThrow('Custom error');
  });

  it('should clear timeout when function completes successfully', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    
    await withTimeout(
      async () => 'success',
      1000,
      'test operation'
    );
    
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should clear timeout when function throws', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    
    try {
      await withTimeout(
        async () => { throw new Error('fail'); },
        1000,
        'test operation'
      );
    } catch {
      // Expected
    }
    
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('isAbortError', () => {
  it('should return true for AbortError', () => {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('should return true for TimeoutError', () => {
    const error = new Error('Timeout');
    error.name = 'TimeoutError';
    expect(isAbortError(error)).toBe(true);
  });

  it('should return true for error with ABORT_ERR code', () => {
    const error = new Error('Aborted') as Error & { code: string };
    error.code = 'ABORT_ERR';
    expect(isAbortError(error)).toBe(true);
  });

  it('should return true for error with ERR_ABORTED code', () => {
    const error = new Error('Aborted') as Error & { code: string };
    error.code = 'ERR_ABORTED';
    expect(isAbortError(error)).toBe(true);
  });

  it('should return false for regular errors', () => {
    const error = new Error('Regular error');
    expect(isAbortError(error)).toBe(false);
  });

  it('should return false for non-Error objects', () => {
    expect(isAbortError('string error')).toBe(false);
    expect(isAbortError({ message: 'object' })).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
