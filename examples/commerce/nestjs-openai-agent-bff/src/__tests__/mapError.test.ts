import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

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

import { AppError, mapError, sanitizeForLogging } from '../errors/index.js';
import { MalformedToolArgsError } from '../agent/agentRunner.js';

describe('mapError', () => {
  describe('AppError passthrough', () => {
    it('should return AppError as-is', () => {
      const original = AppError.validation('test error');
      const result = mapError(original);
      expect(result).toBe(original);
    });
  });

  describe('Zod validation errors', () => {
    it('should map ZodError to VALIDATION category', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      try {
        schema.parse({ name: 123, age: 'not a number' });
      } catch (error) {
        const result = mapError(error);
        expect(result.category).toBe('VALIDATION');
        expect(result.code).toBe('VALIDATION_REQUEST_INVALID');
        expect(result.httpStatus).toBe(400);
        expect(result.details?.issues).toBeDefined();
      }
    });

    it('should include path information in validation error message', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      });

      try {
        schema.parse({ user: { email: 'invalid' } });
      } catch (error) {
        const result = mapError(error);
        expect(result.safeMessage).toContain('user.email');
      }
    });
  });

  describe('MalformedToolArgsError', () => {
    it('should map MalformedToolArgsError to VALIDATION_TOOL_ARGS_INVALID', () => {
      const error = new MalformedToolArgsError(
        'product_search',
        '{ invalid json }',
        'Unexpected token'
      );

      const result = mapError(error);
      expect(result.category).toBe('VALIDATION');
      expect(result.code).toBe('VALIDATION_TOOL_ARGS_INVALID');
      expect(result.httpStatus).toBe(400);
      expect(result.details?.toolName).toBe('product_search');
      expect(result.details?.parseError).toBe('Unexpected token');
    });
  });

  describe('OpenAI errors', () => {
    it('should map RateLimitError to OPENAI_RATE_LIMIT', () => {
      const error = new Error('Rate limit exceeded');
      error.name = 'RateLimitError';
      (error as Error & { status: number }).status = 429;

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_RATE_LIMIT');
      expect(result.httpStatus).toBe(429);
    });

    it('should map APITimeoutError to OPENAI_TIMEOUT', () => {
      const error = new Error('Request timed out');
      error.name = 'APITimeoutError';

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_TIMEOUT');
      expect(result.httpStatus).toBe(504);
      expect(result.safeMessage).toBe('Model took too long to respond. Please retry.');
    });

    it('should map APIConnectionTimeoutError to OPENAI_TIMEOUT', () => {
      const error = new Error('Connection timed out');
      error.name = 'APIConnectionTimeoutError';

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_TIMEOUT');
      expect(result.httpStatus).toBe(504);
    });

    it('should map APIConnectionError with timeout message to OPENAI_TIMEOUT', () => {
      const error = new Error('Request timed out after 120000ms');
      error.name = 'APIConnectionError';

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_TIMEOUT');
      expect(result.httpStatus).toBe(504);
    });

    it('should map APIConnectionError without timeout message to OPENAI', () => {
      const error = new Error('Connection failed');
      error.name = 'APIConnectionError';

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_API_ERROR');
      expect(result.httpStatus).toBe(503);
    });

    it('should map BadRequestError with tool schema issue to OPENAI_TOOL_SCHEMA_ERROR', () => {
      const error = new Error('Invalid tool schema: missing required field');
      error.name = 'BadRequestError';
      (error as Error & { status: number }).status = 400;

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_TOOL_SCHEMA_ERROR');
      expect(result.httpStatus).toBe(500);
    });

    it('should map BadRequestError without tool issue to VALIDATION', () => {
      const error = new Error('Invalid request body');
      error.name = 'BadRequestError';
      (error as Error & { status: number }).status = 400;

      const result = mapError(error);
      expect(result.category).toBe('VALIDATION');
      expect(result.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(result.httpStatus).toBe(400);
    });

    it('should map AuthenticationError to OPENAI', () => {
      const error = new Error('Invalid API key');
      error.name = 'AuthenticationError';
      (error as Error & { status: number }).status = 401;

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_API_ERROR');
    });

    it('should map InternalServerError to OPENAI', () => {
      const error = new Error('Internal server error');
      error.name = 'InternalServerError';
      (error as Error & { status: number }).status = 500;

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_API_ERROR');
      expect(result.httpStatus).toBe(503);
    });

    it('should map generic APIError to OPENAI', () => {
      const error = new Error('API error');
      error.name = 'APIError';

      const result = mapError(error);
      expect(result.category).toBe('OPENAI');
      expect(result.code).toBe('OPENAI_API_ERROR');
    });
  });

  describe('Abort/timeout errors', () => {
    it('should map AbortError to TIMEOUT', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';

      const result = mapError(error);
      expect(result.category).toBe('TIMEOUT');
      expect(result.code).toBe('TIMEOUT_REQUEST');
      expect(result.httpStatus).toBe(504);
    });

    it('should map TimeoutError to TIMEOUT', () => {
      const error = new Error('Timeout');
      error.name = 'TimeoutError';

      const result = mapError(error);
      expect(result.category).toBe('TIMEOUT');
      expect(result.code).toBe('TIMEOUT_REQUEST');
    });

    it('should map error with ABORT_ERR code to TIMEOUT', () => {
      const error = new Error('Aborted');
      (error as Error & { code: string }).code = 'ABORT_ERR';

      const result = mapError(error);
      expect(result.category).toBe('TIMEOUT');
    });
  });

  describe('Network errors', () => {
    it('should map fetch failed error to MCP_TRANSPORT', () => {
      const error = new Error('fetch failed');
      error.name = 'TypeError';

      const result = mapError(error);
      expect(result.category).toBe('MCP_TRANSPORT');
      expect(result.code).toBe('MCP_TRANSPORT_NETWORK_ERROR');
      expect(result.httpStatus).toBe(503);
    });

    it('should map ECONNREFUSED to MCP_TRANSPORT', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');

      const result = mapError(error);
      expect(result.category).toBe('MCP_TRANSPORT');
    });

    it('should map ETIMEDOUT to MCP_TRANSPORT', () => {
      const error = new Error('connect ETIMEDOUT');

      const result = mapError(error);
      expect(result.category).toBe('MCP_TRANSPORT');
    });

    it('should map socket hang up to MCP_TRANSPORT', () => {
      const error = new Error('socket hang up');

      const result = mapError(error);
      expect(result.category).toBe('MCP_TRANSPORT');
    });
  });

  describe('OAuth errors', () => {
    it('should map OAuth token fetch error to OAUTH', () => {
      const error = new Error('Failed to fetch OAuth token: 500 Internal Server Error');

      const result = mapError(error);
      expect(result.category).toBe('OAUTH');
      expect(result.code).toBe('OAUTH_TOKEN_FETCH_FAILED');
      expect(result.httpStatus).toBe(503);
    });

    it('should map 401 unauthorized to OAUTH_TOKEN_INVALID', () => {
      const error = new Error('OAuth token request returned 401 unauthorized');

      const result = mapError(error);
      expect(result.category).toBe('OAUTH');
      expect(result.code).toBe('OAUTH_TOKEN_INVALID');
      expect(result.httpStatus).toBe(401);
    });

    it('should map authentication failure to OAUTH', () => {
      const error = new Error('Authentication failed for client credentials');

      const result = mapError(error);
      expect(result.category).toBe('OAUTH');
    });
  });

  describe('MCP errors', () => {
    describe('MCP transport errors', () => {
      it('should map MCP request failed with HTTP status to MCP_TRANSPORT_HTTP_ERROR', () => {
        const error = new Error(
          'MCP request failed: status=500, content-type=text/plain, body=Internal Server Error'
        );

        const result = mapError(error);
        expect(result.category).toBe('MCP_TRANSPORT');
        expect(result.code).toBe('MCP_TRANSPORT_HTTP_ERROR');
        expect(result.details?.httpStatus).toBe(500);
      });

      it('should map MCP request failed with 401 status to OAUTH (authentication issue)', () => {
        const error = new Error(
          'MCP request failed: status=401, content-type=application/json, body={"error":"unauthorized"}'
        );

        const result = mapError(error);
        expect(result.category).toBe('OAUTH');
        expect(result.code).toBe('OAUTH_TOKEN_INVALID');
        expect(result.httpStatus).toBe(401);
      });

      it('should map MCP request failed with 4xx status (non-401) to MCP_TRANSPORT_HTTP_ERROR', () => {
        const error = new Error(
          'MCP request failed: status=400, content-type=application/json, body={"error":"bad request"}'
        );

        const result = mapError(error);
        expect(result.category).toBe('MCP_TRANSPORT');
        expect(result.code).toBe('MCP_TRANSPORT_HTTP_ERROR');
        expect(result.httpStatus).toBe(502);
      });

      it('should map Failed to parse MCP response to MCP_PROTOCOL', () => {
        const error = new Error(
          'Failed to parse MCP response: status=200, content-type=text/html, method=tools/call, id=1, body=<html>...'
        );

        const result = mapError(error);
        expect(result.category).toBe('MCP_PROTOCOL');
        expect(result.code).toBe('MCP_PROTOCOL_INVALID_RESPONSE');
      });
    });

    describe('MCP protocol errors', () => {
      it('should map MCP initialize failed to MCP_PROTOCOL_INIT_FAILED', () => {
        const error = new Error('MCP initialize failed: Invalid Request (code: -32600)');

        const result = mapError(error);
        expect(result.category).toBe('MCP_PROTOCOL');
        expect(result.code).toBe('MCP_PROTOCOL_INIT_FAILED');
        expect(result.httpStatus).toBe(503);
      });
    });

    describe('MCP tool errors', () => {
      it('should map MCP tool call failed to MCP_TOOL', () => {
        const error = new Error('MCP tool call failed: Method not found (code: -32601)');

        const result = mapError(error);
        expect(result.category).toBe('MCP_TOOL');
        expect(result.code).toBe('MCP_TOOL_EXECUTION_FAILED');
        expect(result.httpStatus).toBe(502);
      });

      it('should extract error code from MCP tool error', () => {
        const error = new Error('MCP tool call failed: Product not found (code: -32000)');

        const result = mapError(error);
        expect(result.details?.errorCode).toBe(-32000);
      });
    });
  });

  describe('Generic errors', () => {
    it('should map unknown Error to INTERNAL', () => {
      const error = new Error('Something went wrong');

      const result = mapError(error);
      expect(result.category).toBe('INTERNAL');
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.httpStatus).toBe(500);
    });

    it('should map string to INTERNAL', () => {
      const result = mapError('string error');
      expect(result.category).toBe('INTERNAL');
      expect(result.safeMessage).toBe('An unexpected error occurred. Please try again later.');
    });

    it('should map non-Error object to INTERNAL', () => {
      const result = mapError({ message: 'object error' });
      expect(result.category).toBe('INTERNAL');
    });

    it('should map null to INTERNAL', () => {
      const result = mapError(null);
      expect(result.category).toBe('INTERNAL');
    });

    it('should map undefined to INTERNAL', () => {
      const result = mapError(undefined);
      expect(result.category).toBe('INTERNAL');
    });
  });
});

