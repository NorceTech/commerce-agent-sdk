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

function createMockCartAddTool(): Tool {
  return {
    name: 'cart_add_item',
    description: 'Add an item to the cart',
    parameters: z.object({
      partNo: z.string(),
      quantity: z.number().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ success: true, cartId: 'cart-123' }),
  };
}

function createMockCartGetTool(): Tool {
  return {
    name: 'cart_get',
    description: 'Get the current cart',
    parameters: z.object({
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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

describe('Idempotent Cart Confirmation', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockCartAddTool: Tool;
  let mockCartGetTool: Tool;
  let mockProductSearchTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockCartAddTool = createMockCartAddTool();
    mockCartGetTool = createMockCartGetTool();
    mockProductSearchTool = createMockProductSearchTool();

    agentRunner = new AgentRunner({
      tools: [mockCartAddTool, mockCartGetTool, mockProductSearchTool],
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

  describe('Double confirmation idempotency', () => {
    it('should execute cart mutation exactly once when "yes" is sent twice', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_idempotent',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-idempotent', quantity: 2 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-1',
          message: 'add 2 of product idempotent to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:idempotent-test-1') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.status).toBe('pending');
      const pendingActionId = session.pendingAction?.id;
      expect(pendingActionId).toBeDefined();

      const firstConfirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(firstConfirmResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstConfirmResponse.body);
      // Swedish localized completion message
      expect(firstBody.text).toContain('Klart');

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);

      session = await sessionStore.get('demo:idempotent-test-1') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.status).toBe('consumed');
      expect(session.pendingAction?.consumedAt).toBeDefined();
      expect(session.pendingAction?.id).toBe(pendingActionId);

      const secondConfirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(secondConfirmResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondConfirmResponse.body);
      expect(secondBody.text).toContain('already been');

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);

      session = await sessionStore.get('demo:idempotent-test-1') as SessionState;
      expect(session.pendingAction?.status).toBe('consumed');
    });

    it('should return 200 and not call MCP on second confirmation', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_second',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-second', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-2',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-2',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);

      const thirdResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-2',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(thirdResponse.statusCode).toBe(200);

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);
    });

    it('should include pendingActionId in response when pending action is created', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_with_id',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-with-id', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'idempotent-test-3',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.pendingAction).toBeDefined();
      expect(body.pendingAction.pendingActionId).toBeDefined();
      expect(body.pendingAction.pendingActionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(body.pendingAction.tool).toBe('cart_add_item');

      const session = await sessionStore.get('demo:idempotent-test-3') as SessionState;
      expect(session.pendingAction?.id).toBe(body.pendingAction.pendingActionId);
    });
  });

  describe('HTTP request retry idempotency', () => {
    it('should handle concurrent/retry requests and only execute once', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_retry',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-retry', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'retry-test-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:retry-test-1') as SessionState;
      expect(session.pendingAction?.status).toBe('pending');

      const [response1, response2] = await Promise.all([
        fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'retry-test-1',
            message: 'yes',
            context: { cultureCode: 'sv-SE' },
          },
        }),
        fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'retry-test-1',
            message: 'yes',
            context: { cultureCode: 'sv-SE' },
          },
        }),
      ]);

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Consumed action state persistence', () => {
    it('should persist consumed status across multiple requests', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_persist',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-persist', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'persist-test-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'persist-test-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:persist-test-1') as SessionState;
      expect(session.pendingAction?.status).toBe('consumed');
      const consumedAt = session.pendingAction?.consumedAt;

      for (let i = 0; i < 3; i++) {
        const response = await fastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: 'persist-test-1',
            message: 'yes',
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.text).toContain('already been');
      }

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);

      session = await sessionStore.get('demo:persist-test-1') as SessionState;
      expect(session.pendingAction?.status).toBe('consumed');
      expect(session.pendingAction?.consumedAt).toBe(consumedAt);
    });
  });

  describe('Cancelled action idempotency', () => {
    it('should not allow confirmation after cancellation', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_cancel',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-cancel', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cancel-test-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:cancel-test-1') as SessionState;
      expect(session.pendingAction?.status).toBe('pending');

      const cancelResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cancel-test-1',
          message: 'no',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(cancelResponse.statusCode).toBe(200);
      const cancelBody = JSON.parse(cancelResponse.body);
      // Swedish localized cancelled message
      expect(cancelBody.text).toContain('avbrutit');

      session = await sessionStore.get('demo:cancel-test-1') as SessionState;
      expect(session.pendingAction).toBeUndefined();

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();
    });
  });

  describe('Response does not include pendingAction after consumption', () => {
    it('should not include pendingAction in response after action is consumed', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_no_pending',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-no-pending', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const createResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-pending-test-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const createBody = JSON.parse(createResponse.body);
      expect(createBody.pendingAction).toBeDefined();

      const confirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-pending-test-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const confirmBody = JSON.parse(confirmResponse.body);
      expect(confirmBody.pendingAction).toBeUndefined();

      const secondConfirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-pending-test-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const secondConfirmBody = JSON.parse(secondConfirmResponse.body);
      expect(secondConfirmBody.pendingAction).toBeUndefined();
    });
  });
});
