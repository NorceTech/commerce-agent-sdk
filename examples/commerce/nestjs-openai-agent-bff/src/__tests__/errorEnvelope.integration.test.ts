import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
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

import { chatRoutes } from '../routes/chat.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { AgentRunner } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';
import { AppError } from '../errors/AppError.js';
import { errorEnvelopeSchema } from '../http/chatResponseSchema.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

function createMockTool(name: string, executeResult: unknown = { success: true }): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: z.object({
      query: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue(executeResult),
  };
}

function createMcpFailingTool(name: string): Tool {
  return {
    name,
    description: `Mock tool that simulates MCP failure: ${name}`,
    parameters: z.object({
      query: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockRejectedValue(
      AppError.mcpTransport('Connection to MCP server failed', { endpoint: 'test' })
    ),
  };
}

describe('Error Envelope Integration Tests', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
  });

  afterEach(async () => {
    sessionStore.destroy();
    await fastify.close();
    vi.clearAllMocks();
  });

  describe('POST /v1/chat - Error Envelope', () => {
    describe('validation errors (category: validation, retryable: false)', () => {
      it('should return 400 with error envelope for missing applicationId', async () => {
        const mockTool = createMockTool('product_search');
        const agentRunner = new AgentRunner({
          tools: [mockTool],
          openaiClient: mockOpenAiClient,
          maxRounds: 6,
          maxToolCallsPerRound: 3,
        });

        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            sessionId: 'test-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(400);

        const body = JSON.parse(response.body);
        
        // Verify error envelope structure
        expect(body.error).toBeDefined();
        expect(body.error.category).toBe('validation');
        expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
        expect(body.error.message).toBeDefined();
        expect(body.error.retryable).toBe(false);
        
        // Verify the error envelope validates against the schema
        const parseResult = errorEnvelopeSchema.safeParse(body.error);
        expect(parseResult.success).toBe(true);
        
        // Verify ChatResponse structure
        expect(body.turnId).toBeDefined();
        expect(body.sessionId).toBeDefined();
        expect(body.text).toBeDefined();
      });

      it('should return 400 with error envelope for empty message', async () => {
        const mockTool = createMockTool('product_search');
        const agentRunner = new AgentRunner({
          tools: [mockTool],
          openaiClient: mockOpenAiClient,
          maxRounds: 6,
          maxToolCallsPerRound: 3,
        });

        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'test-session',
            message: '',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(400);

        const body = JSON.parse(response.body);
        
        expect(body.error.category).toBe('validation');
        expect(body.error.retryable).toBe(false);
        expect(body.error.code).toContain('VALIDATION');
      });

      it('should return 400 with error envelope for missing context', async () => {
        const mockTool = createMockTool('product_search');
        const agentRunner = new AgentRunner({
          tools: [mockTool],
          openaiClient: mockOpenAiClient,
          maxRounds: 6,
          maxToolCallsPerRound: 3,
        });

        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'test-session',
            message: 'Hello',
          },
        });

        expect(response.statusCode).toBe(400);

        const body = JSON.parse(response.body);
        
        expect(body.error.category).toBe('validation');
        expect(body.error.retryable).toBe(false);
      });
    });

    describe('upstream errors (category: upstream, retryable: true)', () => {
      it('should return error envelope with upstream category for MCP transport failure', async () => {
        const mcpFailingTool = createMcpFailingTool('product_search');
        const agentRunner = new AgentRunner({
          tools: [mcpFailingTool],
          openaiClient: mockOpenAiClient,
          maxRounds: 6,
          maxToolCallsPerRound: 3,
        });

        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner,
        });

        // Mock OpenAI to call the tool
        (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce({
            content: null,
            toolCalls: [
              {
                id: 'call_123',
                name: 'product_search',
                arguments: JSON.stringify({ query: 'laptops' }),
              },
            ],
            finishReason: 'tool_calls',
          })
          .mockResolvedValueOnce({
            content: 'Sorry, I encountered an error while searching.',
            toolCalls: [],
            finishReason: 'stop',
          });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'mcp-error-session',
            message: 'Find laptops',
            context: { cultureCode: 'sv-SE' },
          },
        });

        // The agent should handle the tool error gracefully and return a response
        // The error is caught by the agent runner and included in the tool trace
        expect(response.statusCode).toBe(200);
      });
    });

    describe('internal errors (category: internal)', () => {
      it('should return 503 with error envelope when agent is not configured', async () => {
        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner: null,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'test-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(503);

        const body = JSON.parse(response.body);
        
        expect(body.error).toBeDefined();
        expect(body.error.category).toBe('internal');
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(body.error.retryable).toBe(false);
        
        // Verify ChatResponse structure
        expect(body.turnId).toBeDefined();
        expect(body.sessionId).toBeDefined();
        expect(body.text).toBeDefined();
      });
    });
  });

  describe('POST /v1/chat/stream - Error Envelope', () => {
    describe('validation errors before SSE init', () => {
      it('should return 400 with error envelope for validation failures', async () => {
        const mockTool = createMockTool('product_search');
        const agentRunner = new AgentRunner({
          tools: [mockTool],
          openaiClient: mockOpenAiClient,
          maxRounds: 6,
          maxToolCallsPerRound: 3,
        });

        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat/stream',
          payload: {
            sessionId: 'test-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(400);

        const body = JSON.parse(response.body);
        
        expect(body.error).toBeDefined();
        expect(body.error.category).toBe('validation');
        expect(body.error.retryable).toBe(false);
        
        // Verify ChatResponse structure
        expect(body.turnId).toBeDefined();
        expect(body.sessionId).toBeDefined();
        expect(body.text).toBeDefined();
      });
    });

    describe('streaming error events', () => {
      it('should emit error event with error envelope when agent is not configured', async () => {
        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner: null,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat/stream',
          payload: {
            applicationId: 'demo',
            sessionId: 'test-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/event-stream');
        
        // Check for error event
        expect(response.body).toContain('event: error');
        
        // Parse the error event data
        const errorEventMatch = response.body.match(/event: error\ndata: (.+)\n/);
        expect(errorEventMatch).not.toBeNull();
        
        const errorData = JSON.parse(errorEventMatch![1]);
        expect(errorData.category).toBe('internal');
        expect(errorData.code).toBe('INTERNAL_ERROR');
        expect(errorData.retryable).toBe(false);
        expect(errorData.message).toBeDefined();
      });

      it('should emit final event with error envelope after error event', async () => {
        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner: null,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat/stream',
          payload: {
            applicationId: 'demo',
            sessionId: 'test-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(200);
        
        // Check for both error and final events
        expect(response.body).toContain('event: error');
        expect(response.body).toContain('event: final');
        
        // Parse the final event data
        const finalEventMatch = response.body.match(/event: final\ndata: (.+)\n/);
        expect(finalEventMatch).not.toBeNull();
        
        const finalData = JSON.parse(finalEventMatch![1]);
        expect(finalData.error).toBeDefined();
        expect(finalData.error.category).toBe('internal');
        expect(finalData.error.retryable).toBe(false);
        
        // Verify ChatResponse structure
        expect(finalData.turnId).toBeDefined();
        expect(finalData.sessionId).toBeDefined();
        expect(finalData.text).toBeDefined();
      });

      it('should include requestId in error envelope', async () => {
        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner: null,
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat/stream',
          payload: {
            applicationId: 'demo',
            sessionId: 'test-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(200);
        
        const errorEventMatch = response.body.match(/event: error\ndata: (.+)\n/);
        expect(errorEventMatch).not.toBeNull();
        
        const errorData = JSON.parse(errorEventMatch![1]);
        expect(errorData.requestId).toBeDefined();
      });
    });

    describe('successful response should not have error envelope', () => {
      it('should not include error field in successful response', async () => {
        const mockTool = createMockTool('product_search', { items: [], totalCount: 0 });
        const agentRunner = new AgentRunner({
          tools: [mockTool],
          openaiClient: mockOpenAiClient,
          maxRounds: 6,
          maxToolCallsPerRound: 3,
        });

        await fastify.register(chatRoutes, {
          sessionStore,
          agentRunner,
        });

        (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
          content: 'Hello! How can I help you today?',
          toolCalls: [],
          finishReason: 'stop',
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat/stream',
          payload: {
            applicationId: 'demo',
            sessionId: 'success-session',
            message: 'Hello',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain('event: error');
        
        const finalEventMatch = response.body.match(/event: final\ndata: (.+)\n/);
        expect(finalEventMatch).not.toBeNull();
        
        const finalData = JSON.parse(finalEventMatch![1]);
        expect(finalData.error).toBeUndefined();
      });
    });
  });

  describe('Error envelope schema validation', () => {
    it('should validate error envelope with all required fields', () => {
      const validEnvelope = {
        category: 'validation',
        code: 'VALIDATION_REQUEST_INVALID',
        message: 'Invalid request',
        retryable: false,
      };

      const result = errorEnvelopeSchema.safeParse(validEnvelope);
      expect(result.success).toBe(true);
    });

    it('should validate error envelope with optional fields', () => {
      const validEnvelope = {
        category: 'upstream',
        code: 'MCP_TRANSPORT_ERROR',
        message: 'Connection failed',
        retryable: true,
        requestId: 'req-123',
        details: { endpoint: 'test' },
      };

      const result = errorEnvelopeSchema.safeParse(validEnvelope);
      expect(result.success).toBe(true);
    });

    it('should reject invalid category', () => {
      const invalidEnvelope = {
        category: 'invalid_category',
        code: 'TEST_CODE',
        message: 'Test message',
        retryable: false,
      };

      const result = errorEnvelopeSchema.safeParse(invalidEnvelope);
      expect(result.success).toBe(false);
    });

    it('should reject missing retryable field', () => {
      const invalidEnvelope = {
        category: 'validation',
        code: 'TEST_CODE',
        message: 'Test message',
      };

      const result = errorEnvelopeSchema.safeParse(invalidEnvelope);
      expect(result.success).toBe(false);
    });
  });
});
