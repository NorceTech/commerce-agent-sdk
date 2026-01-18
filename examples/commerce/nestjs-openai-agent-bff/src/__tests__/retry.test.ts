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

import { retryAsync } from '../http/retry.js';

describe('retryAsync', () => {
  it('should return result on first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    
    const result = await retryAsync(fn, { retries: 2, baseDelayMs: 0, jitter: 0 });
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient error and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValueOnce('success after retry');
    
    const result = await retryAsync(fn, {
      retries: 2,
      baseDelayMs: 0,
      jitter: 0,
      shouldRetry: () => true,
    });
    
    expect(result).toBe('success after retry');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should exhaust all retries and throw last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent error'));
    
    await expect(
      retryAsync(fn, {
        retries: 2,
        baseDelayMs: 0,
        jitter: 0,
        shouldRetry: () => true,
      })
    ).rejects.toThrow('persistent error');
    
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable error'));
    
    await expect(
      retryAsync(fn, {
        retries: 2,
        baseDelayMs: 0,
        jitter: 0,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('non-retryable error');
    
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it('should pass attempt number to shouldRetry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('error'));
    const shouldRetry = vi.fn().mockReturnValue(true);
    
    try {
      await retryAsync(fn, {
        retries: 2,
        baseDelayMs: 0,
        jitter: 0,
        shouldRetry,
      });
    } catch {
      // Expected
    }
    
    // shouldRetry is called for attempts 0 and 1 (not for the last attempt)
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 0);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('should use default options when not provided', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    
    const result = await retryAsync(fn);
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should succeed on second retry after two failures', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('error 1'))
      .mockRejectedValueOnce(new Error('error 2'))
      .mockResolvedValueOnce('finally success');
    
    const result = await retryAsync(fn, {
      retries: 2,
      baseDelayMs: 0,
      jitter: 0,
      shouldRetry: () => true,
    });
    
    expect(result).toBe('finally success');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
