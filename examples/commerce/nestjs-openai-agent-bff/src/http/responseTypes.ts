/**
 * Response types for the /v1/chat endpoint.
 * These types define the structured response contract for widget-ready API payloads.
 */

/**
 * A single item in the tool trace for debugging.
 */
export interface ToolTraceItem {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  ms?: number;
  blockedByPolicy?: boolean;
  pendingActionCreated?: boolean;
  pendingActionExecuted?: boolean;
  /** The effective context used for the MCP call (caller-owned, not model-provided) */
  effectiveContext?: { cultureCode?: string; currencyCode?: string };
  /** True if the model tried to provide context that was ignored */
  modelContextIgnored?: boolean;
  /** Safe preview of what the model tried to provide (if ignored) */
  modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
  /** Query simplification metadata for product_search (originalQuery, effectiveQuery, fallback attempts) */
  querySimplification?: {
    originalQuery: string;
    effectiveQuery: string;
    wasSimplified: boolean;
    droppedTokens?: string[];
    fallbackRetryAttempted?: boolean;
    broadenedQuery?: string;
  };
  /** Availability counts for product_search results (derived from onHand data) */
  availabilityCounts?: {
    inStockCount: number;
    outOfStockCount: number;
    inactiveCount: number;
    unknownCount: number;
  };
  /** Count of results with thumbnailImageKey present (for debugging) */
  thumbnailsPresentCount?: number;
}

/**
 * Debug information included when debug mode is enabled.
 */
export interface DebugBlock {
  requestId?: string;
  toolTrace?: ToolTraceItem[];
  timings?: {
    totalMs?: number;
    openaiMs?: number;
    mcpMs?: number;
  };
}

/**
 * Availability status for a product based on onHand data.
 * Used for product-level availability from product.search results.
 */
export type AvailabilityStatus = 'in_stock' | 'out_of_stock' | 'inactive' | 'unknown';

/**
 * Availability information for a product card.
 * Includes both product-level status (from product.search onHand) and variant-level data (from product.get).
 */
export interface ProductAvailability {
  /** Product-level availability status derived from onHand data */
  status?: AvailabilityStatus;
  /** On-hand quantity (product-level) */
  onHandValue?: number;
  /** Incoming quantity (product-level) */
  incomingValue?: number;
  /** Next delivery date (product-level) */
  nextDeliveryDate?: string | null;
  /** Lead time in days (product-level) */
  leadtimeDayCount?: number;
  /** Number of buyable variants (isBuyable === true) - from product.get */
  buyableVariants?: number;
  /** Number of buyable variants that are in stock - from product.get */
  inStockBuyableVariants?: number;
}

/**
 * A product card for display in the UI.
 * Contains normalized product information extracted from MCP tool results.
 */
export interface ProductCard {
  productId: string;
  title: string;
  subtitle?: string;
  /** Variant name from MCP (separate from title for UI flexibility) */
  variantName?: string | null;
  price?: string;
  currency?: string;
  imageUrl?: string;
  /** Thumbnail image key from product.search for widget thumbnail rendering */
  thumbnailImageKey?: string | null;
  why?: string;
  attributes?: Record<string, string>;
  /** Variant availability summary when known */
  availability?: ProductAvailability;
  /** Generic dimension hints (e.g., { "Color": ["Brown"], "Size": ["S", "M"] }). Max 6 dimensions, 10 values each. */
  dimensionHints?: Record<string, string[]>;
}

/**
 * A refinement chip for filtering/narrowing search results.
 * Example: { key: "color", value: "black", label: "Black" }
 * @deprecated Use RefinementAction from refinementTypes.ts for structured refinements
 */
export interface RefinementChip {
  key: string;
  value: string;
  label?: string;
}

// Import and re-export refinement types for convenience
import type { RefinementAction as RefinementActionType } from './refinementTypes.js';
export type RefinementAction = RefinementActionType;
export type {
  RefinementPayload,
  SearchBroadenPayload,
  SearchRetryPayload,
  RemoveConstraintsPayload,
  AskClarifyPayload,
  FilterByDimensionPayload,
} from './refinementTypes.js';

// Import and re-export choice types for structured disambiguation
import type { ChoiceSet as ChoiceSetType, ChoiceOption as ChoiceOptionType, ChoiceKind as ChoiceKindType, ChoiceOptionMeta as ChoiceOptionMetaType } from './choiceTypes.js';
export type ChoiceSet = ChoiceSetType;
export type ChoiceOption = ChoiceOptionType;
export type ChoiceKind = ChoiceKindType;
export type ChoiceOptionMeta = ChoiceOptionMetaType;

/**
 * Price information for comparison items.
 */
export interface ComparisonPrice {
  amount?: number;
  currency?: string;
  formatted?: string;
}

/**
 * A single item in a product comparison.
 */
export interface ComparisonItem {
  productId: string;
  name: string;
  brand?: string;
  price?: ComparisonPrice;
  attributes?: Record<string, string | number | boolean | null>;
  highlights?: string[];
  url?: string;
}

