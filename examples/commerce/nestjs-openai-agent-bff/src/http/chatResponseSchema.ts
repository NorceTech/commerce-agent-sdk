/**
 * Zod schema for the canonical ChatResponse contract.
 * This schema is used to validate responses from both /v1/chat and /v1/chat/stream endpoints.
 * The streaming final event MUST match this schema exactly.
 */

import { z } from 'zod';

/**
 * Tool trace item schema for debugging.
 */
export const toolTraceItemSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  ms: z.number().optional(),
  blockedByPolicy: z.boolean().optional(),
  pendingActionCreated: z.boolean().optional(),
  pendingActionExecuted: z.boolean().optional(),
  effectiveContext: z.object({
    cultureCode: z.string().optional(),
    currencyCode: z.string().optional(),
  }).optional(),
  modelContextIgnored: z.boolean().optional(),
  modelProvidedContextPreview: z.object({
    cultureCode: z.string().optional(),
    currencyCode: z.string().optional(),
  }).optional(),
  querySimplification: z.object({
    originalQuery: z.string(),
    effectiveQuery: z.string(),
    wasSimplified: z.boolean(),
    droppedTokens: z.array(z.string()).optional(),
    fallbackRetryAttempted: z.boolean().optional(),
    broadenedQuery: z.string().optional(),
  }).optional(),
  availabilityCounts: z.object({
    inStockCount: z.number(),
    outOfStockCount: z.number(),
    inactiveCount: z.number(),
    unknownCount: z.number(),
  }).optional(),
  thumbnailsPresentCount: z.number().optional(),
});

/**
 * Debug block schema - only included when debug mode is enabled.
 */
export const debugBlockSchema = z.object({
  requestId: z.string().optional(),
  toolTrace: z.array(toolTraceItemSchema).optional(),
  timings: z.object({
    totalMs: z.number().optional(),
    openaiMs: z.number().optional(),
    mcpMs: z.number().optional(),
  }).optional(),
  compare: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Availability status enum for product-level availability.
 */
export const availabilityStatusSchema = z.enum(['in_stock', 'out_of_stock', 'inactive', 'unknown']);

/**
 * Product availability schema.
 * Includes both product-level status (from product.search onHand) and variant-level data (from product.get).
 */
export const productAvailabilitySchema = z.object({
  /** Product-level availability status derived from onHand data */
  status: availabilityStatusSchema.optional(),
  /** On-hand quantity (product-level) */
  onHandValue: z.number().optional(),
  /** Incoming quantity (product-level) */
  incomingValue: z.number().optional(),
  /** Next delivery date (product-level) */
  nextDeliveryDate: z.string().nullable().optional(),
  /** Lead time in days (product-level) */
  leadtimeDayCount: z.number().optional(),
  /** Number of buyable variants (isBuyable === true) - from product.get */
  buyableVariants: z.number().optional(),
  /** Number of buyable variants that are in stock - from product.get */
  inStockBuyableVariants: z.number().optional(),
});

/**
 * Product card schema for display in the UI.
 */
export const productCardSchema = z.object({
  productId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  /** Variant name from MCP (separate from title for UI flexibility) */
  variantName: z.string().nullable().optional(),
  price: z.string().optional(),
  currency: z.string().optional(),
  imageUrl: z.string().optional(),
  /** Thumbnail image key from product.search for widget thumbnail rendering */
  thumbnailImageKey: z.string().nullable().optional(),
  why: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  availability: productAvailabilitySchema.optional(),
  dimensionHints: z.record(z.string(), z.array(z.string())).optional(),
});

/**
 * Refinement chip schema for filtering/narrowing search results.
 * @deprecated Use refinementActionSchema for structured refinements
 */
export const refinementChipSchema = z.object({
  key: z.string(),
  value: z.string(),
  label: z.string().optional(),
});

// Import refinement action schema from refinementTypes
import { refinementActionSchema } from './refinementTypes.js';
export { refinementActionSchema };

// Import choice schemas from choiceTypes
import { choiceSetSchema as importedChoiceSetSchema, choiceOptionSchema as importedChoiceOptionSchema } from './choiceTypes.js';
export { importedChoiceSetSchema as choiceSetSchemaV2, importedChoiceOptionSchema as choiceOptionSchemaV2 };

/**
 * Comparison price schema.
 */
export const comparisonPriceSchema = z.object({
  amount: z.number().optional(),
  currency: z.string().optional(),
  formatted: z.string().optional(),
});

/**
 * Comparison item schema.
 */
export const comparisonItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  brand: z.string().optional(),
  price: comparisonPriceSchema.optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  highlights: z.array(z.string()).optional(),
  url: z.string().optional(),
});

/**
 * Comparison table schema.
 */
export const comparisonTableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.object({
    feature: z.string(),
    values: z.array(z.string()),
  })),
});

/**
 * Comparison block schema for product comparisons.
 */
