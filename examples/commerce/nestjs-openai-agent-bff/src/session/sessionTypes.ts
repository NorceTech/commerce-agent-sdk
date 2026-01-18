import type { ActiveChoiceSet } from '../http/choiceTypes.js';

export interface McpState {
  sessionId?: string;
  nextRpcId: number;
}

export type { ActiveChoiceSet };

export interface ToolContext {
  cultureCode?: string;
  currencyCode?: string;
  priceListIds?: number[];
  salesAreaId?: number;
  customerId?: number;
  companyId?: number;
  /**
   * Client IP address derived from the incoming HTTP request.
   * Required for cart.addItem MCP calls.
   * MUST NOT be provided by the model - always derived from server request context.
   */
  clientIp?: string;
  /**
   * Basket ID for cart operations, injected from session state.
   * Used by cart.get to retrieve the correct basket.
   * MUST NOT be provided by the model - always injected from session.cartState.basketId.
   */
  basketId?: string;
}

/**
 * Availability status for a product based on onHand data.
 */
export type AvailabilityStatus = 'in_stock' | 'out_of_stock' | 'inactive' | 'unknown';

/**
 * Represents a product result stored in working memory for reference resolution.
 * Used for lastResults array with 1-based index for ordinal reference resolution.
 */
export interface LastResultItem {
  index: number;
  productId: string;
  partNo?: string;
  name: string;
  /** Variant name from MCP (separate from name for UI flexibility) */
  variantName?: string | null;
  brand?: string;
  color?: string;
  price?: number;
  currency?: string;
  url?: string;
  /** Product-level availability status derived from onHand data */
  availabilityStatus?: AvailabilityStatus;
  /** On-hand quantity (product-level) */
  onHandValue?: number;
  /** Number of buyable variants (isBuyable === true) */
  buyableVariantCount?: number;
  /** Number of buyable variants that are in stock (isBuyable && onHand.value > 0 && onHand.isActive) */
  inStockBuyableVariantCount?: number;
  /** Available dimension values per dimension name (e.g., { "Color": ["Brown"], "Size": ["22-23 EU", "24-25 EU"] }) */
  availableDimensionValues?: Record<string, string[]>;
}

/**
 * Shortlist item with productId and optional name for display.
 */
export interface ShortlistItem {
  productId: string;
  name?: string;
}

/**
 * @deprecated Use LastResultItem instead
 * Represents a product result stored in working memory for reference resolution.
 */
export interface WorkingMemoryProduct {
  productId: string;
  title?: string;
  attrs?: Record<string, unknown>;
}

/**
 * Compact representation of a search candidate for working memory.
 * Stored from the FULL product.search response (not just capped cards).
 */
export interface SearchCandidateRecord {
  productId: string;
  title: string;
  /** Variant name from MCP (separate from title for UI flexibility) */
  variantName?: string | null;
  currency?: string;
  price?: string;
  imageUrl?: string;
  attributes?: Record<string, string>;
  /** Product-level availability status derived from onHand data */
  availabilityStatus?: AvailabilityStatus;
  /** On-hand quantity (product-level) */
  onHandValue?: number;
}

/**
 * Represents a variant choice stored in working memory for disambiguation.
 * Used when a product has multiple buyable variants and the user needs to select one.
 * The index is 1-based for user-friendly ordinal references ("option 1", "option 2").
 */
export interface VariantChoice {
  /** 1-based index for ordinal reference resolution */
  index: number;
  /** The variant's product ID (used as productId in cart operations) */
  variantProductId: string;
  /** Human-readable label built from variant dimensions (e.g., "Color: Brown - Size: 26-27 EU (in stock: 4)") */
  label: string;
  /** Variant name from MCP (separate from label for UI flexibility) */
  variantName?: string | null;
  /** Generic dimensions map (e.g., { "Color": "Brown", "Size": "26-27 EU" }) */
  dimsMap?: Record<string, string>;
  /** Current stock on hand */
  onHand?: number;
  /** Whether the variant is buyable */
  isBuyable?: boolean;
  /** Part number for explicit identifier resolution */
  partNo?: string;
  /** EAN code for explicit identifier resolution */
  eanCode?: string;
  /** Unique name for explicit identifier resolution */
  uniqueName?: string;
}

/**
 * Working memory for the session, used for shortlist and reference resolution.
 */
export interface WorkingMemory {
  /** Last search results with 1-based index for ordinal reference resolution (max 10 items) */
  lastResults?: LastResultItem[];
  /** Shortlist of pinned product IDs with optional names (max 10 items) */
  shortlist?: ShortlistItem[];
  /** Full search candidates for fallback card building */
  searchCandidates?: SearchCandidateRecord[];
  /** Variant choices for disambiguation when a product has multiple buyable variants */
  variantChoices?: VariantChoice[];
  /** Parent product ID associated with current variant choices */
  variantChoicesParentProductId?: string;
  /** Active choice set for deterministic resolution of "option N" references */
  activeChoiceSet?: ActiveChoiceSet;
}

/**
 * Types of cart mutation tools that require confirmation.
 */
export type CartMutationKind = 'cart_add_item' | 'cart_set_item_quantity' | 'cart_remove_item';

/**
 * Status of a pending action.
 * - pending: Action is awaiting user confirmation
 * - consumed: Action has been executed (confirmation was processed)
 * - cancelled: Action was cancelled by the user
 */
export type PendingActionStatus = 'pending' | 'consumed' | 'cancelled';

/**
 * Maximum number of cart items to store in session state.
 * Prevents token blowups and keeps session size bounded.
 */
export const MAX_CART_ITEMS_IN_SESSION = 50;

/**
 * Price information for cart items and totals (internal session variant).
 */
export interface CartStatePrice {
  amount?: number;
  currency?: string;
  formatted?: string;
}

/**
 * A single item in the cart state (internal session variant).
 */
export interface CartStateItem {
  productId: string;
  name?: string;
  quantity: number;
  price?: CartStatePrice;
}

/**
 * Cart totals information (internal session variant).
 */
export interface CartStateTotals {
  subtotal?: CartStatePrice;
  total?: CartStatePrice;
}

/**
 * Cart state stored in session.
 * Lightweight representation of the cart for persistence across turns.
 * Items are capped at MAX_CART_ITEMS_IN_SESSION to prevent token blowups.
 */
export interface CartState {
  cartId?: string;
  /**
   * The basket ID returned from cart.addItem MCP response.
   * This is the primary identifier used for subsequent cart.get calls.
   * Extracted from response.basketId or response.id (coerced to string).
   */
  basketId?: string;
  itemCount: number;
  items: CartStateItem[];
  totals?: CartStateTotals;
}

/**
 * Pending action awaiting user confirmation.
 * Used for cart mutations that require explicit user approval before execution.
 * 
 * Idempotency: Each pending action has a unique ID and status to ensure
 * that confirmations are processed exactly once. If a confirm request is
 * repeated (e.g., due to client retry or double "yes"), the action will
 * not be re-executed.
 */
export interface PendingAction {
  /** Unique identifier for this pending action (UUID) */
  id: string;
  kind: CartMutationKind;
  args: Record<string, unknown>;
  createdAt: number;
  /** Status of the pending action for idempotency */
  status: PendingActionStatus;
  /** Timestamp when the action was consumed (executed), if applicable */
  consumedAt?: number;
}

export interface SessionState {
  conversation: Array<unknown>;
  mcp: McpState;
  updatedAt: number;
  expiresAt: number;
  context?: ToolContext;
  workingMemory?: WorkingMemory;
  pendingAction?: PendingAction;
  cartState?: CartState;
}