describe('sanitizeForLogging', () => {
  it('should return undefined for undefined input', () => {
    expect(sanitizeForLogging(undefined)).toBeUndefined();
  });

  it('should redact token fields', () => {
    const details = {
      accessToken: 'secret-token-123',
      refreshToken: 'refresh-secret',
      data: 'safe-data',
    };

    const result = sanitizeForLogging(details);
    expect(result?.accessToken).toBe('[REDACTED]');
    expect(result?.refreshToken).toBe('[REDACTED]');
    expect(result?.data).toBe('safe-data');
  });

  it('should redact secret fields', () => {
    const details = {
      clientSecret: 'my-secret',
      apiSecret: 'api-secret',
    };

    const result = sanitizeForLogging(details);
    expect(result?.clientSecret).toBe('[REDACTED]');
    expect(result?.apiSecret).toBe('[REDACTED]');
  });

  it('should redact password fields', () => {
    const details = {
      password: 'my-password',
      userPassword: 'user-pass',
    };

    const result = sanitizeForLogging(details);
    expect(result?.password).toBe('[REDACTED]');
    expect(result?.userPassword).toBe('[REDACTED]');
  });

  it('should redact apikey fields', () => {
    const details = {
      apiKey: 'key-123',
      api_key: 'key-456',
    };

    const result = sanitizeForLogging(details);
    expect(result?.apiKey).toBe('[REDACTED]');
    expect(result?.api_key).toBe('[REDACTED]');
  });

  it('should redact authorization fields', () => {
    const details = {
      authorization: 'Bearer token',
      Authorization: 'Bearer token2',
    };

    const result = sanitizeForLogging(details);
    expect(result?.authorization).toBe('[REDACTED]');
    expect(result?.Authorization).toBe('[REDACTED]');
  });

  it('should truncate long strings', () => {
    const longString = 'a'.repeat(600);
    const details = {
      body: longString,
    };

    const result = sanitizeForLogging(details);
    expect(result?.body).toContain('...[truncated]');
    expect((result?.body as string).length).toBeLessThan(600);
  });

  it('should recursively sanitize nested objects', () => {
    const details = {
      outer: {
        inner: {
          apiKey: 'nested-secret',
          data: 'safe',
        },
      },
    };

    const result = sanitizeForLogging(details);
    const outer = result?.outer as Record<string, unknown>;
    const inner = outer?.inner as Record<string, unknown>;
    expect(inner?.apiKey).toBe('[REDACTED]');
    expect(inner?.data).toBe('safe');
  });

  it('should preserve non-sensitive data', () => {
    const details = {
      status: 200,
      method: 'POST',
      path: '/api/test',
      count: 42,
    };

    const result = sanitizeForLogging(details);
    expect(result).toEqual(details);
  });
});

