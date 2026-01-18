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
import type { SessionState } from '../session/sessionTypes.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

function createMockCartGetTool(): Tool {
  return {
    name: 'cart_get',
    description: 'Get the current cart',
    parameters: z.object({
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({
      cart: {
        id: 'cart-123',
        items: [
          {
            productId: 'prod-001',
            name: 'Test Product 1',
            quantity: 2,
            unitPrice: '99.00',
            totalPrice: '198.00',
            currency: 'SEK',
          },
          {
            productId: 'prod-002',
            name: 'Test Product 2',
            quantity: 1,
            unitPrice: '149.00',
            totalPrice: '149.00',
            currency: 'SEK',
          },
        ],
        itemCount: 3,
        subtotal: '347.00',
        currency: 'SEK',
      },
    }),
  };
}

function createMockCartAddTool(): Tool {
  return {
    name: 'cart_add_item',
    description: 'Add an item to the cart',
    parameters: z.object({
      partNo: z.string(),
      quantity: z.number().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({
      cart: {
        id: 'cart-123',
        basketId: 'basket-456',
        items: [
          {
            productId: 'prod-new',
            name: 'New Product',
            quantity: 1,
            unitPrice: '199.00',
            totalPrice: '199.00',
            currency: 'SEK',
          },
        ],
        itemCount: 1,
        subtotal: '199.00',
        currency: 'SEK',
      },
    }),
  };
}

function createMockProductSearchTool(): Tool {
  return {
    name: 'product_search',
    description: 'Search for products',
    parameters: z.object({
      query: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
  };
}

describe('Cart State Persistence', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockCartGetTool: Tool;
  let mockCartAddTool: Tool;
  let mockProductSearchTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockCartGetTool = createMockCartGetTool();
    mockCartAddTool = createMockCartAddTool();
    mockProductSearchTool = createMockProductSearchTool();

    agentRunner = new AgentRunner({
      tools: [mockCartGetTool, mockCartAddTool, mockProductSearchTool],
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

  describe('Non-streaming: cart_get returns cart summary in response', () => {
    it('should include cart summary in response after cart_get', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_cart_get_1',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here is your cart with 3 items totaling 347.00 SEK.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-state-test-1',
          message: 'show my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      expect(body.cart).toBeDefined();
      expect(body.cart.cartId).toBe('cart-123');
      expect(body.cart.itemCount).toBe(2);
      expect(body.cart.items).toHaveLength(2);
      expect(body.cart.items[0].productId).toBe('prod-001');
      expect(body.cart.items[0].name).toBe('Test Product 1');
      expect(body.cart.items[0].quantity).toBe(2);
      expect(body.cart.items[1].productId).toBe('prod-002');
      expect(body.cart.totals).toBeDefined();
      expect(body.cart.totals.subtotal).toBeDefined();
      expect(body.cart.totals.subtotal.formatted).toBe('347.00');
      expect(body.cart.totals.subtotal.currency).toBe('SEK');
    });

    it('should persist cartState in session after cart_get', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_cart_get_2',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Your cart has 3 items.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-state-test-2',
          message: 'what is in my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:cart-state-test-2') as SessionState;
      expect(session).not.toBeNull();
      expect(session.cartState).toBeDefined();
      expect(session.cartState?.cartId).toBe('cart-123');
      expect(session.cartState?.itemCount).toBe(2);
      expect(session.cartState?.items).toHaveLength(2);
    });

    it('should return persisted cart in subsequent responses without cart tool call', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_cart_get_3',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Your cart has 3 items.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-state-test-3',
          message: 'show my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'Sure, I can help you find products.',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response2 = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-state-test-3',
          message: 'help me find a table',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response2.statusCode).toBe(200);

      const body2 = JSON.parse(response2.body);
      expect(body2.cart).toBeDefined();
      expect(body2.cart.cartId).toBe('cart-123');
      expect(body2.cart.itemCount).toBe(2);
    });
  });

  describe('Non-streaming: cart mutations update cart state after confirmation', () => {
    it('should update cartState after confirmed cart_add_item', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_1',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-new', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-add-test-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:cart-add-test-1') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.cartState).toBeUndefined();

      const confirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-add-test-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(confirmResponse.statusCode).toBe(200);

      const body = JSON.parse(confirmResponse.body);
      expect(body.cart).toBeDefined();
      expect(body.cart.cartId).toBe('cart-123');
      // After cart mutation, cart.get is called to refresh cart state
      // The mock cart_get returns 2 items with itemCount 3 (2 items with quantities 2+1)
      expect(body.cart.itemCount).toBe(3);
      expect(body.cart.items[0].productId).toBe('prod-001');

      session = await sessionStore.get('demo:cart-add-test-1') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.status).toBe('consumed');
      expect(session.pendingAction?.consumedAt).toBeDefined();
      expect(session.cartState).toBeDefined();
      expect(session.cartState?.cartId).toBe('cart-123');
      // After cart mutation, cart.get is called to refresh cart state
      expect(session.cartState?.itemCount).toBe(3);
    });
  });

  describe('Streaming: final event includes cart summary', () => {
    it('should include cart in final SSE event after cart_get', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_cart_get_stream',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Here is your cart.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-stream-test-1',
          message: 'show my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const lines = response.body.split('\n').filter((line: string) => line.startsWith('data:'));
      const finalLine = lines[lines.length - 1];
      expect(finalLine).toBeDefined();

      const finalData = JSON.parse(finalLine.replace('data: ', ''));
      expect(finalData.cart).toBeDefined();
      expect(finalData.cart.cartId).toBe('cart-123');
      expect(finalData.cart.itemCount).toBe(2);
      expect(finalData.cart.items).toHaveLength(2);
    });

    it('should include persisted cart in final SSE event for subsequent requests', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_cart_get_stream_2',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Your cart is ready.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-stream-test-2',
          message: 'show my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'I can help you search for products.',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response2 = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-stream-test-2',
          message: 'find me a chair',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response2.statusCode).toBe(200);

      const lines = response2.body.split('\n').filter((line: string) => line.startsWith('data:'));
      const finalLine = lines[lines.length - 1];
      const finalData = JSON.parse(finalLine.replace('data: ', ''));

      expect(finalData.cart).toBeDefined();
      expect(finalData.cart.cartId).toBe('cart-123');
      expect(finalData.cart.itemCount).toBe(2);
    });
  });

  describe('Cart item capping', () => {
    it('should cap cart items at MAX_CART_ITEMS (20) during normalization', async () => {
      const manyItems = Array.from({ length: 30 }, (_, i) => ({
        productId: `prod-${i}`,
        name: `Product ${i}`,
        quantity: 1,
        unitPrice: '10.00',
        totalPrice: '10.00',
        currency: 'SEK',
      }));

      const mockCartGetWithManyItems = {
        name: 'cart_get',
        description: 'Get the current cart',
        parameters: z.object({
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue({
          cart: {
            id: 'cart-large',
            items: manyItems,
            itemCount: 30,
            subtotal: '300.00',
            currency: 'SEK',
          },
        }),
      };

      const newAgentRunner = new AgentRunner({
        tools: [mockCartGetWithManyItems, mockProductSearchTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const newFastify = Fastify({ logger: false });
      const newSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await newFastify.register(chatRoutes, {
        sessionStore: newSessionStore,
        agentRunner: newAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;
      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_cart_get_large',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Your cart has many items.',
          toolCalls: [],
          finishReason: 'stop',
        });

      await newFastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-cap-test',
          message: 'show my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await newSessionStore.get('demo:cart-cap-test') as SessionState;
      expect(session.cartState).toBeDefined();
      expect(session.cartState?.items).toHaveLength(20);
      expect(session.cartState?.itemCount).toBe(20);

      newSessionStore.destroy();
      await newFastify.close();
    });
  });
});
