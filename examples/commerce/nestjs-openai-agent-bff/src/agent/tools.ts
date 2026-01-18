import { z } from 'zod';
import type { McpState, ToolContext } from '../session/sessionTypes.js';
import {
  createProductSearchHandler,
  createProductGetHandler,
  type ToolHandlerDependencies,
  type ProductSearchArgs,
  type ProductGetArgs,
} from './toolHandlers.js';
import {
  cartGetLlmSchema,
  cartAddItemLlmSchema,
  cartSetItemQuantityLlmSchema,
  cartRemoveItemLlmSchema,
  type CartGetArgs,
  type CartAddItemArgs,
  type CartSetItemQuantityArgs,
  type CartRemoveItemArgs,
} from './cart/cartSchemas.js';
import {
  createCartGetHandler,
  createCartAddItemHandler,
  createCartSetItemQuantityHandler,
  createCartRemoveItemHandler,
} from './cart/cartHandlers.js';

/**
 * Context schema for Norce API calls.
 * Contains tenant-specific data that is passed through unchanged to MCP tool arguments.
 * 
 * IMPORTANT: This schema is used for runtime validation only.
 * Context is NEVER exposed to the LLM - it is caller-owned and injected server-side.
 */
export const contextSchema = z.object({
  cultureCode: z.string().optional().describe('Culture code (e.g., "sv-SE")'),
  currencyCode: z.string().optional().describe('Currency code (e.g., "SEK")'),
  priceListIds: z.array(z.number()).optional().describe('Price list IDs'),
  salesAreaId: z.number().optional().describe('Sales area ID'),
  customerId: z.number().optional().describe('Customer ID'),
  companyId: z.number().optional().describe('Company ID'),
});

/**
 * LLM args schema for product_search (exposed to OpenAI).
 * IMPORTANT: Does NOT include context - context is caller-owned and injected server-side.
 */
export const productSearchLlmSchema = z.object({
  query: z.string().describe('Search query for products'),
  filters: z.record(z.string(), z.unknown()).optional().describe('Optional filters for the search'),
  pageSize: z.number().optional().describe('Number of results to return'),
});

/**
 * Full schema for product_search including context (for runtime validation).
 * @deprecated Use productSearchLlmSchema for OpenAI tool definitions.
 */
export const productSearchSchema = z.object({
  query: z.string().describe('Search query for products'),
  filters: z.record(z.string(), z.unknown()).optional().describe('Optional filters for the search'),
  pageSize: z.number().optional().describe('Number of results to return'),
  context: contextSchema.optional().describe('Context object with tenant-specific data'),
});

/**
 * LLM args schema for product_get (exposed to OpenAI).
 * IMPORTANT: Does NOT include context - context is caller-owned and injected server-side.
 * Uses z.coerce.string() to accept productId as string or number (coerced to string).
 * Requires either productId or partNo to be provided.
 */
export const productGetLlmSchema = z.object({
  productId: z.coerce.string().optional().describe('Product ID to retrieve (accepts string or number)'),
  partNo: z.string().optional().describe('Part number to retrieve'),
}).refine(
  (data) => data.productId !== undefined || data.partNo !== undefined,
  { message: 'Either productId or partNo must be provided' }
);

/**
 * Full schema for product_get including context (for runtime validation).
 * @deprecated Use productGetLlmSchema for OpenAI tool definitions.
 */
export const productGetSchema = z.object({
  productId: z.coerce.string().optional().describe('Product ID to retrieve (accepts string or number)'),
  partNo: z.string().optional().describe('Part number to retrieve'),
  context: contextSchema.optional().describe('Context object with tenant-specific data'),
}).refine(
  (data) => data.productId !== undefined || data.partNo !== undefined,
  { message: 'Either productId or partNo must be provided' }
);

/**
 * Tool interface for OpenAI function calling.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => Promise<unknown>;
}

/**
 * Creates the agent tools for product and cart operations.
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Array of Tool definitions
 */
export function createTools(deps: ToolHandlerDependencies): Tool[] {
  const productSearchHandler = createProductSearchHandler(deps);
  const productGetHandler = createProductGetHandler(deps);
  const cartGetHandler = createCartGetHandler(deps);
  const cartAddItemHandler = createCartAddItemHandler(deps);
  const cartSetItemQuantityHandler = createCartSetItemQuantityHandler(deps);
  const cartRemoveItemHandler = createCartRemoveItemHandler(deps);

  return [
    {
      name: 'product_search',
      description:
        'Search for products in the Norce catalog. Use this to find products matching a query. ' +
        'Start broad and narrow down results. Show 3-6 products max to the user.',
      parameters: productSearchLlmSchema,
      execute: async (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => {
        return await productSearchHandler(params as ProductSearchArgs, mcpState, context, applicationId);
      },
    },
    {
      name: 'product_get',
      description:
        'Get detailed information about a specific product by ID or part number. ' +
        'Use this only for 1-3 finalist products after narrowing down search results. ' +
        'Prefer using productId values from product_search results. ' +
        'If the ID is numeric, pass it as a string (e.g., "123" not 123).',
      parameters: productGetLlmSchema,
      execute: async (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => {
        return await productGetHandler(params as ProductGetArgs, mcpState, context, applicationId);
      },
    },
    {
      name: 'cart_get',
      description:
        'Get the current cart contents. Returns cart items with quantities, prices, and totals.',
      parameters: cartGetLlmSchema,
      execute: async (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => {
        return await cartGetHandler(params as CartGetArgs, mcpState, context, applicationId);
      },
    },
    {
      name: 'cart_add_item',
      description:
        'Add a product to the cart. Requires productId and optional quantity (defaults to 1). ' +
        'If the ID is numeric, pass it as a string (e.g., "123" not 123).',
      parameters: cartAddItemLlmSchema,
      execute: async (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => {
        return await cartAddItemHandler(params as CartAddItemArgs, mcpState, context, applicationId);
      },
    },
    {
      name: 'cart_set_item_quantity',
      description:
        'Set the quantity of an item in the cart. Requires productId and quantity. ' +
        'If the ID is numeric, pass it as a string (e.g., "123" not 123).',
      parameters: cartSetItemQuantityLlmSchema,
      execute: async (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => {
        return await cartSetItemQuantityHandler(params as CartSetItemQuantityArgs, mcpState, context, applicationId);
      },
    },
    {
      name: 'cart_remove_item',
      description:
        'Remove an item from the cart. Requires productId. ' +
        'If the ID is numeric, pass it as a string (e.g., "123" not 123).',
      parameters: cartRemoveItemLlmSchema,
      execute: async (params: unknown, mcpState: McpState, context?: ToolContext, applicationId?: string) => {
        return await cartRemoveItemHandler(params as CartRemoveItemArgs, mcpState, context, applicationId);
      },
    },
  ];
}
