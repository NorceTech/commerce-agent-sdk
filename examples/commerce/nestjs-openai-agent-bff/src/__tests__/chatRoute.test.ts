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
import { AgentRunner, ConversationMessage } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';
import type { McpState } from '../session/sessionTypes.js';

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

describe('POST /v1/chat (chatRoute)', () => {
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

  describe('valid request returns 200 and sessionId and text', () => {
    it('should return 200 with sessionId and text for valid request', async () => {
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
          sessionId: 'test-session-123',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.sessionId).toBe('test-session-123');
      expect(body.text).toBe('Hello! How can I help you today?');
    });

    it('should include debug.toolTrace when ?debug=1 query param is set', async () => {
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
          content: 'Found some laptops!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'debug-session',
          message: 'Find laptops',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.debug).toBeDefined();
      expect(body.debug.toolTrace).toBeDefined();
      expect(Array.isArray(body.debug.toolTrace)).toBe(true);
    });

    it('should not include debug.toolTrace when ?debug=1 is not set', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-debug-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.debug).toBeUndefined();
    });
  });

  describe('invalid request returns 400 with clear message', () => {
    it('should return 400 when applicationId is missing', async () => {
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
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('applicationId');
    });

    it('should return 400 when sessionId is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('sessionId');
    });

    it('should return 400 when message is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('message');
    });

    it('should return 400 when context is missing', async () => {
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
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('context');
    });

    it('should return 400 when applicationId is empty string', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: '',
          sessionId: 'test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('applicationId');
    });

    it('should return 400 when sessionId is empty string', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: '',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('sessionId');
    });

    it('should return 400 when message is empty string', async () => {
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
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('message');
    });

    it('should return 400 with stable error payload for validation errors', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toBeDefined();
      expect(body.error.requestId).toBeDefined();
    });
  });

  describe('repeated call with same sessionId uses stored session', () => {
    it('should reuse stored session on repeated calls with same applicationId:sessionId', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValue({
        content: 'First response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const firstResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'reuse-session',
          message: 'First message',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(firstResponse.statusCode).toBe(200);

      runWithToolsMock.mockResolvedValue({
        content: 'Second response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const secondResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'reuse-session',
          message: 'Second message',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(secondResponse.statusCode).toBe(200);

      const sessionKey = 'demo:reuse-session';
      const session = await sessionStore.get(sessionKey);

      expect(session).not.toBeNull();
      expect(session!.conversation.length).toBeGreaterThan(2);

      const userMessages = (session!.conversation as ConversationMessage[]).filter(
        (msg) => msg.role === 'user'
      );
      expect(userMessages.length).toBe(2);
    });

    it('should initialize MCP only once when using same session (mocked MCP client call count)', async () => {
      let mcpInitCallCount = 0;

      const mockToolWithMcpTracking = {
        name: 'product_search',
        description: 'Mock tool with MCP tracking',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockImplementation(async (params: unknown, mcpState: McpState) => {
          if (!mcpState.sessionId) {
            mcpInitCallCount++;
            mcpState.sessionId = 'mcp-session-' + mcpInitCallCount;
          }
          return { items: [], totalCount: 0 };
        }),
      };

      const trackedAgentRunner = new AgentRunner({
        tools: [mockToolWithMcpTracking],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const trackedFastify = Fastify({ logger: false });
      const trackedSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await trackedFastify.register(chatRoutes, {
        sessionStore: trackedSessionStore,
        agentRunner: trackedAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'laptops' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found laptops!',
          toolCalls: [],
          finishReason: 'stop',
        });

      await trackedFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'mcp-test-session',
          message: 'Find laptops',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(mcpInitCallCount).toBe(1);

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_2',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'phones' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found phones!',
          toolCalls: [],
          finishReason: 'stop',
        });

      await trackedFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'mcp-test-session',
          message: 'Find phones',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(mcpInitCallCount).toBe(1);

      trackedSessionStore.destroy();
      await trackedFastify.close();
    });

    it('should create separate sessions for different applicationId:sessionId combinations', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValue({
        content: 'Response',
        toolCalls: [],
        finishReason: 'stop',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'app-a',
          sessionId: 'session-1',
          message: 'Hello from app A',
          context: { cultureCode: 'sv-SE' },
        },
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'app-b',
          sessionId: 'session-1',
          message: 'Hello from app B',
          context: { cultureCode: 'en-US' },
        },
      });

      const sessionA = await sessionStore.get('app-a:session-1');
      const sessionB = await sessionStore.get('app-b:session-1');

      expect(sessionA).not.toBeNull();
      expect(sessionB).not.toBeNull();

      const userMessageA = (sessionA!.conversation as ConversationMessage[]).find(
        (msg) => msg.role === 'user'
      );
      const userMessageB = (sessionB!.conversation as ConversationMessage[]).find(
        (msg) => msg.role === 'user'
      );

      expect(userMessageA?.content).toBe('Hello from app A');
      expect(userMessageB?.content).toBe('Hello from app B');
    });
  });

  describe('service unavailable when agentRunner is null', () => {
    it('should return 503 when agentRunner is not configured', async () => {
      const noAgentFastify = Fastify({ logger: false });
      const noAgentSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await noAgentFastify.register(chatRoutes, {
        sessionStore: noAgentSessionStore,
        agentRunner: null,
      });

      const response = await noAgentFastify.inject({
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
      expect(body.error.category).toBe('internal');
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBeDefined();

      noAgentSessionStore.destroy();
      await noAgentFastify.close();
    });
  });

  describe('card filtering by selectedProductIds', () => {
    it('should filter cards by selectedProductIds when product_get is called', async () => {
      // Create mock tools that return search results and track product_get calls
      const searchResult = {
        items: [
          { productId: '118936', name: 'Product A', price: 100, currency: 'SEK' },
          { productId: '118937', name: 'Product B', price: 200, currency: 'SEK' },
          { productId: '118938', name: 'Product C', price: 300, currency: 'SEK' },
          { productId: '118939', name: 'Product D', price: 400, currency: 'SEK' },
          { productId: '118940', name: 'Product E', price: 500, currency: 'SEK' },
          { productId: '118941', name: 'Product F', price: 600, currency: 'SEK' },
        ],
        cards: [
          { productId: '118936', title: 'Product A', price: '100', currency: 'SEK' },
          { productId: '118937', title: 'Product B', price: '200', currency: 'SEK' },
          { productId: '118938', title: 'Product C', price: '300', currency: 'SEK' },
          { productId: '118939', title: 'Product D', price: '400', currency: 'SEK' },
          { productId: '118940', title: 'Product E', price: '500', currency: 'SEK' },
          { productId: '118941', title: 'Product F', price: '600', currency: 'SEK' },
        ],
        totalCount: 6,
        truncated: false,
      };

      const getResult = {
        raw: { productId: '118936', name: 'Product A', price: 100, currency: 'SEK' },
        card: { productId: '118936', title: 'Product A', price: '100', currency: 'SEK' },
      };

      const mockSearchTool: Tool = {
        name: 'product_search',
        description: 'Search products',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResult),
      };

      const mockGetTool: Tool = {
        name: 'product_get',
        description: 'Get product',
        parameters: z.object({
          productId: z.string().optional(),
          partNo: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(getResult),
      };

      const filterAgentRunner = new AgentRunner({
        tools: [mockSearchTool, mockGetTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const filterFastify = Fastify({ logger: false });
      const filterSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await filterFastify.register(chatRoutes, {
        sessionStore: filterSessionStore,
        agentRunner: filterAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // First call: search returns 6 products
      // Second call: model calls product_get for 3 specific products
      // Third call: model responds with final message
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
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '118936' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '118937' }),
            },
            {
              id: 'call_get_3',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '118938' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are the 3 products I recommend!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await filterFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'filter-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      // Should have exactly 3 cards (the ones selected via product_get)
      expect(body.cards).toBeDefined();
      expect(body.cards.length).toBe(3);
      
      // Cards should be in order of selectedProductIds
      expect(body.cards[0].productId).toBe('118936');
      expect(body.cards[1].productId).toBe('118937');
      expect(body.cards[2].productId).toBe('118938');

      filterSessionStore.destroy();
      await filterFastify.close();
    });

    it('should preserve order of selectedProductIds in response cards', async () => {
      const searchResult = {
        items: [
          { productId: '1', name: 'First', price: 100, currency: 'SEK' },
          { productId: '2', name: 'Second', price: 200, currency: 'SEK' },
          { productId: '3', name: 'Third', price: 300, currency: 'SEK' },
        ],
        cards: [
          { productId: '1', title: 'First', price: '100', currency: 'SEK' },
          { productId: '2', title: 'Second', price: '200', currency: 'SEK' },
          { productId: '3', title: 'Third', price: '300', currency: 'SEK' },
        ],
        totalCount: 3,
        truncated: false,
      };

      const mockSearchTool: Tool = {
        name: 'product_search',
        description: 'Search products',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResult),
      };

      const mockGetTool: Tool = {
        name: 'product_get',
        description: 'Get product',
        parameters: z.object({
          productId: z.string().optional(),
          partNo: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockImplementation(async (args: { productId?: string }) => {
          const id = args.productId || '1';
          return {
            raw: { productId: id, name: `Product ${id}` },
            card: { productId: id, title: `Product ${id}` },
          };
        }),
      };

      const orderAgentRunner = new AgentRunner({
        tools: [mockSearchTool, mockGetTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const orderFastify = Fastify({ logger: false });
      const orderSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await orderFastify.register(chatRoutes, {
        sessionStore: orderSessionStore,
        agentRunner: orderAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Model calls product_get in reverse order: 3, 2, 1
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
          content: null,
          toolCalls: [
            {
              id: 'call_get_3',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '3' }),
            },
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '2' }),
            },
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: '1' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here are the products in my preferred order!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await orderFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'order-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      // Cards should be in order of selectedProductIds (3, 2, 1)
      expect(body.cards).toBeDefined();
      expect(body.cards.length).toBe(3);
      expect(body.cards[0].productId).toBe('3');
      expect(body.cards[1].productId).toBe('2');
      expect(body.cards[2].productId).toBe('1');

      orderSessionStore.destroy();
      await orderFastify.close();
    });

    it('should return all collectedCards when no product_get is called', async () => {
      const searchResult = {
        items: [
          { productId: '1', name: 'Product 1' },
          { productId: '2', name: 'Product 2' },
        ],
        cards: [
          { productId: '1', title: 'Product 1' },
          { productId: '2', title: 'Product 2' },
        ],
        totalCount: 2,
        truncated: false,
      };

      const mockSearchTool: Tool = {
        name: 'product_search',
        description: 'Search products',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResult),
      };

      const noGetAgentRunner = new AgentRunner({
        tools: [mockSearchTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const noGetFastify = Fastify({ logger: false });
      const noGetSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await noGetFastify.register(chatRoutes, {
        sessionStore: noGetSessionStore,
        agentRunner: noGetAgentRunner,
      });

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
          content: 'Here are all the products!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await noGetFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-get-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      
      // Should return all collected cards since no product_get was called
      expect(body.cards).toBeDefined();
      expect(body.cards.length).toBe(2);
      expect(body.cards[0].productId).toBe('1');
      expect(body.cards[1].productId).toBe('2');

      noGetSessionStore.destroy();
      await noGetFastify.close();
    });
  });

  describe('error taxonomy and stable error payloads', () => {
    it('should return VALIDATION error with stable payload for invalid request', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: '',
          sessionId: 'test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toBeDefined();
      expect(typeof body.error.message).toBe('string');
    });

    it('should return VALIDATION error for missing required fields', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
      expect(body.error.message).toContain('applicationId');
    });

    it('should return INTERNAL error with stable payload for service unavailable', async () => {
      const noAgentFastify = Fastify({ logger: false });
      const noAgentSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await noAgentFastify.register(chatRoutes, {
        sessionStore: noAgentSessionStore,
        agentRunner: null,
      });

      const response = await noAgentFastify.inject({
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
      expect(body.error.message).toBeDefined();

      noAgentSessionStore.destroy();
      await noAgentFastify.close();
    });

    it('should return VALIDATION error for malformed tool arguments', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_malformed',
            name: 'product_search',
            arguments: '{ invalid json }',
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'malformed-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_TOOL_ARGS_INVALID');
      expect(body.error.message).toContain('tool arguments');
    });

    it('should include requestId in error payload', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: '',
          sessionId: 'test',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.requestId).toBeDefined();
      expect(typeof body.error.requestId).toBe('string');
    });

    it('should have stable error payload shape', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: '',
          sessionId: 'test',
          message: 'Hello',
          context: {},
        },
      });

      const body = JSON.parse(response.body);

      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('category');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');

      expect(['validation', 'auth', 'upstream', 'policy', 'internal']).toContain(body.error.category);
    });

    it('should map OpenAI errors to appropriate category', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      const openaiError = new Error('Rate limit exceeded');
      openaiError.name = 'RateLimitError';
      (openaiError as Error & { status: number }).status = 429;

      runWithToolsMock.mockRejectedValueOnce(openaiError);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'rate-limit-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(429);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('upstream');
      expect(body.error.code).toBe('OPENAI_RATE_LIMIT');
    });

    it('should map generic errors to INTERNAL category', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockRejectedValueOnce(new Error('Something unexpected happened'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'generic-error-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('internal');
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should map MCP transport errors to appropriate category', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      const mcpError = new Error('MCP request failed: status=500, content-type=text/plain, body=Internal Server Error');

      runWithToolsMock.mockRejectedValueOnce(mcpError);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'mcp-error-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(503);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('upstream');
      expect(body.error.code).toBe('MCP_TRANSPORT_HTTP_ERROR');
    });

    it('should map OAuth/authentication errors to OAUTH category', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      const oauthError = new Error('Failed to fetch OAuth token: 401 unauthorized');

      runWithToolsMock.mockRejectedValueOnce(oauthError);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'oauth-error-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('OAUTH_TOKEN_INVALID');
    });
  });

  describe('thumbnailImageKey propagation', () => {
    it('should include thumbnailImageKey in response cards when present in product_search results', async () => {
      const searchResultWithThumbnails = {
        items: [
          { 
            productId: '1001', 
            name: 'Product With Thumbnail', 
            price: 100, 
            currency: 'SEK',
            thumbnailImageKey: 'thumb-key-abc123',
            onHand: { value: 10, isActive: true }
          },
          { 
            productId: '1002', 
            name: 'Product Without Thumbnail', 
            price: 200, 
            currency: 'SEK',
            onHand: { value: 5, isActive: true }
          },
        ],
        cards: [
          { 
            productId: '1001', 
            title: 'Product With Thumbnail', 
            price: '100', 
            currency: 'SEK',
            thumbnailImageKey: 'thumb-key-abc123'
          },
          { 
            productId: '1002', 
            title: 'Product Without Thumbnail', 
            price: '200', 
            currency: 'SEK'
          },
        ],
        totalCount: 2,
      };

      const mockSearchToolWithThumbnails = {
        name: 'product_search',
        description: 'Mock search tool with thumbnails',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResultWithThumbnails),
      };

      const thumbnailAgentRunner = new AgentRunner({
        tools: [mockSearchToolWithThumbnails],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const thumbnailFastify = Fastify({ logger: false });
      const thumbnailSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await thumbnailFastify.register(chatRoutes, {
        sessionStore: thumbnailSessionStore,
        agentRunner: thumbnailAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_thumb_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some products!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await thumbnailFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'thumbnail-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.cards).toBeDefined();
      expect(body.cards.length).toBe(2);
      
      // First card should have thumbnailImageKey
      expect(body.cards[0].thumbnailImageKey).toBe('thumb-key-abc123');
      
      // Second card should not have thumbnailImageKey (undefined)
      expect(body.cards[1].thumbnailImageKey).toBeUndefined();

      thumbnailSessionStore.destroy();
      await thumbnailFastify.close();
    });

    it('should include thumbnailsPresentCount in debug.toolTrace when debug=1', async () => {
      const searchResultWithThumbnails = {
        items: [
          { 
            productId: '2001', 
            name: 'Product A', 
            thumbnailImageKey: 'thumb-a',
            onHand: { value: 10, isActive: true }
          },
          { 
            productId: '2002', 
            name: 'Product B', 
            thumbnailImageKey: 'thumb-b',
            onHand: { value: 5, isActive: true }
          },
          { 
            productId: '2003', 
            name: 'Product C', 
            onHand: { value: 3, isActive: true }
          },
        ],
        totalCount: 3,
      };

      const mockSearchToolWithThumbnails = {
        name: 'product_search',
        description: 'Mock search tool with thumbnails',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResultWithThumbnails),
      };

      const debugAgentRunner = new AgentRunner({
        tools: [mockSearchToolWithThumbnails],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const debugFastify = Fastify({ logger: false });
      const debugSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await debugFastify.register(chatRoutes, {
        sessionStore: debugSessionStore,
        agentRunner: debugAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_debug_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found products!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await debugFastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'debug-thumbnail-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.debug).toBeDefined();
      expect(body.debug.toolTrace).toBeDefined();
      expect(body.debug.toolTrace.length).toBeGreaterThan(0);
      
      // Find the product_search trace entry
      const searchTrace = body.debug.toolTrace.find(
        (entry: { tool: string }) => entry.tool === 'product_search'
      );
      expect(searchTrace).toBeDefined();
      expect(searchTrace.thumbnailsPresentCount).toBe(2);

      debugSessionStore.destroy();
      await debugFastify.close();
    });

    it('should handle null thumbnailImageKey correctly in response cards', async () => {
      const searchResultWithNullThumbnail = {
        items: [
          { 
            productId: '3001', 
            name: 'Product With Null Thumbnail', 
            thumbnailImageKey: null,
            onHand: { value: 10, isActive: true }
          },
        ],
        cards: [
          { 
            productId: '3001', 
            title: 'Product With Null Thumbnail', 
            thumbnailImageKey: null
          },
        ],
        totalCount: 1,
      };

      const mockSearchToolWithNullThumbnail = {
        name: 'product_search',
        description: 'Mock search tool with null thumbnail',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResultWithNullThumbnail),
      };

      const nullThumbAgentRunner = new AgentRunner({
        tools: [mockSearchToolWithNullThumbnail],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const nullThumbFastify = Fastify({ logger: false });
      const nullThumbSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await nullThumbFastify.register(chatRoutes, {
        sessionStore: nullThumbSessionStore,
        agentRunner: nullThumbAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_null_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found product!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await nullThumbFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'null-thumbnail-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.cards).toBeDefined();
      expect(body.cards.length).toBe(1);
      expect(body.cards[0].thumbnailImageKey).toBeNull();

      nullThumbSessionStore.destroy();
      await nullThumbFastify.close();
    });
  });
});
