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
      partNo: z.coerce.string(),
      quantity: z.coerce.number().optional().default(1),
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

function createMockProductGetTool(): Tool {
  return {
    name: 'product_get',
    description: 'Get product details',
    parameters: z.object({
      productId: z.string().optional(),
      partNo: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn(),
  };
}

const mockProductWithMultipleVariants = {
  normalized: {
    productId: 'parent-123',
    name: 'Bear Slippers',
    isBuyable: false,
    variants: [
      {
        variantProductId: 'variant-1',
        name: 'Bear Slippers - Size 22-23',
        isBuyable: true,
        onHand: { value: 5, isActive: true },
        dimensions: [{ name: 'Size', value: '22-23 EU', isPrimary: true }],
        dimsMap: { Size: '22-23 EU' },
        label: 'Size: 22-23 EU (in stock: 5)',
        partNo: 'BEAR-22-23',
      },
      {
        variantProductId: 'variant-2',
        name: 'Bear Slippers - Size 24-25',
        isBuyable: true,
        onHand: { value: 3, isActive: true },
        dimensions: [{ name: 'Size', value: '24-25 EU', isPrimary: true }],
        dimsMap: { Size: '24-25 EU' },
        label: 'Size: 24-25 EU (in stock: 3)',
        partNo: 'BEAR-24-25',
      },
      {
        variantProductId: 'variant-3',
        name: 'Bear Slippers - Size 26-27',
        isBuyable: true,
        onHand: { value: 0, isActive: true },
        dimensions: [{ name: 'Size', value: '26-27 EU', isPrimary: true }],
        dimsMap: { Size: '26-27 EU' },
        label: 'Size: 26-27 EU (out of stock)',
        partNo: 'BEAR-26-27',
      },
    ],
  },
  variantSummary: {
    buyableVariantCount: 3,
    inStockBuyableVariantCount: 2,
    availableDimensionValues: { Size: ['22-23 EU', '24-25 EU', '26-27 EU'] },
  },
};

const mockProductWithSingleVariant = {
  normalized: {
    productId: 'parent-456',
    name: 'Simple Product',
    isBuyable: false,
    variants: [
      {
        variantProductId: 'variant-single',
        name: 'Simple Product - Default',
        isBuyable: true,
        onHand: { value: 10, isActive: true },
        dimensions: [],
        dimsMap: {},
        label: 'Default (in stock: 10)',
        partNo: 'SIMPLE-001',
      },
    ],
  },
  variantSummary: {
    buyableVariantCount: 1,
    inStockBuyableVariantCount: 1,
    availableDimensionValues: {},
  },
};

const mockProductNotBuyable = {
  normalized: {
    productId: 'parent-789',
    name: 'Discontinued Product',
    isBuyable: false,
    variants: [
      {
        variantProductId: 'variant-discontinued',
        name: 'Discontinued Product - Default',
        isBuyable: false,
        onHand: { value: 0, isActive: false },
        dimensions: [],
        dimsMap: {},
        label: 'Default (out of stock)',
        partNo: 'DISC-001',
      },
    ],
  },
  variantSummary: {
    buyableVariantCount: 0,
    inStockBuyableVariantCount: 0,
    availableDimensionValues: {},
  },
};

describe('Variant-Aware Cart Operations', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockCartAddTool: Tool;
  let mockCartGetTool: Tool;
  let mockProductSearchTool: Tool;
  let mockProductGetTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockCartAddTool = createMockCartAddTool();
    mockCartGetTool = createMockCartGetTool();
    mockProductSearchTool = createMockProductSearchTool();
    mockProductGetTool = createMockProductGetTool();

    agentRunner = new AgentRunner({
      tools: [
        mockCartAddTool,
        mockCartGetTool,
        mockProductSearchTool,
        mockProductGetTool,
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

  describe('Case 1: Multiple buyable variants - asks for disambiguation', () => {
    it('should ask for variant selection when product has multiple buyable variants', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;
      const productGetExecute = mockProductGetTool.execute as ReturnType<typeof vi.fn>;

      productGetExecute.mockResolvedValueOnce(mockProductWithMultipleVariants);

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_1',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'parent-123' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_add_1',
              name: 'cart_add_item',
              // NOTE: cart_add_item now expects partNo, not productId
              // Using parent partNo which is empty, triggering variant preflight
              arguments: JSON.stringify({ partNo: '', quantity: 1 }),
            },
          ],
          finishReason: 'tool_calls',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-1',
          message: 'add the bear slippers to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      expect(body.text).toContain('variant');
      expect(body.text).toMatch(/1\)/);
      expect(body.text).toMatch(/2\)/);

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();

      const sessionKey = 'demo:variant-test-1';
      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session).not.toBeNull();
      expect(session.workingMemory?.variantChoices).toBeDefined();
      expect(session.workingMemory?.variantChoices?.length).toBeGreaterThan(1);
      expect(session.workingMemory?.variantChoicesParentProductId).toBe('parent-123');

      expect(session.pendingAction).toBeUndefined();
    });
  });

  describe('Case 2: User picks variant with option index', () => {
    it('should create pendingAction when user selects variant with "option 3"', async () => {
      const sessionKey = 'demo:variant-test-2';
      const initialSession: SessionState = {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: Date.now(),
        expiresAt: Date.now() + 1800000,
        workingMemory: {
          variantChoices: [
            {
              index: 1,
              variantProductId: 'variant-1',
              label: 'Size: 22-23 EU (in stock: 5)',
              dimsMap: { Size: '22-23 EU' },
              onHand: 5,
              isBuyable: true,
              partNo: 'BEAR-22-23',
            },
            {
              index: 2,
              variantProductId: 'variant-2',
              label: 'Size: 24-25 EU (in stock: 3)',
              dimsMap: { Size: '24-25 EU' },
              onHand: 3,
              isBuyable: true,
              partNo: 'BEAR-24-25',
            },
            {
              index: 3,
              variantProductId: 'variant-3',
              label: 'Size: 26-27 EU (out of stock)',
              dimsMap: { Size: '26-27 EU' },
              onHand: 0,
              isBuyable: true,
              partNo: 'BEAR-26-27',
            },
          ],
          variantChoicesParentProductId: 'parent-123',
        },
      };
      await sessionStore.set(sessionKey, initialSession);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-2',
          message: 'option 3',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Swedish localized confirmation prompt
      expect(body.text).toContain('varukorg');
      expect(body.text).toContain('Vill du att jag fortsätter');

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();

      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_add_item');
      expect(session.pendingAction?.args.partNo).toBe('BEAR-26-27');
    });

    it('should create pendingAction when user selects variant with "#2"', async () => {
      const sessionKey = 'demo:variant-test-hash';
      const initialSession: SessionState = {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: Date.now(),
        expiresAt: Date.now() + 1800000,
        workingMemory: {
          variantChoices: [
            {
              index: 1,
              variantProductId: 'variant-1',
              label: 'Size: 22-23 EU (in stock: 5)',
              dimsMap: { Size: '22-23 EU' },
              onHand: 5,
              isBuyable: true,
              partNo: 'BEAR-22-23',
            },
            {
              index: 2,
              variantProductId: 'variant-2',
              label: 'Size: 24-25 EU (in stock: 3)',
              dimsMap: { Size: '24-25 EU' },
              onHand: 3,
              isBuyable: true,
              partNo: 'BEAR-24-25',
            },
          ],
          variantChoicesParentProductId: 'parent-123',
        },
      };
      await sessionStore.set(sessionKey, initialSession);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-hash',
          message: '#2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      // Swedish localized confirmation prompt
      expect(body.text).toContain('varukorg');

      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.args.partNo).toBeDefined();
    });

    it('should create pendingAction when user selects variant with just "2"', async () => {
      const sessionKey = 'demo:variant-test-number';
      const initialSession: SessionState = {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: Date.now(),
        expiresAt: Date.now() + 1800000,
        workingMemory: {
          variantChoices: [
            {
              index: 1,
              variantProductId: 'variant-1',
              label: 'Size: 22-23 EU (in stock: 5)',
              dimsMap: { Size: '22-23 EU' },
              onHand: 5,
              isBuyable: true,
              partNo: 'BEAR-22-23',
            },
            {
              index: 2,
              variantProductId: 'variant-2',
              label: 'Size: 24-25 EU (in stock: 3)',
              dimsMap: { Size: '24-25 EU' },
              onHand: 3,
              isBuyable: true,
              partNo: 'BEAR-24-25',
            },
          ],
          variantChoicesParentProductId: 'parent-123',
        },
      };
      await sessionStore.set(sessionKey, initialSession);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-number',
          message: '2',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.args.partNo).toBeDefined();
    });
  });

  describe('Case 3: Confirm executes with variantProductId', () => {
    it('should execute cart.addItem with variantProductId when user confirms', async () => {
      const sessionKey = 'demo:variant-test-3';
      const initialSession: SessionState = {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: Date.now(),
        expiresAt: Date.now() + 1800000,
        pendingAction: {
          id: 'test-pending-action-id',
          kind: 'cart_add_item',
          args: { partNo: 'BEAR-26-27', quantity: 1 },
          createdAt: Date.now(),
          status: 'pending',
        },
      };
      await sessionStore.set(sessionKey, initialSession);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-3',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      // Swedish localized completion message
      expect(body.text).toContain('Klart');

      expect(mockCartAddTool.execute).toHaveBeenCalledTimes(1);
      expect(mockCartAddTool.execute).toHaveBeenCalledWith(
        { partNo: 'BEAR-26-27', quantity: 1 },
        expect.anything(),
        expect.anything(),
        'demo'
      );

      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.status).toBe('consumed');
      expect(session.pendingAction?.consumedAt).toBeDefined();
    });
  });

  describe('Case 4: Single buyable variant goes straight to confirmation', () => {
    it('should create pendingAction directly when product has exactly 1 buyable variant', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;
      const productGetExecute = mockProductGetTool.execute as ReturnType<typeof vi.fn>;

      productGetExecute.mockResolvedValueOnce(mockProductWithSingleVariant);

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_2',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'parent-456' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_add_2',
              name: 'cart_add_item',
              // NOTE: cart_add_item now expects partNo, not productId
              // Using empty partNo to trigger variant preflight which will find the single variant
              arguments: JSON.stringify({ partNo: '', quantity: 1 }),
            },
          ],
          finishReason: 'tool_calls',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-4',
          message: 'add the simple product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      // Swedish localized confirmation prompt
      expect(body.text).toContain('varukorg');
      expect(body.text).toContain('Vill du att jag fortsätter');

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();

      const sessionKey = 'demo:variant-test-4';
      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.kind).toBe('cart_add_item');
      expect(session.pendingAction?.args.partNo).toBe('SIMPLE-001');
    });
  });

  describe('Case 5: Not buyable product returns error', () => {
    it('should return error message when product has no buyable variants', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;
      const productGetExecute = mockProductGetTool.execute as ReturnType<typeof vi.fn>;

      productGetExecute.mockResolvedValueOnce(mockProductNotBuyable);

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_get_3',
              name: 'product_get',
              arguments: JSON.stringify({ productId: 'parent-789' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_add_3',
              name: 'cart_add_item',
              // NOTE: cart_add_item now expects partNo, not productId
              // Using empty partNo to trigger variant preflight which will find no buyable variants
              arguments: JSON.stringify({ partNo: '', quantity: 1 }),
            },
          ],
          finishReason: 'tool_calls',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-5',
          message: 'add the discontinued product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);

      expect(body.text.toLowerCase()).toMatch(/not.*buyable|no.*buyable|not.*available/);

      expect(mockCartAddTool.execute).not.toHaveBeenCalled();

      const sessionKey = 'demo:variant-test-5';
      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeUndefined();
    });
  });

  describe('Variant choice resolution with explicit identifiers', () => {
    it('should resolve variant by partNo', async () => {
      const sessionKey = 'demo:variant-test-partno';
      const initialSession: SessionState = {
        conversation: [],
        mcp: { nextRpcId: 1 },
        updatedAt: Date.now(),
        expiresAt: Date.now() + 1800000,
        workingMemory: {
          variantChoices: [
            {
              index: 1,
              variantProductId: 'variant-1',
              label: 'Size: 22-23 EU (in stock: 5)',
              dimsMap: { Size: '22-23 EU' },
              onHand: 5,
              isBuyable: true,
              partNo: 'BEAR-22-23',
            },
            {
              index: 2,
              variantProductId: 'variant-2',
              label: 'Size: 24-25 EU (in stock: 3)',
              dimsMap: { Size: '24-25 EU' },
              onHand: 3,
              isBuyable: true,
              partNo: 'BEAR-24-25',
            },
          ],
          variantChoicesParentProductId: 'parent-123',
        },
      };
      await sessionStore.set(sessionKey, initialSession);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'variant-test-partno',
          message: 'BEAR-24-25',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);

      const session = (await sessionStore.get(sessionKey)) as SessionState;
      expect(session.pendingAction).toBeDefined();
      expect(session.pendingAction?.args.partNo).toBeDefined();
    });
  });
});