/**
 * Table structure for comparison display.
 */
export interface ComparisonTable {
  headers: string[];
  rows: Array<{ feature: string; values: string[] }>;
}

/**
 * Structured comparison block for widget-ready API payload.
 * Contains normalized product data for 2-3 products being compared.
 */
export interface ComparisonBlock {
  title: string;
  productIds: string[];
  items: ComparisonItem[];
  table?: ComparisonTable;
}

/**
 * Information about a pending cart action awaiting user confirmation.
 * Included in the response when a cart mutation is blocked pending approval.
 * 
 * The pendingActionId enables idempotent confirmation handling - if a confirm
 * request is repeated (e.g., due to client retry), the action will not be re-executed.
 */
export interface PendingActionInfo {
  /** Unique identifier for this pending action (UUID) - enables idempotent confirmation */
  pendingActionId: string;
  tool: string;
  description: string;
  createdAt: string;
}

/**
 * Style hint for confirmation option buttons.
 */
export type ConfirmationOptionStyle = 'primary' | 'secondary' | 'danger';

/**
 * A single option in a confirmation block.
 * Represents a button the UI can render for user confirmation.
 */
export interface ConfirmationOption {
  /** Stable identifier for this option (e.g., "confirm", "cancel") */
  id: string;
  /** Localized button label (e.g., "Yes", "No") */
  label: string;
  /** Value to send back as user message when this option is selected (e.g., "yes", "no") */
  value: string;
  /** Optional style hint for the button */
  style?: ConfirmationOptionStyle;
}

/**
 * Kind of confirmation block.
 * Reserved for future extension to other confirmation types.
 */
export type ConfirmationKind = 'cart_confirm';

/**
 * Structured confirmation block for pending cart actions.
 * Enables UI to render Yes/No buttons while still supporting free-text responses.
 * 
 * The confirmation block is included alongside pendingAction when a cart mutation
 * requires user confirmation. The `text` field in the response contains the same
 * prompt for backwards compatibility with clients that don't support this block.
 */
export interface ConfirmationBlock {
  /** Unique identifier matching pendingAction.pendingActionId */
  id: string;
  /** Kind of confirmation (reserved for future extension) */
  kind: ConfirmationKind;
  /** Localized confirmation prompt/question */
  prompt: string;
  /** Available options for the user to choose from */
  options: ConfirmationOption[];
}

/**
 * Price information for cart items and totals.
 */
export interface CartPrice {
  amount?: number;
  currency?: string;
  formatted?: string;
}

/**
 * A single item in the cart summary.
 */
export interface CartItem {
  productId: string;
  name?: string;
  quantity: number;
  price?: CartPrice;
}

/**
 * Cart totals information.
 */
export interface CartTotals {
  subtotal?: CartPrice;
  total?: CartPrice;
}

/**
 * Cart summary included in responses after cart operations.
 * Provides a stable, widget-ready representation of the cart state.
 */
export interface CartSummary {
  cartId?: string;
  itemCount: number;
  items: CartItem[];
  totals?: CartTotals;
}

/**
 * The main response structure for POST /v1/chat.
 * This is the widget-ready API payload that combines LLM text with structured data.
 * 
 * Note: This interface is validated at runtime using the Zod schema in chatResponseSchema.ts.
 * Both /v1/chat and /v1/chat/stream final event MUST conform to this structure.
 */
export interface ChatResponse {
  /** Unique identifier for this response turn (UUID v4) */
  turnId: string;
  /** Session identifier */
  sessionId: string;
  /** Assistant's text response (always present) */
  text: string;
  /** Product cards for display */
  cards?: ProductCard[];
  /** Structured refinement actions for widget-renderable buttons (search fallback, filters, etc.) */
  refinements?: RefinementAction[];
  /** Structured choice set for disambiguation (variant selection, product selection, etc.) */
  choices?: ChoiceSet;
  /** Comparison block when comparing products */
  comparison?: ComparisonBlock;
  /** Cart summary when cart data is available */
  cart?: CartSummary;
  /** Pending action info when cart mutation awaits confirmation */
  pendingAction?: PendingActionInfo;
  /** Structured confirmation block for UI to render Yes/No buttons */
  confirmation?: ConfirmationBlock;
  /** Debug information (only when debug mode enabled) */
  debug?: DebugBlock;
  /** Error envelope (optional, for error responses) */
  error?: ErrorEnvelope;
}

/**
 * Error envelope for error responses.
 * The widget can use error.category + retryable to decide "retry vs rephrase" deterministically.
 * 
 * Categories:
 * - validation: Bad request data, user should rephrase
 * - auth: Authentication/authorization issues
 * - upstream: External service issues (MCP, OpenAI, timeouts)
 * - policy: Policy violations (e.g., blocked actions)
 * - internal: Unexpected internal errors
 */
export interface ErrorEnvelope {
  category: 'validation' | 'auth' | 'upstream' | 'policy' | 'internal';
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}
