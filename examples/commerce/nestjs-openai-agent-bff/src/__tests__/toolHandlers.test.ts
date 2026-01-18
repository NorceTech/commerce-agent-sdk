import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProductSearchHandler,
  createProductGetHandler,
  type ToolHandlerDependencies,
  type ProductSearchArgs,
  type ProductGetArgs,
} from '../agent/toolHandlers.js';
import type { McpState } from '../session/sessionTypes.js';
import { config } from '../config.js';

vi.mock('../config.js', () => ({
  config: {
    norce: {
      mcp: {
        statusSeed: '',
      },
    },
  },
}));

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
    asDeps: () => ({ tokenProvider, mcpClient }) as unknown as ToolHandlerDependencies,
  };
}

function createMcpState(): McpState {
  return {
    sessionId: undefined,
    nextRpcId: 1,
  };
}

describe('toolHandlers', () => {
  describe('createProductSearchHandler', () => {
    let mockDeps: ReturnType<typeof createMockDependencies>;
    let mcpState: McpState;

    beforeEach(() => {
      mockDeps = createMockDependencies();
      mcpState = createMcpState();
    });

    it('should fetch token via tokenProvider before calling MCP', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const args: ProductSearchArgs = {
        query: 'test query',
        context: { cultureCode: 'sv-SE' },
      };

      await handler(args, mcpState, undefined, 'test-app-id');

      expect(mockDeps.tokenProvider.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should call MCP client with correct tool name "product.search"', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const args: ProductSearchArgs = {
        query: 'laptop',
        context: { cultureCode: 'en-US' },
      };

      await handler(args, mcpState, undefined, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'product.search',
        expect.any(Object),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should inject httpContext into MCP tool arguments (caller-owned context)', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const httpContext = {
        cultureCode: 'sv-SE',
        currencyCode: 'SEK',
        priceListIds: [1, 2],
        salesAreaId: 10,
        customerId: 12345,
        companyId: 123,
      };
      const args: ProductSearchArgs = {
        query: 'dining table',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'product.search',
        expect.objectContaining({
          query: 'dining table',
          context: httpContext,
        }),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should include filters and pageSize when provided', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: ProductSearchArgs = {
        query: 'chair',
        filters: { category: 'furniture' },
        pageSize: 5,
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'product.search',
        {
          query: 'chair',
          filters: { category: 'furniture' },
          pageSize: 5,
          context: { cultureCode: 'sv-SE' },
        },
        'test-access-token',
        'test-app-id'
      );
    });

    it('should return normalized result with stable JSON shape', async () => {
      mockDeps.mcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { id: '1', name: 'Product 1' },
                { id: '2', name: 'Product 2' },
              ],
              totalCount: 2,
            }),
          },
        ],
      });

      const handler = createProductSearchHandler(mockDeps.asDeps());
      const httpContext = {};
      const args: ProductSearchArgs = {
        query: 'test',
      };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      expect(result.items).toEqual([
        { id: '1', name: 'Product 1', availability: { status: 'unknown' } },
        { id: '2', name: 'Product 2', availability: { status: 'unknown' } },
      ]);
      expect(result.totalCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.cards).toEqual([
        { productId: '1', title: 'Product 1', availability: { status: 'unknown' } },
        { productId: '2', title: 'Product 2', availability: { status: 'unknown' } },
      ]);
    });

    it('should truncate results when more than 10 items', async () => {
      const manyItems = Array.from({ length: 15 }, (_, i) => ({
        id: String(i + 1),
        name: `Product ${i + 1}`,
      }));

      mockDeps.mcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ items: manyItems, totalCount: 15 }),
          },
        ],
      });

      const handler = createProductSearchHandler(mockDeps.asDeps());
      const httpContext = {};
      const args: ProductSearchArgs = {
        query: 'test',
      };

      const result = await handler(args, mcpState, httpContext, 'test-app-id') as { items: unknown[]; truncated: boolean; totalCount: number };

      expect(result.items).toHaveLength(10);
      expect(result.truncated).toBe(true);
      expect(result.totalCount).toBe(15);
    });

    it('should omit context from MCP args when context is undefined (defensive coding)', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const args: ProductSearchArgs = {
        query: 'test query',
      };

      await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.query).toBe('test query');
      expect(callArgs).not.toHaveProperty('context');
    });

    it('should use httpContext when provided, ignoring any args.context (caller-owned context)', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const argsContext = { cultureCode: 'en-US', currencyCode: 'USD' };
      const httpContext = { cultureCode: 'sv-SE', currencyCode: 'SEK' };
      const args: ProductSearchArgs = {
        query: 'test query',
        context: argsContext,
      };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // Should use httpContext, not args.context
      expect(callArgs.context).toEqual(httpContext);
      // Should flag that model context was ignored
      expect(result.contextInjection?.modelContextIgnored).toBe(true);
      expect(result.contextInjection?.effectiveContext).toEqual(httpContext);
    });

    it('should ignore model-provided context even when httpContext is undefined (no guessing)', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const argsContext = { cultureCode: 'en-US', currencyCode: 'USD' };
      const args: ProductSearchArgs = {
        query: 'test query',
        context: argsContext,
      };

      const result = await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // Should NOT use model-provided context, should omit entirely
      expect(callArgs).not.toHaveProperty('context');
      // Should flag that model context was ignored
      expect(result.contextInjection?.modelContextIgnored).toBe(true);
      expect(result.contextInjection?.effectiveContext).toBeUndefined();
    });

    it('should not crash when context is missing at runtime', async () => {
      const handler = createProductSearchHandler(mockDeps.asDeps());
      const args = {
        query: 'test query',
      } as ProductSearchArgs;

      await expect(handler(args, mcpState, undefined, 'test-app-id')).resolves.not.toThrow();
    });

    describe('query simplification', () => {
      it('should simplify complex queries before calling MCP', async () => {
        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'slippers men 30-31 EU brown in stock',
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        // Should simplify to just "slippers" (dropping size, gender, color, stock terms)
        expect(callArgs.query).toBe('slippers');
      });

      it('should include querySimplification metadata in result', async () => {
        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'slippers men 30-31',
        };

        const result = await handler(args, mcpState, undefined, 'test-app-id');

        expect(result.querySimplification).toBeDefined();
        expect(result.querySimplification?.originalQuery).toBe('slippers men 30-31');
        expect(result.querySimplification?.effectiveQuery).toBe('slippers');
        expect(result.querySimplification?.wasSimplified).toBe(true);
        expect(result.querySimplification?.droppedTokens).toContain('men');
        expect(result.querySimplification?.droppedTokens).toContain('30-31');
      });

      it('should keep simple queries unchanged', async () => {
        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'slippers',
        };

        const result = await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        expect(callArgs.query).toBe('slippers');
        expect(result.querySimplification?.wasSimplified).toBe(false);
      });

      it('should preserve brand names in queries', async () => {
        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'Liewood slippers',
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        expect(callArgs.query).toBe('Liewood slippers');
      });
    });

    describe('fallback broaden logic', () => {
      it('should retry with broader query when search returns 0 results', async () => {
        // First call returns 0 items, second call returns items
        mockDeps.mcpClient.callTool
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify({ items: [], totalCount: 0 }) }],
          })
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify({ items: [{ id: '1', name: 'Product 1' }], totalCount: 1 }) }],
          });

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'bear slippers',
        };

        const result = await handler(args, mcpState, undefined, 'test-app-id');

        // Should have called MCP twice
        expect(mockDeps.mcpClient.callTool).toHaveBeenCalledTimes(2);

        // First call with original simplified query
        const firstCallArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        expect(firstCallArgs.query).toBe('bear slippers');

        // Second call with broadened query (first word only)
        const secondCallArgs = mockDeps.mcpClient.callTool.mock.calls[1][2] as Record<string, unknown>;
        expect(secondCallArgs.query).toBe('bear');

        // Result should include fallback metadata
        expect(result.querySimplification?.fallbackRetryAttempted).toBe(true);
        expect(result.querySimplification?.broadenedQuery).toBe('bear');

        // Should return results from second call
        expect(result.items).toHaveLength(1);
      });

      it('should not retry when query is already single word', async () => {
        mockDeps.mcpClient.callTool.mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify({ items: [], totalCount: 0 }) }],
        });

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'slippers',
        };

        const result = await handler(args, mcpState, undefined, 'test-app-id');

        // Should only call MCP once (no retry for single-word query)
        expect(mockDeps.mcpClient.callTool).toHaveBeenCalledTimes(1);
        expect(result.querySimplification?.fallbackRetryAttempted).toBe(false);
        expect(result.querySimplification?.broadenedQuery).toBeUndefined();
      });

      it('should not retry when first search returns results', async () => {
        mockDeps.mcpClient.callTool.mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify({ items: [{ id: '1', name: 'Product 1' }], totalCount: 1 }) }],
        });

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'bear slippers',
        };

        const result = await handler(args, mcpState, undefined, 'test-app-id');

        // Should only call MCP once (no retry needed)
        expect(mockDeps.mcpClient.callTool).toHaveBeenCalledTimes(1);
        expect(result.querySimplification?.fallbackRetryAttempted).toBe(false);
      });
    });

    describe('statusSeed injection', () => {
      afterEach(() => {
        // Reset statusSeed to empty after each test
        (config.norce.mcp as { statusSeed: string }).statusSeed = '';
      });

      it('should omit statusSeed from MCP args when NORCE_STATUS_SEED is empty', async () => {
        (config.norce.mcp as { statusSeed: string }).statusSeed = '';

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'test query',
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        expect(callArgs).not.toHaveProperty('statusSeed');
      });

      it('should pass statusSeed to MCP when NORCE_STATUS_SEED is configured', async () => {
        (config.norce.mcp as { statusSeed: string }).statusSeed = 'in_stock,out_of_stock';

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'test query',
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        expect(callArgs.statusSeed).toBe('in_stock,out_of_stock');
      });

      it('should use env config statusSeed even when LLM provides statusSeed in args (env wins)', async () => {
        (config.norce.mcp as { statusSeed: string }).statusSeed = 'env_status';

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'test query',
          statusSeed: 'llm_status', // LLM tries to override
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        // Env config should win over LLM-provided value
        expect(callArgs.statusSeed).toBe('env_status');
      });

      it('should omit statusSeed when env is empty even if LLM provides it', async () => {
        (config.norce.mcp as { statusSeed: string }).statusSeed = '';

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'test query',
          statusSeed: 'llm_status', // LLM tries to set it
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        // Should not have statusSeed since env is empty (env wins)
        expect(callArgs).not.toHaveProperty('statusSeed');
      });

      it('should include statusSeed in fallback broaden retry when configured', async () => {
        (config.norce.mcp as { statusSeed: string }).statusSeed = 'in_stock';

        // First call returns 0 items, second call returns items
        mockDeps.mcpClient.callTool
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify({ items: [], totalCount: 0 }) }],
          })
          .mockResolvedValueOnce({
            content: [{ type: 'text', text: JSON.stringify({ items: [{ id: '1', name: 'Product 1' }], totalCount: 1 }) }],
          });

        const handler = createProductSearchHandler(mockDeps.asDeps());
        const args: ProductSearchArgs = {
          query: 'bear slippers',
        };

        await handler(args, mcpState, undefined, 'test-app-id');

        // Both calls should include statusSeed
        expect(mockDeps.mcpClient.callTool).toHaveBeenCalledTimes(2);

        const firstCallArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
        expect(firstCallArgs.statusSeed).toBe('in_stock');

        const secondCallArgs = mockDeps.mcpClient.callTool.mock.calls[1][2] as Record<string, unknown>;
        expect(secondCallArgs.statusSeed).toBe('in_stock');
      });
    });
  });

  describe('createProductGetHandler', () => {
    let mockDeps: ReturnType<typeof createMockDependencies>;
    let mcpState: McpState;

    beforeEach(() => {
      mockDeps = createMockDependencies();
      mcpState = createMcpState();
    });

    it('should fetch token via tokenProvider before calling MCP', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: ProductGetArgs = {
        productId: '123',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.tokenProvider.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should call MCP client with correct tool name "product.get"', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'en-US' };
      const args: ProductGetArgs = {
        productId: '456',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'product.get',
        expect.any(Object),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should inject httpContext into MCP tool arguments (caller-owned context)', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = {
        cultureCode: 'sv-SE',
        currencyCode: 'SEK',
        priceListIds: [1],
        salesAreaId: 10,
      };
      const args: ProductGetArgs = {
        productId: '789',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'product.get',
        expect.objectContaining({
          productId: 789, // MCP expects productId as number
          context: httpContext,
        }),
        'test-access-token',
        'test-app-id'
      );
    });

    it('should support partNo instead of productId', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: ProductGetArgs = {
        partNo: 'ABC-123',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      expect(mockDeps.mcpClient.callTool).toHaveBeenCalledWith(
        mcpState,
        'product.get',
        {
          partNo: 'ABC-123',
          context: { cultureCode: 'sv-SE' },
        },
        'test-access-token',
        'test-app-id'
      );
    });

    it('should throw error when neither productId nor partNo is provided', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const args: ProductGetArgs = {};

      await expect(handler(args, mcpState)).rejects.toThrow(
        'Either productId or partNo must be provided'
      );
    });

    it('should return normalized result with stable JSON shape', async () => {
      mockDeps.mcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: '123',
              partNo: 'ABC-123',
              name: 'Test Product',
              description: 'A test product',
              price: { value: 100, currency: 'SEK' },
            }),
          },
        ],
      });

      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = {};
      const args: ProductGetArgs = {
        productId: '123',
      };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      expect(result.raw).toEqual({
        id: '123',
        partNo: 'ABC-123',
        name: 'Test Product',
        description: 'A test product',
        price: { value: 100, currency: 'SEK' },
      });
      expect(result.card).toEqual({
        productId: '123',
        title: 'Test Product',
        subtitle: 'A test product',
        price: '100',
        currency: 'SEK',
      });
    });

    it('should return null raw and card for empty or invalid result', async () => {
      mockDeps.mcpClient.callTool.mockResolvedValue(null);

      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = {};
      const args: ProductGetArgs = {
        productId: '123',
      };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      expect(result.raw).toBeNull();
      expect(result.card).toBeNull();
    });

    it('should omit context from MCP args when context is undefined (defensive coding)', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const args: ProductGetArgs = {
        productId: '123',
      };

      await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs.productId).toBe(123); // MCP expects productId as number
      expect(callArgs).not.toHaveProperty('context');
    });

    it('should use httpContext when provided, ignoring any args.context (caller-owned context)', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const argsContext = { cultureCode: 'en-US', currencyCode: 'USD' };
      const httpContext = { cultureCode: 'sv-SE', currencyCode: 'SEK' };
      const args: ProductGetArgs = {
        productId: '123',
        context: argsContext,
      };

      const result = await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // Should use httpContext, not args.context
      expect(callArgs.context).toEqual(httpContext);
      // Should flag that model context was ignored
      expect(result.contextInjection?.modelContextIgnored).toBe(true);
      expect(result.contextInjection?.effectiveContext).toEqual(httpContext);
    });

    it('should ignore model-provided context even when httpContext is undefined (no guessing)', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const argsContext = { cultureCode: 'en-US', currencyCode: 'USD' };
      const args: ProductGetArgs = {
        productId: '123',
        context: argsContext,
      };

      const result = await handler(args, mcpState, undefined, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // Should NOT use model-provided context, should omit entirely
      expect(callArgs).not.toHaveProperty('context');
      // Should flag that model context was ignored
      expect(result.contextInjection?.modelContextIgnored).toBe(true);
      expect(result.contextInjection?.effectiveContext).toBeUndefined();
    });

    it('should not crash when context is missing at runtime', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const args = {
        productId: '123',
      } as ProductGetArgs;

      await expect(handler(args, mcpState, undefined, 'test-app-id')).resolves.not.toThrow();
    });

    it('should convert string productId to number when calling MCP', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: ProductGetArgs = {
        productId: '118936',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // MCP expects productId as number, not string
      expect(callArgs.productId).toBe(118936);
      expect(typeof callArgs.productId).toBe('number');
    });

    it('should keep non-numeric productId as string when calling MCP', async () => {
      const handler = createProductGetHandler(mockDeps.asDeps());
      const httpContext = { cultureCode: 'sv-SE' };
      const args: ProductGetArgs = {
        productId: 'ABC-123',
      };

      await handler(args, mcpState, httpContext, 'test-app-id');

      const callArgs = mockDeps.mcpClient.callTool.mock.calls[0][2] as Record<string, unknown>;
      // Non-numeric IDs should be passed as-is
      expect(callArgs.productId).toBe('ABC-123');
      expect(typeof callArgs.productId).toBe('string');
    });
  });
});
