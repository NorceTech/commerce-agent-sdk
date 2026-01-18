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

import { isMcpRetryable, isOpenAiRetryable } from '../http/retryPolicy.js';
import { AppError } from '../errors/AppError.js';

describe('isMcpRetryable', () => {
  describe('retryable errors', () => {
    it('should return true for MCP_TRANSPORT network errors', () => {
      const error = AppError.mcpTransport('Network error', {});
      expect(isMcpRetryable(error)).toBe(true);
    });

    it('should return true for MCP_TRANSPORT HTTP 502 errors', () => {
      const error = AppError.mcpTransportHttp(502, 'Bad Gateway');
      expect(isMcpRetryable(error)).toBe(true);
    });

    it('should return true for MCP_TRANSPORT HTTP 503 errors', () => {
      const error = AppError.mcpTransportHttp(503, 'Service Unavailable');
      expect(isMcpRetryable(error)).toBe(true);
    });

    it('should return true for MCP_TRANSPORT HTTP 504 errors', () => {
      const error = AppError.mcpTransportHttp(504, 'Gateway Timeout');
      expect(isMcpRetryable(error)).toBe(true);
    });

    it('should return true for TIMEOUT errors', () => {
      const error = AppError.timeout('MCP call', 10000);
      expect(isMcpRetryable(error)).toBe(true);
    });
  });

  describe('non-retryable errors', () => {
    it('should return false for VALIDATION errors', () => {
      const error = AppError.validation('Invalid request');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for VALIDATION_TOOL_ARGS errors', () => {
      const error = AppError.validationToolArgs('product_search', 'Invalid JSON');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for MCP_TOOL errors', () => {
      const error = AppError.mcpTool('product.search', -32000, 'Tool execution failed');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for MCP_PROTOCOL errors', () => {
      const error = AppError.mcpProtocol('Invalid response');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for MCP_PROTOCOL_INIT errors', () => {
      const error = AppError.mcpProtocolInit('Init failed');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for OAUTH errors', () => {
      const error = AppError.oauthTokenFetch('Token fetch failed');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for MCP_TRANSPORT HTTP 400 errors', () => {
      const error = AppError.mcpTransportHttp(400, 'Bad Request');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for MCP_TRANSPORT HTTP 401 errors', () => {
      const error = AppError.mcpTransportHttp(401, 'Unauthorized');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for MCP_TRANSPORT HTTP 404 errors', () => {
      const error = AppError.mcpTransportHttp(404, 'Not Found');
      expect(isMcpRetryable(error)).toBe(false);
    });

    it('should return false for INTERNAL errors', () => {
      const error = AppError.internal('Unexpected error');
      expect(isMcpRetryable(error)).toBe(false);
    });
  });

  describe('raw error mapping', () => {
    it('should map raw network error and return true', () => {
      const error = new Error('fetch failed');
      error.name = 'TypeError';
      expect(isMcpRetryable(error)).toBe(true);
    });

    it('should map raw validation error and return false', () => {
      const error = new Error('Invalid request body');
      error.name = 'BadRequestError';
      (error as Error & { status: number }).status = 400;
      expect(isMcpRetryable(error)).toBe(false);
    });
  });
});

describe('isOpenAiRetryable', () => {
  describe('retryable errors', () => {
    it('should return true for OPENAI_RATE_LIMIT errors', () => {
      const error = AppError.openaiRateLimit();
      expect(isOpenAiRetryable(error)).toBe(true);
    });

    it('should return true for TIMEOUT errors', () => {
      const error = AppError.timeout('OpenAI call', 20000);
      expect(isOpenAiRetryable(error)).toBe(true);
    });

    it('should return true for OPENAI errors with 5xx status', () => {
      const error = AppError.openai('Server error', { status: 500 });
      expect(isOpenAiRetryable(error)).toBe(true);
    });

    it('should return true for OPENAI errors with 503 status', () => {
      const error = AppError.openai('Service unavailable', { status: 503 });
      expect(isOpenAiRetryable(error)).toBe(true);
    });
  });

  describe('non-retryable errors', () => {
    it('should return false for VALIDATION errors', () => {
      const error = AppError.validation('Invalid request');
      expect(isOpenAiRetryable(error)).toBe(false);
    });

    it('should return false for OPENAI_TOOL_SCHEMA errors', () => {
      const error = AppError.openaiToolSchema('Invalid tool schema');
      expect(isOpenAiRetryable(error)).toBe(false);
    });

    it('should return false for OPENAI errors without 5xx status', () => {
      const error = AppError.openai('Bad request', { status: 400 });
      expect(isOpenAiRetryable(error)).toBe(false);
    });

    it('should return false for OAUTH errors', () => {
      const error = AppError.oauthTokenInvalid('Invalid token');
      expect(isOpenAiRetryable(error)).toBe(false);
    });

    it('should return false for INTERNAL errors', () => {
      const error = AppError.internal('Unexpected error');
      expect(isOpenAiRetryable(error)).toBe(false);
    });
  });

  describe('raw error mapping', () => {
    it('should map raw RateLimitError and return true', () => {
      const error = new Error('Rate limit exceeded');
      error.name = 'RateLimitError';
      (error as Error & { status: number }).status = 429;
      expect(isOpenAiRetryable(error)).toBe(true);
    });

    it('should map raw APITimeoutError and return true', () => {
      const error = new Error('Request timed out');
      error.name = 'APITimeoutError';
      expect(isOpenAiRetryable(error)).toBe(true);
    });

    it('should map raw BadRequestError and return false', () => {
      const error = new Error('Invalid request');
      error.name = 'BadRequestError';
      (error as Error & { status: number }).status = 400;
      expect(isOpenAiRetryable(error)).toBe(false);
    });
  });
});