describe('AppError', () => {
  describe('toPayload', () => {
    it('should create error payload with category, code, and message', () => {
      const error = AppError.validation('Invalid input');
      const payload = error.toPayload();

      expect(payload.error.category).toBe('VALIDATION');
      expect(payload.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(payload.error.message).toBe('Invalid input');
    });

    it('should include requestId when provided', () => {
      const error = AppError.internal('Error');
      const payload = error.toPayload('req-123');

      expect(payload.requestId).toBe('req-123');
    });

    it('should include details when present', () => {
      const error = AppError.validation('Error', { field: 'name' });
      const payload = error.toPayload();

      expect(payload.error.details).toEqual({ field: 'name' });
    });

    it('should not include details key when details object is empty', () => {
      const error = new AppError({
        category: 'INTERNAL',
        code: 'INTERNAL_ERROR',
        httpStatus: 500,
        safeMessage: 'Error',
      });
      const payload = error.toPayload();

      expect(payload.error.details).toBeUndefined();
    });
  });

  describe('static helpers', () => {
    it('validation should create 400 error', () => {
      const error = AppError.validation('Bad request');
      expect(error.httpStatus).toBe(400);
      expect(error.category).toBe('VALIDATION');
    });

    it('validationToolArgs should create 400 error with tool details', () => {
      const error = AppError.validationToolArgs('product_search', 'Invalid JSON');
      expect(error.httpStatus).toBe(400);
      expect(error.details?.toolName).toBe('product_search');
    });

    it('oauthTokenFetch should create 503 error', () => {
      const error = AppError.oauthTokenFetch('Token fetch failed');
      expect(error.httpStatus).toBe(503);
      expect(error.category).toBe('OAUTH');
    });

    it('oauthTokenInvalid should create 401 error', () => {
      const error = AppError.oauthTokenInvalid('Invalid token');
      expect(error.httpStatus).toBe(401);
      expect(error.code).toBe('OAUTH_TOKEN_INVALID');
    });

    it('mcpTransport should create 503 error', () => {
      const error = AppError.mcpTransport('Network error');
      expect(error.httpStatus).toBe(503);
      expect(error.category).toBe('MCP_TRANSPORT');
    });

    it('mcpTransportHttp should create appropriate status', () => {
      const error500 = AppError.mcpTransportHttp(500, 'Server error');
      expect(error500.httpStatus).toBe(503);

      const error400 = AppError.mcpTransportHttp(400, 'Bad request');
      expect(error400.httpStatus).toBe(502);
    });

    it('mcpProtocol should create 502 error', () => {
      const error = AppError.mcpProtocol('Invalid response');
      expect(error.httpStatus).toBe(502);
      expect(error.category).toBe('MCP_PROTOCOL');
    });

    it('mcpProtocolInit should create 503 error', () => {
      const error = AppError.mcpProtocolInit('Init failed');
      expect(error.httpStatus).toBe(503);
      expect(error.code).toBe('MCP_PROTOCOL_INIT_FAILED');
    });

    it('mcpTool should create 502 error with tool details', () => {
      const error = AppError.mcpTool('product.search', -32000, 'Not found');
      expect(error.httpStatus).toBe(502);
      expect(error.details?.toolName).toBe('product.search');
      expect(error.details?.errorCode).toBe(-32000);
    });

    it('openai should create 503 error', () => {
      const error = AppError.openai('API error');
      expect(error.httpStatus).toBe(503);
      expect(error.category).toBe('OPENAI');
    });

    it('openaiRateLimit should create 429 error', () => {
      const error = AppError.openaiRateLimit();
      expect(error.httpStatus).toBe(429);
      expect(error.code).toBe('OPENAI_RATE_LIMIT');
    });

    it('openaiToolSchema should create 500 error', () => {
      const error = AppError.openaiToolSchema('Invalid schema');
      expect(error.httpStatus).toBe(500);
      expect(error.code).toBe('OPENAI_TOOL_SCHEMA_ERROR');
    });

    it('openaiTimeout should create 504 error with OPENAI category', () => {
      const error = AppError.openaiTimeout({ elapsedMs: 120000, timeoutMs: 120000 });
      expect(error.httpStatus).toBe(504);
      expect(error.category).toBe('OPENAI');
      expect(error.code).toBe('OPENAI_TIMEOUT');
      expect(error.safeMessage).toBe('Model took too long to respond. Please retry.');
      expect(error.details?.elapsedMs).toBe(120000);
      expect(error.details?.timeoutMs).toBe(120000);
    });

    it('openaiTimeout should work without details', () => {
      const error = AppError.openaiTimeout();
      expect(error.httpStatus).toBe(504);
      expect(error.category).toBe('OPENAI');
      expect(error.code).toBe('OPENAI_TIMEOUT');
    });

    it('timeout should create 504 error', () => {
      const error = AppError.timeout('request', 30000);
      expect(error.httpStatus).toBe(504);
      expect(error.category).toBe('TIMEOUT');
      expect(error.details?.timeoutMs).toBe(30000);
    });

    it('operationTimeout should create 504 error', () => {
      const error = AppError.operationTimeout('mcp_call');
      expect(error.httpStatus).toBe(504);
      expect(error.code).toBe('TIMEOUT_OPERATION');
    });

    it('internal should create 500 error', () => {
      const error = AppError.internal('Unexpected error');
      expect(error.httpStatus).toBe(500);
      expect(error.category).toBe('INTERNAL');
    });

    it('internalAgent should create 500 error', () => {
      const error = AppError.internalAgent('Agent error');
      expect(error.httpStatus).toBe(500);
      expect(error.code).toBe('INTERNAL_AGENT_ERROR');
    });

    it('serviceUnavailable should create 503 error', () => {
      const error = AppError.serviceUnavailable('agent', 'Agent not configured');
      expect(error.httpStatus).toBe(503);
      expect(error.details?.service).toBe('agent');
    });
  });
});
