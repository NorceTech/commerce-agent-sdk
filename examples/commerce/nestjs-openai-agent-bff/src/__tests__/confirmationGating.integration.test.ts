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
      productId: z.string(),
      quantity: z.number().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ success: true, cartId: 'cart-123' }),
  };
}

function createMockCartSetQuantityTool(): Tool {
  return {
    name: 'cart_set_item_quantity',
    description: 'Set the quantity of an item in the cart',
    parameters: z.object({
      productId: z.string(),
      quantity: z.number(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockCartRemoveTool(): Tool {
  return {
    name: 'cart_remove_item',
    description: 'Remove an item from the cart',
    parameters: z.object({
      productId: z.string(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ success: true }),
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

describe('Cart Mutation Confirmation Gating', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockCartAddTool: Tool;
  let mockCartSetQuantityTool: Tool;
  let mockCartRemoveTool: Tool;
  let mockCartGetTool: Tool;
  let mockProductSearchTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockCartAddTool = createMockCartAddTool();
    mockCartSetQuantityTool = createMockCartSetQuantityTool();
    mockCartRemoveTool = createMockCartRemoveTool();
    mockCartGetTool = createMockCartGetTool();
    mockProductSearchTool = createMockProductSearchTool();

    agentRunner = new AgentRunner({
      tools: [
        mockCartAddTool,
        mockCartSetQuantityTool,
        mockCartRemoveTool,
        mockCartGetTool,
        mockProductSearchTool,
      ],
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

  describe('Scenario A: cart_add_item requires confirmation', () => {
    it('should block cart_add_item and return confirmation question', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_1',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-123', quantity: 2 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-1',
          message: 'add option 2 to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Swedish localized confirmation prompt
      expect(body.text).toContain('varukorg');
      expect(body.text).toContain('Vill du att jag fortsätter');

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();

      const sessionKey = 'demo:confirm-test-1';
      const session = await sessionStore.get(sessionKey) as SessionState;
      expect(session).not.toBeNull();
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_add_item');
      expect(session.pendingAction?.args).toEqual({ productId: 'prod-123', quantity: 2 });
    });

    it('should include pendingAction info in response when debug is enabled', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_2',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-456', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-debug',
          message: 'add this to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      expect(body.pendingAction).toBeDefined();
      expect(body.pendingAction.tool).toBe('cart_add_item');

      expect(body.debug).toBeDefined();
      expect(body.debug.toolTrace).toBeDefined();
      const blockedEntry = body.debug.toolTrace.find(
        (t: { tool: string }) => t.tool === 'cart_add_item'
      );
      expect(blockedEntry).toBeDefined();
      expect(blockedEntry.blockedByPolicy).toBe(true);
      expect(blockedEntry.pendingActionCreated).toBe(true);
    });
  });

  describe('Scenario B: confirmation executes pending action', () => {
    it('should execute pending cart_add_item when user confirms with "yes"', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_3',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-789', quantity: 3 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-2',
          message: 'add 3 of product 789 to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:confirm-test-2') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_add_item');

      const confirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-2',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(confirmResponse.statusCode).toBe(200);

      const body = JSON.parse(confirmResponse.body);
      // Swedish localized completion message
      expect(body.text).toContain('Klart');

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);
      expect(mockCartAddTool.execute).toHaveBeenCalledWith(
        { productId: 'prod-789', quantity: 3 },
        expect.anything(),
        expect.anything(),
        'demo'
      );

      session = await sessionStore.get('demo:confirm-test-2') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.status).toBe('consumed');
      expect(session.pendingAction?.consumedAt).toBeDefined();
    });

    it('should execute pending action with various affirmation phrases', async () => {
      const affirmations = ['y', 'ok', 'confirm', 'sure', 'yep', 'yeah', 'go ahead'];

      for (const affirmation of affirmations) {
        const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;
        runWithToolsMock.mockReset();

        const newMockCartAddTool = createMockCartAddTool();
        const newAgentRunner = new AgentRunner({
          tools: [newMockCartAddTool, mockCartGetTool, mockProductSearchTool],
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

        runWithToolsMock.mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: `call_${affirmation}`,
              name: 'cart_add_item',
              arguments: JSON.stringify({ productId: 'prod-test', quantity: 1 }),
            },
          ],
          finishReason: 'tool_calls',
        });

        await newFastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: `affirm-${affirmation}`,
            message: 'add to cart',
            context: { cultureCode: 'sv-SE' },
          },
        });

        const confirmResponse = await newFastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: `affirm-${affirmation}`,
            message: affirmation,
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(confirmResponse.statusCode).toBe(200);
        expect(newMockCartAddTool.execute).toHaveBeenCalledTimes(1);

        newSessionStore.destroy();
        await newFastify.close();
      }
    });
  });

  describe('Scenario C: rejection clears pending action', () => {
    it('should clear pending action when user rejects with "no"', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_4',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-cancel', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-3',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:confirm-test-3') as SessionState;
      expect(session.pendingAction).toBeDefined();

      const rejectResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-3',
          message: 'no',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(rejectResponse.statusCode).toBe(200);

      const body = JSON.parse(rejectResponse.body);
      // Swedish localized cancelled message
      expect(body.text).toContain('avbrutit');

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();

      session = await sessionStore.get('demo:confirm-test-3') as SessionState;
      expect(session.pendingAction).toBeUndefined();
    });

    it('should clear pending action with various rejection phrases', async () => {
      const rejections = ['n', 'cancel', 'stop', 'nope', 'nah'];

      for (const rejection of rejections) {
        const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;
        runWithToolsMock.mockReset();

        const newMockCartAddTool = createMockCartAddTool();
        const newAgentRunner = new AgentRunner({
          tools: [newMockCartAddTool, mockCartGetTool, mockProductSearchTool],
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

        runWithToolsMock.mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: `call_${rejection}`,
              name: 'cart_add_item',
              arguments: JSON.stringify({ productId: 'prod-test', quantity: 1 }),
            },
          ],
          finishReason: 'tool_calls',
        });

        await newFastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: `reject-${rejection}`,
            message: 'add to cart',
            context: { cultureCode: 'sv-SE' },
          },
        });

        const rejectResponse = await newFastify.inject({
          method: 'POST',
          url: '/v1/chat',
          payload: {
            applicationId: 'demo',
            sessionId: `reject-${rejection}`,
            message: rejection,
            context: { cultureCode: 'sv-SE' },
          },
        });

        expect(rejectResponse.statusCode).toBe(200);
        expect(newMockCartAddTool.execute).not.toHaveBeenCalled();

        const session = await newSessionStore.get(`demo:reject-${rejection}`) as SessionState;
        expect(session.pendingAction).toBeUndefined();

        newSessionStore.destroy();
        await newFastify.close();
      }
    });
  });

  describe('Scenario D: pending action blocks unrelated messages', () => {
    it('should ask to confirm/cancel when user sends unrelated message', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_5',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-block', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-4',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      let session = await sessionStore.get('demo:confirm-test-4') as SessionState;
      expect(session.pendingAction).toBeDefined();

      const unrelatedResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-test-4',
          message: 'show me more tables',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(unrelatedResponse.statusCode).toBe(200);

      const body = JSON.parse(unrelatedResponse.body);
      // Swedish localized pending action reminder
      expect(body.text).toContain('väntande åtgärd');
      expect(body.text).toContain('ja');
      expect(body.text).toContain('nej');

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();
      expect(mockProductSearchTool.execute).not.toHaveBeenCalled();

      session = await sessionStore.get('demo:confirm-test-4') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_add_item');

      expect(body.pendingAction).toBeDefined();
      expect(body.pendingAction.tool).toBe('cart_add_item');
    });
  });

  describe('cart_get works without confirmation', () => {
    it('should allow cart_get to execute without confirmation', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'cart_get',
              arguments: JSON.stringify({}),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Your cart is empty.',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'cart-get-test',
          message: 'show my cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.text).toBe('Your cart is empty.');

      expect(mockCartGetTool.execute).toHaveBeenCalledTimes(1);

      const session = await sessionStore.get('demo:cart-get-test') as SessionState;
      expect(session.pendingAction).toBeUndefined();
    });
  });

  describe('other cart mutations also require confirmation', () => {
    it('should block cart_set_item_quantity and require confirmation', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_set_1',
            name: 'cart_set_item_quantity',
            arguments: JSON.stringify({ productId: 'prod-qty', quantity: 5 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'set-qty-test',
          message: 'change quantity to 5',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      // Swedish localized confirmation prompt
      expect(body.text).toContain('varukorg');

      expect(mockCartSetQuantityTool.execute).not.toHaveBeenCalled();

      const session = await sessionStore.get('demo:set-qty-test') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_set_item_quantity');
    });

    it('should block cart_remove_item and require confirmation', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_remove_1',
            name: 'cart_remove_item',
            arguments: JSON.stringify({ productId: 'prod-remove' }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'remove-test',
          message: 'remove this item',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      // Swedish localized confirmation prompt
      expect(body.text).toContain('varukorg');

      expect(mockCartRemoveTool.execute).not.toHaveBeenCalled();

      const session = await sessionStore.get('demo:remove-test') as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_remove_item');
    });
  });

  describe('Structured confirmation block', () => {
    it('should include confirmation block with localized options when pending action is created', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_confirm_block_1',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-123', quantity: 2 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-test-1',
          message: 'add 2 of product 123 to cart',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Verify confirmation block is present
      expect(body.confirmation).toBeDefined();
      expect(body.confirmation.kind).toBe('cart_confirm');
      expect(body.confirmation.id).toBeDefined();
      expect(body.confirmation.prompt).toBeDefined();

      // Verify options are present with correct structure
      expect(body.confirmation.options).toHaveLength(2);
      expect(body.confirmation.options[0]).toEqual({
        id: 'confirm',
        label: 'Yes',
        value: 'yes',
        style: 'primary',
      });
      expect(body.confirmation.options[1]).toEqual({
        id: 'cancel',
        label: 'No',
        value: 'no',
        style: 'secondary',
      });

      // Verify confirmation.id matches pendingAction.pendingActionId
      expect(body.confirmation.id).toBe(body.pendingAction.pendingActionId);
    });

    it('should include Swedish localized options when cultureCode is sv-SE', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_confirm_block_sv',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-456', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-test-sv',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Verify Swedish localized options
      expect(body.confirmation).toBeDefined();
      expect(body.confirmation.options[0].label).toBe('Ja');
      expect(body.confirmation.options[1].label).toBe('Nej');

      // Values should be localized to Swedish
      expect(body.confirmation.options[0].value).toBe('ja');
      expect(body.confirmation.options[1].value).toBe('nej');
    });

    it('should include confirmation block when user sends unrelated message with pending action', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_confirm_block_unrelated',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-789', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      // First request creates pending action
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-unrelated',
          message: 'add product to cart',
          context: { cultureCode: 'en-US' },
        },
      });

      // Second request with unrelated message
      const unrelatedResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-unrelated',
          message: 'what is the weather like?',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(unrelatedResponse.statusCode).toBe(200);

      const body = JSON.parse(unrelatedResponse.body);

      // Verify confirmation block is still present
      expect(body.confirmation).toBeDefined();
      expect(body.confirmation.kind).toBe('cart_confirm');
      expect(body.confirmation.options).toHaveLength(2);
    });

    it('should not include confirmation block after user confirms with "yes"', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_confirm_block_consumed',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-consumed', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      // First request creates pending action
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-consumed',
          message: 'add product to cart',
          context: { cultureCode: 'en-US' },
        },
      });

      // Confirm with "yes"
      const confirmResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-consumed',
          message: 'yes',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(confirmResponse.statusCode).toBe(200);

      const body = JSON.parse(confirmResponse.body);

      // Confirmation block should not be present after confirmation
      expect(body.confirmation).toBeUndefined();
    });

    it('should not include confirmation block after user cancels with "no"', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_confirm_block_cancelled',
            name: 'cart_add_item',
            arguments: JSON.stringify({ productId: 'prod-cancelled', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      // First request creates pending action
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-cancelled',
          message: 'add product to cart',
          context: { cultureCode: 'en-US' },
        },
      });

      // Cancel with "no"
      const cancelResponse = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'confirm-block-cancelled',
          message: 'no',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(cancelResponse.statusCode).toBe(200);

      const body = JSON.parse(cancelResponse.body);

      // Confirmation block should not be present after cancellation
      expect(body.confirmation).toBeUndefined();
    });
  });
});
