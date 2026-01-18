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
import { AgentRunner, ConversationMessage } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';
import type { McpState, SessionState } from '../session/sessionTypes.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

describe('Working Memory Integration Tests', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let productSearchCallCount: number;
  let productGetCallCount: number;
  let lastProductGetArgs: unknown;

  const searchResults = {
    items: [
      { productId: '118936', name: 'Björn Running Shoe Black', price: 1299, currency: 'SEK', attributes: { color: 'black', brand: 'Björn' } },
      { productId: '118937', name: 'Björn Running Shoe Blue', price: 1399, currency: 'SEK', attributes: { color: 'blue', brand: 'Björn' } },
      { productId: '118938', name: 'Björn Running Shoe Red', price: 1199, currency: 'SEK', attributes: { color: 'red', brand: 'Björn' } },
    ],
    totalCount: 3,
  };

  const productGetResult = {
    productId: '118937',
    name: 'Björn Running Shoe Blue',
    price: 1399,
    currency: 'SEK',
    description: 'Premium running shoe with excellent cushioning',
    attributes: { color: 'blue', brand: 'Björn', size: '42' },
  };

  function createMockTools(): Tool[] {
    const mockSearchTool: Tool = {
      name: 'product_search',
      description: 'Search for products',
      parameters: z.object({
        query: z.string().optional(),
        context: z.object({}).passthrough().optional(),
      }),
      execute: vi.fn().mockImplementation(async () => {
        productSearchCallCount++;
        return searchResults;
      }),
    };

    const mockGetTool: Tool = {
      name: 'product_get',
      description: 'Get product details',
      parameters: z.object({
        productId: z.string().optional(),
        partNo: z.string().optional(),
        context: z.object({}).passthrough().optional(),
      }),
      execute: vi.fn().mockImplementation(async (args: unknown) => {
        productGetCallCount++;
        lastProductGetArgs = args;
        return productGetResult;
      }),
    };

    return [mockSearchTool, mockGetTool];
  }

  beforeEach(async () => {
    productSearchCallCount = 0;
    productGetCallCount = 0;
    lastProductGetArgs = null;

    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();

    const mockTools = createMockTools();
    const agentRunner = new AgentRunner({
      tools: mockTools,
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

  describe('Multi-turn conversation with reference resolution', () => {
    it('should store lastResults after product_search and use them for reference resolution', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Turn 1: User asks "show me Björn" => model calls product_search
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'Björn' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'I found 3 Björn running shoes for you:\n1. Björn Running Shoe Black - 1299 SEK\n2. Björn Running Shoe Blue - 1399 SEK\n3. Björn Running Shoe Red - 1199 SEK',
          toolCalls: [],
          finishReason: 'stop',
        });

      const turn1Response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'ref-resolution-test',
          message: 'show me Björn',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(turn1Response.statusCode).toBe(200);
      expect(productSearchCallCount).toBe(1);

      // Verify lastResults were stored in session
      const sessionKey = 'demo:ref-resolution-test';
      const sessionAfterTurn1 = await sessionStore.get(sessionKey);
      expect(sessionAfterTurn1).not.toBeNull();
      expect(sessionAfterTurn1!.workingMemory?.lastResults).toBeDefined();
      expect(sessionAfterTurn1!.workingMemory!.lastResults!.length).toBe(3);
      expect(sessionAfterTurn1!.workingMemory!.lastResults![0].index).toBe(1);
      expect(sessionAfterTurn1!.workingMemory!.lastResults![1].index).toBe(2);
      expect(sessionAfterTurn1!.workingMemory!.lastResults![1].productId).toBe('118937');

      // Turn 2: User says "I like option 2" => model should call product_get with productId from lastResults[1]
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '118937' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Great choice! The Björn Running Shoe Blue is a premium running shoe with excellent cushioning, priced at 1399 SEK.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const turn2Response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'ref-resolution-test',
          message: 'I like option 2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(turn2Response.statusCode).toBe(200);

      // Assert: no second product_search call in turn 2
      expect(productSearchCallCount).toBe(1);
      expect(productGetCallCount).toBe(1);

      // Verify shortlist was updated
      const sessionAfterTurn2 = await sessionStore.get(sessionKey);
      expect(sessionAfterTurn2!.workingMemory?.shortlist).toBeDefined();
      expect(sessionAfterTurn2!.workingMemory!.shortlist!.length).toBe(1);
      expect(sessionAfterTurn2!.workingMemory!.shortlist![0].productId).toBe('118937');
    });

    it('should inject PRODUCT_MEMORY context into OpenAI messages', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Turn 1: Populate lastResults
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'Björn' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found 3 products',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'memory-context-test',
          message: 'show me Björn',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Turn 2: Check that PRODUCT_MEMORY is injected
      runWithToolsMock
        .mockResolvedValueOnce({
          content: 'Here are the details...',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'memory-context-test',
          message: 'tell me more about option 2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Verify PRODUCT_MEMORY was injected into the conversation
      const sessionKey = 'demo:memory-context-test';
      const session = await sessionStore.get(sessionKey);
      const conversation = session!.conversation as ConversationMessage[];

      // Find PRODUCT_MEMORY system message
      const productMemoryMessage = conversation.find(
        (msg) => msg.role === 'system' && msg.content.includes('PRODUCT_MEMORY')
      );

      expect(productMemoryMessage).toBeDefined();
      expect(productMemoryMessage!.content).toContain('lastResults');
      expect(productMemoryMessage!.content).toContain('118937');
    });

    it('should inject ResolverHint for ordinal patterns', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Turn 1: Populate lastResults
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'Björn' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found 3 products',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'resolver-hint-test',
          message: 'show me Björn',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Turn 2: Use ordinal pattern "#2"
      runWithToolsMock
        .mockResolvedValueOnce({
          content: 'Here are the details...',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'resolver-hint-test',
          message: '#2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Verify ResolverHint was injected
      const sessionKey = 'demo:resolver-hint-test';
      const session = await sessionStore.get(sessionKey);
      const conversation = session!.conversation as ConversationMessage[];

      // Find ResolverHint system message
      const resolverHintMessage = conversation.find(
        (msg) => msg.role === 'system' && msg.content.includes('ResolverHint')
      );

      expect(resolverHintMessage).toBeDefined();
      expect(resolverHintMessage!.content).toContain('118937');
      expect(resolverHintMessage!.content).toContain('index=2');
    });

    it('should not inject ResolverHint for descriptive references (model handles)', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Turn 1: Populate lastResults
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'Björn' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found 3 products',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-hint-test',
          message: 'show me Björn',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Turn 2: Use descriptive reference "the black one"
      runWithToolsMock
        .mockResolvedValueOnce({
          content: 'Here are the details about the black shoe...',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-hint-test',
          message: 'the black one',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Verify ResolverHint was NOT injected (model handles descriptive references)
      const sessionKey = 'demo:no-hint-test';
      const session = await sessionStore.get(sessionKey);
      const conversation = session!.conversation as ConversationMessage[];

      // Should NOT find ResolverHint system message
      const resolverHintMessage = conversation.find(
        (msg) => msg.role === 'system' && msg.content.includes('ResolverHint')
      );

      expect(resolverHintMessage).toBeUndefined();

      // But PRODUCT_MEMORY should still be present
      const productMemoryMessage = conversation.find(
        (msg) => msg.role === 'system' && msg.content.includes('PRODUCT_MEMORY')
      );

      expect(productMemoryMessage).toBeDefined();
    });

    it('should cap lastResults at 10 items', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Create search results with 15 items
      const largeSearchResults = {
        items: Array.from({ length: 15 }, (_, i) => ({
          productId: `prod-${i + 1}`,
          name: `Product ${i + 1}`,
          price: 100 + i * 10,
          currency: 'SEK',
        })),
        totalCount: 15,
      };

      // Override the mock tool to return large results
      const mockSearchTool: Tool = {
        name: 'product_search',
        description: 'Search for products',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(largeSearchResults),
      };

      const largeFastify = Fastify({ logger: false });
      const largeSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
      const largeAgentRunner = new AgentRunner({
        tools: [mockSearchTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      await largeFastify.register(chatRoutes, {
        sessionStore: largeSessionStore,
        agentRunner: largeAgentRunner,
      });

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found 15 products',
          toolCalls: [],
          finishReason: 'stop',
        });

      await largeFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'large-results-test',
          message: 'show me products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const sessionKey = 'demo:large-results-test';
      const session = await largeSessionStore.get(sessionKey);

      // lastResults should be capped at 10
      expect(session!.workingMemory?.lastResults?.length).toBe(10);

      largeSessionStore.destroy();
      await largeFastify.close();
    });

    it('should cap shortlist at 10 items', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Pre-populate session with 9 items in shortlist
      const sessionKey = 'demo:shortlist-cap-test';
      const now = Date.now();
      const ttlMs = 1800 * 1000;
      await sessionStore.set(sessionKey, {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: now,
        expiresAt: now + ttlMs,
        context: { cultureCode: 'sv-SE' },
        workingMemory: {
          lastResults: [
            { index: 1, productId: 'prod-1', name: 'Product 1' },
            { index: 2, productId: 'prod-2', name: 'Product 2' },
          ],
          shortlist: Array.from({ length: 9 }, (_, i) => ({
            productId: `existing-${i + 1}`,
            name: `Existing Product ${i + 1}`,
          })),
        },
      });

      // Simulate product_get calls that would add 3 more items
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            { id: 'call_get_1', name: 'product_get', arguments: JSON.stringify({ productId: 'new-1' }) },
            { id: 'call_get_2', name: 'product_get', arguments: JSON.stringify({ productId: 'new-2' }) },
            { id: 'call_get_3', name: 'product_get', arguments: JSON.stringify({ productId: 'new-3' }) },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Added to shortlist',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'shortlist-cap-test',
          message: 'I like all of these',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get(sessionKey);

      // Shortlist should be capped at 10
      expect(session!.workingMemory?.shortlist?.length).toBeLessThanOrEqual(10);
    });

    it('should dedupe shortlist items', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Pre-populate session with existing shortlist
      const sessionKey = 'demo:shortlist-dedupe-test';
      const now = Date.now();
      const ttlMs = 1800 * 1000;
      await sessionStore.set(sessionKey, {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: now,
        expiresAt: now + ttlMs,
        context: { cultureCode: 'sv-SE' },
        workingMemory: {
          lastResults: [
            { index: 1, productId: '118937', name: 'Björn Running Shoe Blue' },
          ],
          shortlist: [
            { productId: '118937', name: 'Björn Running Shoe Blue' },
          ],
        },
      });

      // Try to add the same product again
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            { id: 'call_get_1', name: 'product_get', arguments: JSON.stringify({ productId: '118937' }) },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Product details',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'shortlist-dedupe-test',
          message: 'show me that one again',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get(sessionKey);

      // Shortlist should still have only 1 item (deduped)
      expect(session!.workingMemory?.shortlist?.length).toBe(1);
      expect(session!.workingMemory?.shortlist![0].productId).toBe('118937');
    });
  });
});
