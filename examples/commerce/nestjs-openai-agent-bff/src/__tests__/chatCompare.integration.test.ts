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
import type { McpState } from '../session/sessionTypes.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

function createMockSearchTool(searchResult: unknown): Tool {
  return {
    name: 'product_search',
    description: 'Search for products',
    parameters: z.object({
      query: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue(searchResult),
  };
}

function createMockGetTool(): Tool {
  const productDetails: Record<string, unknown> = {
    'prod-1': {
      card: {
        productId: 'prod-1',
        title: 'Product One',
        brand: 'Brand A',
        price: '199',
        currency: 'SEK',
        attributes: { color: 'red', size: 'M', material: 'cotton' },
      },
    },
    'prod-2': {
      card: {
        productId: 'prod-2',
        title: 'Product Two',
        brand: 'Brand B',
        price: '299',
        currency: 'SEK',
        attributes: { color: 'blue', size: 'L', material: 'polyester' },
      },
    },
    'prod-3': {
      card: {
        productId: 'prod-3',
        title: 'Product Three',
        brand: 'Brand C',
        price: '399',
        currency: 'SEK',
        attributes: { color: 'black', size: 'S', material: 'wool' },
      },
    },
  };

  return {
    name: 'product_get',
    description: 'Get product details',
    parameters: z.object({
      productId: z.string().optional(),
      partNo: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockImplementation(async (params: { productId?: string; partNo?: string }) => {
      const id = params.productId ?? params.partNo ?? '';
      return productDetails[id] ?? { card: null };
    }),
  };
}

describe('Compare Mode Integration Tests', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockSearchTool: Tool;
  let mockGetTool: Tool;
  let agentRunner: AgentRunner;

  const searchResult = {
    items: [
      { productId: 'prod-1', name: 'Product One', price: 199, currency: 'SEK' },
      { productId: 'prod-2', name: 'Product Two', price: 299, currency: 'SEK' },
      { productId: 'prod-3', name: 'Product Three', price: 399, currency: 'SEK' },
    ],
    totalCount: 3,
  };

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockSearchTool = createMockSearchTool(searchResult);
    mockGetTool = createMockGetTool();

    agentRunner = new AgentRunner({
      tools: [mockSearchTool, mockGetTool],
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

  describe('compare mode with product_get calls', () => {
    it('should return comparison payload when 2 product_get calls are made', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are some products for you.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'compare-test-1',
          message: 'Show me products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-1' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-2' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here is a comparison of the two products.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'compare-test-1',
          message: 'compare option 1 and 2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      expect(body.comparison).toBeDefined();
      expect(body.comparison.productIds).toHaveLength(2);
      expect(body.comparison.items).toHaveLength(2);
      expect(body.comparison.table).toBeDefined();
      expect(body.comparison.table.headers).toBeDefined();
      expect(body.comparison.table.rows).toBeDefined();
    });

    it('should return comparison payload for 3 products', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are some products.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'compare-test-3',
          message: 'Show me products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-1' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-2' }),
            },
            {
              id: 'call_get_3',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-3' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here is a comparison of the three products.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'compare-test-3',
          message: 'compare #1, #2, and #3',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      expect(body.comparison).toBeDefined();
      expect(body.comparison.productIds).toHaveLength(3);
      expect(body.comparison.items).toHaveLength(3);
    });

    it('should include compare debug info when debug mode is enabled', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are some products.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'compare-debug-test',
          message: 'Show me products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-1' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-2' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Comparison complete.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'compare-debug-test',
          message: 'compare option 1 and 2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      expect(body.debug).toBeDefined();
      expect(body.debug.compare).toBeDefined();
      expect(body.debug.compare.productIds).toBeDefined();
      expect(body.debug.compare.productGetCallCount).toBeGreaterThanOrEqual(2);
    });

    it('should not include comparison when only 1 product_get is called', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-1' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here is the product.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'single-product-test',
          message: 'Show me product 1',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      expect(body.comparison).toBeUndefined();
    });
  });

  describe('tool restrictions', () => {
    it('should only use product_search and product_get tools (no cart tools)', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are some products.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'tool-restriction-test',
          message: 'Show me products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-1' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-2' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Comparison complete.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'tool-restriction-test',
          message: 'compare option 1 and 2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      const toolNames = body.debug.toolTrace.map((t: { tool: string }) => t.tool);
      
      const disallowedTools = ['cart_add', 'cart_get', 'cart_update', 'customer_get', 'order_create'];
      for (const tool of disallowedTools) {
        expect(toolNames).not.toContain(tool);
      }
      
      expect(toolNames.every((name: string) => ['product_search', 'product_get'].includes(name))).toBe(true);
    });
  });

  describe('comparison payload structure', () => {
    it('should have correct comparison payload structure', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_search',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are some products.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'structure-test',
          message: 'Show me products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-1' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'prod-2' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Comparison complete.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'structure-test',
          message: 'compare option 1 and 2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      expect(body.comparison).toBeDefined();
      expect(body.comparison.title).toBeDefined();
      expect(typeof body.comparison.title).toBe('string');
      
      expect(Array.isArray(body.comparison.productIds)).toBe(true);
      expect(body.comparison.productIds.length).toBeGreaterThanOrEqual(2);
      expect(body.comparison.productIds.length).toBeLessThanOrEqual(3);
      
      expect(Array.isArray(body.comparison.items)).toBe(true);
      expect(body.comparison.items.length).toBe(body.comparison.productIds.length);
      
      for (const item of body.comparison.items) {
        expect(item.productId).toBeDefined();
        expect(item.name).toBeDefined();
        expect(body.comparison.productIds).toContain(item.productId);
      }
      
      if (body.comparison.table) {
        expect(Array.isArray(body.comparison.table.headers)).toBe(true);
        expect(Array.isArray(body.comparison.table.rows)).toBe(true);
        
        for (const row of body.comparison.table.rows) {
          expect(row.feature).toBeDefined();
          expect(Array.isArray(row.values)).toBe(true);
        }
      }
    });
  });
});
