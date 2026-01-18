import { describe, it, expect, vi } from 'vitest';
import { AppError } from '../errors/index.js';

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
    debug: false,
    limits: {
      bodyLimitBytes: 131072,
      maxMessageChars: 4000,
      maxMessageTokensEst: 1200,
    },
  },
}));

import { estimateTokens, enforceMessageLimits } from '../validation/messageLimits.js';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should return 0 for null/undefined input', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('should return 1 for 4 characters or fewer', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('should return 2 for 5 characters (ceiling)', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('should return correct ceiling for various lengths', () => {
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('123456789')).toBe(3);
    expect(estimateTokens('1234567890')).toBe(3);
    expect(estimateTokens('12345678901')).toBe(3);
    expect(estimateTokens('123456789012')).toBe(3);
    expect(estimateTokens('1234567890123')).toBe(4);
  });

  it('should handle longer text correctly', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it('should handle text with 4000 characters', () => {
    const text = 'a'.repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });
});

describe('enforceMessageLimits', () => {
  const defaultLimits = {
    maxChars: 4000,
    maxTokensEst: 1200,
  };

  it('should not throw for message within limits', () => {
    expect(() => enforceMessageLimits('Hello world', defaultLimits)).not.toThrow();
  });

  it('should not throw for message at exact char limit', () => {
    const message = 'a'.repeat(4000);
    expect(() => enforceMessageLimits(message, defaultLimits)).not.toThrow();
  });

  it('should throw AppError with 413 status when message exceeds char limit', () => {
    const message = 'a'.repeat(4001);
    
    try {
      enforceMessageLimits(message, defaultLimits);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.httpStatus).toBe(413);
      expect(appError.category).toBe('VALIDATION');
      expect(appError.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(appError.safeMessage).toBe('Message too long');
      expect(appError.details).toEqual({
        maxChars: 4000,
        maxTokensEst: 1200,
        actualChars: 4001,
      });
    }
  });

  it('should throw AppError with 413 status when estimated tokens exceed limit', () => {
    // 4800 chars = 1200 tokens, so 4801 chars = 1201 tokens (exceeds limit)
    const message = 'a'.repeat(4801);
    const limits = {
      maxChars: 5000, // Higher char limit to test token limit
      maxTokensEst: 1200,
    };
    
    try {
      enforceMessageLimits(message, limits);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.httpStatus).toBe(413);
      expect(appError.category).toBe('VALIDATION');
      expect(appError.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(appError.safeMessage).toBe('Message too long (estimated tokens exceeded)');
      expect(appError.details).toEqual({
        maxChars: 5000,
        maxTokensEst: 1200,
        actualTokensEst: 1201,
      });
    }
  });

  it('should check char limit before token limit', () => {
    // Message that exceeds both limits - should fail on char limit first
    const message = 'a'.repeat(5001);
    const limits = {
      maxChars: 5000,
      maxTokensEst: 1200,
    };
    
    try {
      enforceMessageLimits(message, limits);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.safeMessage).toBe('Message too long');
      expect(appError.details?.actualChars).toBe(5001);
    }
  });

  it('should work with small limits for testing', () => {
    const limits = {
      maxChars: 10,
      maxTokensEst: 3,
    };
    
    // 11 chars exceeds char limit
    try {
      enforceMessageLimits('12345678901', limits);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.httpStatus).toBe(413);
    }
  });

  it('should pass for message at exact token limit', () => {
    // 4800 chars = 1200 tokens exactly, need higher char limit to test token boundary
    const message = 'a'.repeat(4800);
    const limits = {
      maxChars: 5000, // Higher char limit to test token limit
      maxTokensEst: 1200,
    };
    expect(() => enforceMessageLimits(message, limits)).not.toThrow();
  });
});
