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

import { chatRoutes, ChatRouteOptions } from '../routes/chat.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { AgentRunner } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';
import { chatResponseSchema } from '../http/chatResponseSchema.js';

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

function parseSSEEvents(body: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const lines = body.split('\n');
  let currentEvent = '';
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7);
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentEvent && currentData) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(currentData) });
      } catch {
        events.push({ event: currentEvent, data: currentData });
      }
      currentEvent = '';
      currentData = '';
    }
  }

  return events;
}

describe('ChatResponse Contract Integration Tests', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockTool = createMockTool('product_search', { items: [], totalCount: 0 });

    agentRunner = new AgentRunner({
      tools: [mockTool],
      openaiClient: mockOpenAiClient,
      maxRounds: 6,
      maxToolCallsPerRound: 3,
    });

    await fastify.register(chatRoutes, {
      sessionStore,
      agentRunner,
    });
  });

  afterEach(async () => {
    sessionStore.destroy();
    await fastify.close();
    vi.clearAllMocks();
  });

  describe('Schema Validation', () => {
    it('should return response matching ChatResponse schema with turnId', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello! How can I help you today?',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'schema-test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      const validationResult = chatResponseSchema.safeParse(body);
      expect(validationResult.success).toBe(true);

      expect(body.turnId).toBeDefined();
      expect(typeof body.turnId).toBe('string');
      expect(body.turnId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      expect(body.sessionId).toBe('schema-test-session');
      expect(body.text).toBe('Hello! How can I help you today?');
    });

    it('should return response with optional fields matching schema when present', async () => {
      const searchResult = {
        items: [
          {
            productId: 'prod-123',
            name: 'Test Product',
            price: { amount: 99.99, currency: 'SEK', formatted: '99,99 kr' },
            imageUrl: '/images/test.jpg',
          },
        ],
        totalCount: 1,
      };

      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'test' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found a product for you!',
          toolCalls: [],
          finishReason: 'stop',
        });

      (mockTool.execute as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cards-test-session',
          message: 'Find test products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      const validationResult = chatResponseSchema.safeParse(body);
      expect(validationResult.success).toBe(true);

      expect(body.turnId).toBeDefined();
      if (body.cards) {
        expect(Array.isArray(body.cards)).toBe(true);
        for (const card of body.cards) {
          expect(card.productId).toBeDefined();
          expect(card.title).toBeDefined();
        }
      }
    });

    it('should include debug block only when debug=1 is set', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const responseWithDebug = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'debug-test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(responseWithDebug.statusCode).toBe(200);
      const bodyWithDebug = JSON.parse(responseWithDebug.body);
      expect(bodyWithDebug.debug).toBeDefined();

      const validationResult = chatResponseSchema.safeParse(bodyWithDebug);
      expect(validationResult.success).toBe(true);

      const responseWithoutDebug = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-debug-test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(responseWithoutDebug.statusCode).toBe(200);
      const bodyWithoutDebug = JSON.parse(responseWithoutDebug.body);
      expect(bodyWithoutDebug.debug).toBeUndefined();
    });
  });

  describe('Streaming Parity', () => {
    it('should emit final event with ChatResponse schema including turnId', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello from streaming!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');

      const events = parseSSEEvents(response.body);
      const finalEvent = events.find(e => e.event === 'final');

      expect(finalEvent).toBeDefined();
      expect(finalEvent!.data).toBeDefined();

      const finalData = finalEvent!.data as Record<string, unknown>;

      const validationResult = chatResponseSchema.safeParse(finalData);
      expect(validationResult.success).toBe(true);

      expect(finalData.turnId).toBeDefined();
      expect(typeof finalData.turnId).toBe('string');
      expect(finalData.turnId as string).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      expect(finalData.sessionId).toBe('stream-test-session');
      expect(finalData.text).toBe('Hello from streaming!');
    });

    it('should have streaming final event with same keys as non-streaming response', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Same response for both endpoints',
        toolCalls: [],
        finishReason: 'stop',
      });

      const nonStreamResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'parity-test-non-stream',
          message: 'Test parity',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(nonStreamResponse.statusCode).toBe(200);
      const nonStreamBody = JSON.parse(nonStreamResponse.body);

      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Same response for both endpoints',
        toolCalls: [],
        finishReason: 'stop',
      });

      const streamResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'parity-test-stream',
          message: 'Test parity',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(streamResponse.statusCode).toBe(200);
      const events = parseSSEEvents(streamResponse.body);
      const finalEvent = events.find(e => e.event === 'final');
      expect(finalEvent).toBeDefined();
      const streamBody = finalEvent!.data as Record<string, unknown>;

      const nonStreamKeys = Object.keys(nonStreamBody).sort();
      const streamKeys = Object.keys(streamBody).sort();

      expect(streamKeys).toEqual(nonStreamKeys);

      expect(streamBody.text).toBe(nonStreamBody.text);
      expect(typeof streamBody.turnId).toBe('string');
      expect(typeof nonStreamBody.turnId).toBe('string');
    });

    it('should have streaming final event with cards matching non-streaming response', async () => {
      const searchResult = {
        items: [
          {
            productId: 'prod-456',
            name: 'Parity Test Product',
            price: { amount: 199.99, currency: 'SEK', formatted: '199,99 kr' },
          },
        ],
        totalCount: 1,
      };

      (mockTool.execute as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);

      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_parity_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'parity test' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found products for parity test!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const nonStreamResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cards-parity-non-stream',
          message: 'Find parity test products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(nonStreamResponse.statusCode).toBe(200);
      const nonStreamBody = JSON.parse(nonStreamResponse.body);

      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_parity_2',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'parity test' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found products for parity test!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const streamResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'cards-parity-stream',
          message: 'Find parity test products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(streamResponse.statusCode).toBe(200);
      const events = parseSSEEvents(streamResponse.body);
      const finalEvent = events.find(e => e.event === 'final');
      expect(finalEvent).toBeDefined();
      const streamBody = finalEvent!.data as Record<string, unknown>;

      if (nonStreamBody.cards) {
        expect(streamBody.cards).toBeDefined();
        expect(Array.isArray(streamBody.cards)).toBe(true);
        expect((streamBody.cards as unknown[]).length).toBe((nonStreamBody.cards as unknown[]).length);
      }

      const nonStreamValidation = chatResponseSchema.safeParse(nonStreamBody);
      const streamValidation = chatResponseSchema.safeParse(streamBody);

      expect(nonStreamValidation.success).toBe(true);
      expect(streamValidation.success).toBe(true);
    });
  });

  describe('turnId Generation', () => {
    it('should generate unique turnId for each request', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response1 = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'turnid-test-1',
          message: 'First message',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const response2 = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'turnid-test-2',
          message: 'Second message',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);

      expect(body1.turnId).toBeDefined();
      expect(body2.turnId).toBeDefined();
      expect(body1.turnId).not.toBe(body2.turnId);
    });

    it('should generate unique turnId for streaming requests', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Streaming response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response1 = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-turnid-test-1',
          message: 'First streaming message',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const response2 = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-turnid-test-2',
          message: 'Second streaming message',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const events1 = parseSSEEvents(response1.body);
      const events2 = parseSSEEvents(response2.body);

      const final1 = events1.find(e => e.event === 'final')?.data as Record<string, unknown>;
      const final2 = events2.find(e => e.event === 'final')?.data as Record<string, unknown>;

      expect(final1.turnId).toBeDefined();
      expect(final2.turnId).toBeDefined();
      expect(final1.turnId).not.toBe(final2.turnId);
    });
  });
});
