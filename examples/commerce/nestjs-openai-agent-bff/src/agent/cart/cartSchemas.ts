import { z } from 'zod';

/**
 * Context schema for Norce API calls.
 * Contains tenant-specific data that is passed through unchanged to MCP tool arguments.
 * Matches the contextSchema in tools.ts for consistency.
 * 
 * IMPORTANT: This schema is used for runtime validation only.
 * Context is NEVER exposed to the LLM - it is caller-owned and injected server-side.
 */
export const cartContextSchema = z.object({
  cultureCode: z.string().optional().describe('Culture code (e.g., "sv-SE")'),
  currencyCode: z.string().optional().describe('Currency code (e.g., "SEK")'),
  priceListIds: z.array(z.number()).optional().describe('Price list IDs'),
  salesAreaId: z.number().optional().describe('Sales area ID'),
  customerId: z.number().optional().describe('Customer ID'),
  companyId: z.number().optional().describe('Company ID'),
});

/**
 * LLM args schema for cart_get (exposed to OpenAI).
 * IMPORTANT: Does NOT include context - context is caller-owned and injected server-side.
 */
export const cartGetLlmSchema = z.object({});

/**
 * Full schema for cart_get including context (for runtime validation).
 * @deprecated Use cartGetLlmSchema for OpenAI tool definitions.
 */
export const cartGetSchema = z.object({
  context: cartContextSchema.optional().describe('Context object with tenant-specific data'),
});

/**
 * LLM args schema for cart_add_item (exposed to OpenAI).
 * IMPORTANT: Does NOT include context - context is caller-owned and injected server-side.
 * Uses z.coerce.string() to accept partNo as string or number (coerced to string).
 * Uses z.coerce.number() to accept quantity as string or number (coerced to number).
 * 
 * NOTE: MCP cart.addItem expects partNo (not productId) as the item identifier.
 */
export const cartAddItemLlmSchema = z.object({
  partNo: z.coerce.string().min(1).describe('Part number of the item to add to cart (variant partNo)'),
  quantity: z.coerce.number().default(1).describe('Quantity to add (defaults to 1)'),
}).refine(
  (data) => data.quantity > 0,
  { message: 'Quantity must be greater than 0', path: ['quantity'] }
);

/**
 * Full schema for cart_add_item including context (for runtime validation).
 * @deprecated Use cartAddItemLlmSchema for OpenAI tool definitions.
 * 
 * NOTE: MCP cart.addItem expects partNo (not productId) as the item identifier.
 */
export const cartAddItemSchema = z.object({
  partNo: z.coerce.string().min(1).describe('Part number of the item to add to cart (variant partNo)'),
  quantity: z.coerce.number().default(1).describe('Quantity to add (defaults to 1)'),
  context: cartContextSchema.optional().describe('Context object with tenant-specific data'),
}).refine(
  (data) => data.quantity > 0,
  { message: 'Quantity must be greater than 0', path: ['quantity'] }
);

/**
 * LLM args schema for cart_set_item_quantity (exposed to OpenAI).
 * IMPORTANT: Does NOT include context - context is caller-owned and injected server-side.
 * Uses z.coerce.string() to accept productId as string or number (coerced to string).
 * Uses z.coerce.number() to accept quantity as string or number (coerced to number).
 */
export const cartSetItemQuantityLlmSchema = z.object({
  productId: z.coerce.string().describe('Product ID to update in cart (accepts string or number)'),
  quantity: z.coerce.number().describe('New quantity for the item'),
}).refine(
  (data) => data.quantity > 0,
  { message: 'Quantity must be greater than 0', path: ['quantity'] }
);

/**
 * Full schema for cart_set_item_quantity including context (for runtime validation).
 * @deprecated Use cartSetItemQuantityLlmSchema for OpenAI tool definitions.
 */
export const cartSetItemQuantitySchema = z.object({
  productId: z.coerce.string().describe('Product ID to update in cart (accepts string or number)'),
  quantity: z.coerce.number().describe('New quantity for the item'),
  context: cartContextSchema.optional().describe('Context object with tenant-specific data'),
}).refine(
  (data) => data.quantity > 0,
  { message: 'Quantity must be greater than 0', path: ['quantity'] }
);

/**
 * LLM args schema for cart_remove_item (exposed to OpenAI).
 * IMPORTANT: Does NOT include context - context is caller-owned and injected server-side.
 * Uses z.coerce.string() to accept productId as string or number (coerced to string).
 */
export const cartRemoveItemLlmSchema = z.object({
  productId: z.coerce.string().describe('Product ID to remove from cart (accepts string or number)'),
});

/**
 * Full schema for cart_remove_item including context (for runtime validation).
 * @deprecated Use cartRemoveItemLlmSchema for OpenAI tool definitions.
 */
export const cartRemoveItemSchema = z.object({
  productId: z.coerce.string().describe('Product ID to remove from cart (accepts string or number)'),
  context: cartContextSchema.optional().describe('Context object with tenant-specific data'),
});

/**
 * Type definitions inferred from schemas.
 */
export type CartGetArgs = z.infer<typeof cartGetSchema>;
export type CartAddItemArgs = z.infer<typeof cartAddItemSchema>;
export type CartSetItemQuantityArgs = z.infer<typeof cartSetItemQuantitySchema>;
export type CartRemoveItemArgs = z.infer<typeof cartRemoveItemSchema>;