export const comparisonBlockSchema = z.object({
  title: z.string(),
  productIds: z.array(z.string()),
  items: z.array(comparisonItemSchema),
  table: comparisonTableSchema.optional(),
});

/**
 * Pending action info schema - included when a cart mutation is awaiting confirmation.
 * The pendingActionId enables idempotent confirmation handling.
 */
export const pendingActionInfoSchema = z.object({
  pendingActionId: z.string().uuid(),
  tool: z.string(),
  description: z.string(),
  createdAt: z.string(),
});

/**
 * Confirmation option style schema.
 */
export const confirmationOptionStyleSchema = z.enum(['primary', 'secondary', 'danger']);

/**
 * Confirmation option schema - represents a button the UI can render.
 */
export const confirmationOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  style: confirmationOptionStyleSchema.optional(),
});

/**
 * Confirmation kind schema - reserved for future extension.
 */
export const confirmationKindSchema = z.literal('cart_confirm');

/**
 * Confirmation block schema - structured confirmation for pending cart actions.
 * Enables UI to render Yes/No buttons while still supporting free-text responses.
 */
export const confirmationBlockSchema = z.object({
  id: z.string().uuid(),
  kind: confirmationKindSchema,
  prompt: z.string(),
  options: z.array(confirmationOptionSchema),
});

/**
 * Cart price schema.
 */
export const cartPriceSchema = z.object({
  amount: z.number().optional(),
  currency: z.string().optional(),
  formatted: z.string().optional(),
});

/**
 * Cart item schema.
 */
export const cartItemSchema = z.object({
  productId: z.string(),
  name: z.string().optional(),
  quantity: z.number(),
  price: cartPriceSchema.optional(),
});

/**
 * Cart totals schema.
 */
export const cartTotalsSchema = z.object({
  subtotal: cartPriceSchema.optional(),
  total: cartPriceSchema.optional(),
});

/**
 * Cart summary schema.
 */
export const cartSummarySchema = z.object({
  cartId: z.string().optional(),
  itemCount: z.number(),
  items: z.array(cartItemSchema),
  totals: cartTotalsSchema.optional(),
});

/**
 * Choice option schema for structured disambiguation.
 * Re-exported from choiceTypes.ts for backward compatibility.
 * @see choiceTypes.ts for the canonical definition
 */
export const choiceOptionSchema = importedChoiceOptionSchema;

/**
 * Choice set schema for structured disambiguation.
 * Re-exported from choiceTypes.ts for backward compatibility.
 * @see choiceTypes.ts for the canonical definition
 */
export const choiceSetSchema = importedChoiceSetSchema;

/**
 * Error envelope schema - stable contract for error responses.
 * The widget can use error.category + retryable to decide "retry vs rephrase" deterministically.
 */
export const errorEnvelopeSchema = z.object({
  category: z.enum(['validation', 'auth', 'upstream', 'policy', 'internal']),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Canonical ChatResponse schema.
 * This is the single source of truth for the response contract.
 * Both /v1/chat and /v1/chat/stream final event MUST conform to this schema.
 */
export const chatResponseSchema = z.object({
  /** Unique identifier for this response turn (UUID v4) */
  turnId: z.string().uuid(),
  /** Session identifier */
  sessionId: z.string(),
  /** Assistant's text response (always present) */
  text: z.string(),
  /** Product cards for display */
  cards: z.array(productCardSchema).optional(),
  /** Comparison block when comparing products */
  comparison: comparisonBlockSchema.optional(),
  /** Cart summary when cart data is available */
  cart: cartSummarySchema.optional(),
  /** Structured refinement actions for widget-renderable buttons */
  refinements: z.array(refinementActionSchema).optional(),
  /** Choice set for user selection (future use) */
  choices: choiceSetSchema.optional(),
  /** Debug information (only when debug mode enabled) */
  debug: debugBlockSchema.optional(),
  /** Pending action info when cart mutation awaits confirmation */
  pendingAction: pendingActionInfoSchema.optional(),
  /** Structured confirmation block for UI to render Yes/No buttons */
  confirmation: confirmationBlockSchema.optional(),
  /** Error envelope (optional, for error responses) */
  error: errorEnvelopeSchema.optional(),
});

/**
 * Type inferred from the Zod schema.
 * Use this type for type-safe response building.
 */
export type ChatResponseSchema = z.infer<typeof chatResponseSchema>;

/**
 * Validates a response object against the ChatResponse schema.
 * Throws ZodError if validation fails.
 * 
 * @param response - The response object to validate
 * @returns The validated response (with type narrowing)
 */
export function validateChatResponse(response: unknown): ChatResponseSchema {
  return chatResponseSchema.parse(response);
}

/**
 * Safely validates a response object against the ChatResponse schema.
 * Returns a result object instead of throwing.
 * 
 * @param response - The response object to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeParseChatResponse(response: unknown) {
  return chatResponseSchema.safeParse(response);
}
