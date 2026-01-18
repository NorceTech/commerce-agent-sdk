import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCartGetHandler,
  createCartAddItemHandler,
  createCartSetItemQuantityHandler,
  createCartRemoveItemHandler,
  normalizeCartResult,
  type CartHandlerDependencies,
} from '../agent/cart/cartHandlers.js';
import type { McpState } from '../session/sessionTypes.js';
import type {
  CartGetArgs,
  CartAddItemArgs,
  CartSetItemQuantityArgs,
  CartRemoveItemArgs,
} from '../agent/cart/cartSchemas.js';

function createMockDependencies() {
  const tokenProvider = {
    getAccessToken: vi.fn().mockResolvedValue('test-access-token'),
  };
  const mcpClient = {
    callTool: vi.fn().mockResolvedValue({ content: [] }),
  };
  return {
    tokenProvider,
    mcpClient,
    asDeps: () => ({ tokenProvider, mcpClient }) as unknown as CartHandlerDependencies,
  };
}

function createMcpState(): McpState {
  return {
    sessionId: undefined,
    nextRpcId: 1,
  };
}

describe('cartHandlers', () => {
  describe('normalizeCartResult', () => {
    it('should return empty cart for null result', () => {
      const result = normalizeCartResult(null);
      expect(result).toEqual({
        itemCount: 0,
        totalQuantity: 0,
        items: [],
      });
    });

    it('should return empty cart for undefined result', () => {
      const result = normalizeCartResult(undefined);
      expect(result).toEqual({
        itemCount: 0,
        totalQuantity: 0,
        items: [],
      });
    });

    it('should normalize cart with items from content array', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              cartId: 'cart-123',
              items: [
                { productId: '1', name: 'Product 1', quantity: 2, unitPrice: '100', currency: 'SEK' },
                { productId: '2', name: 'Product 2', quantity: 1, unitPrice: '200', currency: 'SEK' },
              ],
              subtotal: '400',
              currency: 'SEK',
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.id).toBe('cart-123');
      expect(result.itemCount).toBe(2);
      expect(result.totalQuantity).toBe(3);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        productId: '1',
        name: 'Product 1',
        quantity: 2,
        unitPrice: '100',
        currency: 'SEK',
      });
      expect(result.subtotal).toBe('400');
      expect(result.currency).toBe('SEK');
    });

    it('should normalize cart with lineItems field', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: 'basket-456',
              lineItems: [
                { productId: '1', name: 'Item 1', quantity: 3 },
              ],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.id).toBe('basket-456');
      expect(result.itemCount).toBe(1);
      expect(result.totalQuantity).toBe(3);
    });

    it('should cap items at MAX_CART_ITEMS (20)', () => {
      const manyItems = Array.from({ length: 25 }, (_, i) => ({
        productId: String(i + 1),
        name: `Product ${i + 1}`,
        quantity: 1,
      }));

      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ items: manyItems }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.items).toHaveLength(20);
      expect(result.itemCount).toBe(20);
      expect(result.totalQuantity).toBe(20);
    });

    it('should extract imageUrl as relative URL', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { productId: '1', name: 'Product 1', quantity: 1, imageUrl: '/images/product1.jpg' },
              ],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.items[0].imageUrl).toBe('/images/product1.jpg');
    });

    it('should handle direct items array in result object', () => {
      const mcpResult = {
        items: [
          { productId: '1', name: 'Product 1', quantity: 2 },
        ],
        cartId: 'direct-cart',
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.id).toBe('direct-cart');
      expect(result.items).toHaveLength(1);
    });

    it('should normalize MCP cart.get response with basketId, currencyCode, and items with partNo/lineNo/imageKey', () => {
      // This is the exact format returned by MCP cart.get
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: 1072769,
              currencyCode: 'SEK',
              items: [
                { lineNo: 1, partNo: 'SKU-001', name: 'Test Product', quantity: 1, imageKey: '/images/product1.jpg' },
                { lineNo: 2, partNo: 'SHIPPING', name: 'Shipping Fee', quantity: 1, imageKey: null },
              ],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      // Should extract basketId as string
      expect(result.basketId).toBe('1072769');
      expect(result.id).toBe('1072769');
      expect(result.currency).toBe('SEK');
      
      // Should have 2 items
      expect(result.items).toHaveLength(2);
      expect(result.itemCount).toBe(2);
      expect(result.totalQuantity).toBe(2);
      
      // First item should have partNo as productId and lineNo as lineItemId
      expect(result.items[0].productId).toBe('SKU-001');
      expect(result.items[0].lineItemId).toBe('1');
      expect(result.items[0].name).toBe('Test Product');
      expect(result.items[0].quantity).toBe(1);
      expect(result.items[0].imageUrl).toBe('/images/product1.jpg');
      expect(result.items[0].partNo).toBe('SKU-001');
      
      // Second item (shipping)
      expect(result.items[1].productId).toBe('SHIPPING');
      expect(result.items[1].name).toBe('Shipping Fee');
    });

    it('should extract basketId from numeric basketId field', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: 1072769,
              items: [],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.basketId).toBe('1072769');
    });

    it('should extract basketId from string basketId field', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: '1072769',
              items: [],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.basketId).toBe('1072769');
    });

    it('should extract imageKey as imageUrl (relative URL)', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: 123,
              items: [
                { partNo: 'SKU-001', name: 'Product', quantity: 1, imageKey: '/media/images/product.jpg' },
              ],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      // imageKey should be stored as imageUrl (relative URL, not transformed)
      expect(result.items[0].imageUrl).toBe('/media/images/product.jpg');
    });

    it('should use partNo as productId when productId is not present', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: 123,
              items: [
                { partNo: 'PART-123', name: 'Product', quantity: 2 },
              ],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.items[0].productId).toBe('PART-123');
      expect(result.items[0].partNo).toBe('PART-123');
    });

    it('should extract lineNo as lineItemId', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: 123,
              items: [
                { lineNo: 5, partNo: 'SKU-001', name: 'Product', quantity: 1 },
              ],
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.items[0].lineItemId).toBe('5');
    });

    it('should normalize MCP cart.addItem response with basket wrapper', () => {
      const mcpResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              basketId: 1073000,
              basket: {
                basketId: 1073000,
                currencyCode: 'SEK',
                items: [
                  {
                    lineNo: 1,
                    partNo: '1012446',
                    name: 'Bear Slippers-26-27 EU',
                    quantity: 1,
                    imageKey: '0fc8c262-c5e5-45a1-8508-13a393f7ee36',
                  },
                  {
                    lineNo: 2,
                    partNo: '1000014',
                    name: 'Shipping Fee',
                    quantity: 1,
                    imageKey: null,
                  },
                ],
              },
            }),
          },
        ],
      };

      const result = normalizeCartResult(mcpResult);

      expect(result.basketId).toBe('1073000');
      expect(result.id).toBe('1073000');
      expect(result.currency).toBe('SEK');
      expect(result.items).toHaveLength(2);
      expect(result.itemCount).toBe(2);
      expect(result.totalQuantity).toBe(2);

      expect(result.items[0].productId).toBe('1012446');
      expect(result.items[0].partNo).toBe('1012446');
      expect(result.items[0].lineItemId).toBe('1');
      expect(result.items[0].name).toBe('Bear Slippers-26-27 EU');
      expect(result.items[0].quantity).toBe(1);
      expect(result.items[0].imageUrl).toBe('0fc8c262-c5e5-45a1-8508-13a393f7ee36');

      expect(result.items[1].productId).toBe('1000014');
      expect(result.items[1].partNo).toBe('1000014');
      expect(result.items[1].name).toBe('Shipping Fee');
      expect(result.items[1].quantity).toBe(1);
    });
  });

  describe('createCartGetHandler', () => {
    let mockDeps: ReturnType<typeof createMockDependencies>;
    let mcpState: McpState;

    beforeEach(() => {
      mockDeps = createMockDependencies();
      mcpState = createMcpState();
    });

    it('should return empty cart when no basketId is available', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      const args: CartGetArgs = {};

      const result = await handler(args, mcpState, undefined, 'test-app-id');

      expect(result.cart).toBeDefined();
      expect(result.cart.itemCount).toBe(0);
      expect(result.cart.items).toHaveLength(0);
      // Should not call MCP when no basketId
      expect(mockDeps.mcpClient.callTool).not.toHaveBeenCalled();
      expect(mockDeps.tokenProvider.getAccessToken).not.toHaveBeenCalled();
    });

    it('should fetch token via tokenProvider before calling MCP when basketId is provided', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      const args: CartGetArgs = {};
      // Use numeric basketId - MCP server expects basketId as a number
      const httpContext = { basketId: '1073000' };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.tokenProvider.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should call MCP client with correct tool name "cart.get" and basketId as number', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      const args: CartGetArgs = {};
      // Use numeric basketId - MCP server expects basketId as a number
      const httpContext = { basketId: '1073000' };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'cart.get',
        // basketId should be converted to number for MCP
        expect.objectContaining({ basketId: 1073000 }),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should convert basketId to number in MCP args when provided via httpContext', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      const args: CartGetArgs = {};
      // Use numeric basketId - MCP server expects basketId as a number
      const httpContext = { basketId: '1072945' };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // basketId should be converted to number for MCP
      expect(callArgs.basketId).toBe(1072945);
    });

    it('should pass httpContext through when provided with basketId (caller-owned context)', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      // Use numeric basketId - MCP server expects basketId as a number
      const httpContext = { cultureCode: 'sv-SE', currencyCode: 'SEK', basketId: '1073000' };
      const args: CartGetArgs = {};

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.context).toEqual(httpContext);
    });

    it('should use httpContext when provided, ignoring args.context (caller-owned context)', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      const argsContext = { cultureCode: 'en-US' };
      // Use numeric basketId - MCP server expects basketId as a number
      const httpContext = { cultureCode: 'sv-SE', currencyCode: 'SEK', basketId: '1073000' };
      const args: CartGetArgs = { context: argsContext };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.context).toEqual(httpContext);
      // Should flag that model context was ignored
      expect(result.contextInjection?.modelContextIgnored).toBe(true);
    });

    it('should prefer args.basketId over httpContext.basketId for debug purposes', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      // Use numeric basketIds - MCP server expects basketId as a number
      const httpContext = { basketId: '1072000' };
      const args: CartGetArgs = { basketId: '1073000' } as CartGetArgs & { basketId: string };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // basketId should be converted to number for MCP
      expect(callArgs.basketId).toBe(1073000);
    });

    it('should return normalized cart result when basketId is provided', async () => {
      mockDeps.mcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              cartId: 'cart-123',
              items: [{ productId: '1', name: 'Product 1', quantity: 2 }],
            }),
          },
        ],
      });

      const handler = createCartGetHandler(mockDeps.asDeps());
      const args: CartGetArgs = {};
      // Use numeric basketId - MCP server expects basketId as a number
      const httpContext = { basketId: '1073000' };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      expect(result.cart).toBeDefined();
      expect(result.cart.id).toBe('cart-123');
      expect(result.cart.items).toHaveLength(1);
    });

    it('should return empty cart when basketId is non-numeric string', async () => {
      const handler = createCartGetHandler(mockDeps.asDeps());
      const args: CartGetArgs = {};
      // Non-numeric basketId should be treated as invalid
      const httpContext = { basketId: 'basket-123' };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      expect(result.cart).toBeDefined();
      expect(result.cart.itemCount).toBe(0);
      expect(result.cart.items).toHaveLength(0);
      // Should not call MCP when basketId is invalid
      expect(mockDeps.mcpClient.callTool).not.toHaveBeenCalled();
    });
  });

  describe('createCartAddItemHandler', () => {
    let mockDeps: ReturnType<typeof createMockDependencies>;
    let mcpState: McpState;

    beforeEach(() => {
      mockDeps = createMockDependencies();
      mcpState = createMcpState();
    });

    it('should fetch token via tokenProvider before calling MCP', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 1 };

      await handler(args, mcpState, undefined, 'test-app-id');

      expect(mockDeps.tokenProvider.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should call MCP client with correct tool name "cart.addItem"', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 2 };

      await handler(args, mcpState, undefined, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'cart.addItem',
        expect.objectContaining({
          partNo: 'PART-123',
          quantity: 2,
        }),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should omit context from MCP args when context is undefined', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 1 };

      await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('context');
    });

    it('should pass httpContext through when provided (caller-owned context)', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 1 };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.context).toEqual(httpContext);
    });

    it('should include clientIp from httpContext in MCP args (required for cart.addItem)', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE', clientIp: '192.168.1.100' };
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 1 };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.clientIp).toBe('192.168.1.100');
      expect(callArgs.partNo).toBe('PART-123');
      expect(callArgs.quantity).toBe(1);
    });

    it('should not include clientIp in MCP args when httpContext has no clientIp', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 1 };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('clientIp');
    });

    it('should include clientIp from X-Forwarded-For header (first IP)', async () => {
      const handler = createCartAddItemHandler(mockDeps.asDeps());
      // Simulating clientIp extracted from X-Forwarded-For: "1.1.1.1, 2.2.2.2"
      const httpContext = { clientIp: '1.1.1.1' };
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 1 };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.clientIp).toBe('1.1.1.1');
    });

    it('should return normalized cart result', async () => {
      mockDeps.mcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              cartId: 'cart-123',
              items: [{ productId: '123', name: 'Added Product', quantity: 2 }],
            }),
          },
        ],
      });

      const handler = createCartAddItemHandler(mockDeps.asDeps());
      const args: CartAddItemArgs = { partNo: 'PART-123', quantity: 2 };

      const result = await handler(args, mcpState, undefined, 'test-app-id');

      expect(result.cart).toBeDefined();
      expect(result.cart.items).toHaveLength(1);
      expect(result.cart.items[0].productId).toBe('123');
    });
  });

  describe('createCartSetItemQuantityHandler', () => {
    let mockDeps: ReturnType<typeof createMockDependencies>;
    let mcpState: McpState;

    beforeEach(() => {
      mockDeps = createMockDependencies();
      mcpState = createMcpState();
    });

    it('should call MCP client with correct tool name "cart.setItemQuantity"', async () => {
      const handler = createCartSetItemQuantityHandler(mockDeps.asDeps());
      const args: CartSetItemQuantityArgs = { productId: '123', quantity: 5 };

      await handler(args, mcpState, undefined, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'cart.setItemQuantity',
        expect.objectContaining({
          productId: '123',
          quantity: 5,
        }),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should omit context from MCP args when context is undefined', async () => {
      const handler = createCartSetItemQuantityHandler(mockDeps.asDeps());
      const args: CartSetItemQuantityArgs = { productId: '123', quantity: 3 };

      await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('context');
    });
  });

  describe('createCartRemoveItemHandler', () => {
    let mockDeps: ReturnType<typeof createMockDependencies>;
    let mcpState: McpState;

    beforeEach(() => {
      mockDeps = createMockDependencies();
      mcpState = createMcpState();
    });

    it('should call MCP client with correct tool name "cart.removeItem"', async () => {
      const handler = createCartRemoveItemHandler(mockDeps.asDeps());
      const args: CartRemoveItemArgs = { productId: '123' };

      await handler(args, mcpState, undefined, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'cart.removeItem',
        expect.objectContaining({
          productId: '123',
        }),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should omit context from MCP args when context is undefined', async () => {
      const handler = createCartRemoveItemHandler(mockDeps.asDeps());
      const args: CartRemoveItemArgs = { productId: '123' };

      await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('context');
    });

    it('should return normalized cart result after removal', async () => {
      mockDeps.mcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              cartId: 'cart-123',
              items: [],
            }),
          },
        ],
      });

      const handler = createCartRemoveItemHandler(mockDeps.asDeps());
      const args: CartRemoveItemArgs = { productId: '123' };

      const result = await handler(args, mcpState, undefined, 'test-app-id');

      expect(result.cart).toBeDefined();
      expect(result.cart.items).toHaveLength(0);
      expect(result.cart.itemCount).toBe(0);
    });
  });
});
