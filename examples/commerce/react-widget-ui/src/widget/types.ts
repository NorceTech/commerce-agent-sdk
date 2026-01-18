export interface Price {
  amount?: number;
  currency?: string;
  formatted?: string;
}

export interface Availability {
  buyableVariants?: number;
  inStockBuyableVariants?: number;
  status?: string;
  onHandValue?: number;
  incomingValue?: number;
  nextDeliveryDate?: string | null;
  leadtimeDayCount?: number;
}

export interface ProductCard {
  productId: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  thumbnailImageKey?: string | null;
  price?: Price;
  badges?: string[];
  availability?: Availability;
  dimensionHints?: Record<string, string[]>;
  url?: string;
  variantName?: string | null;
}

export interface ChoiceOption {
  id: string;
  label: string;
  meta?: Record<string, unknown>;
  variantName?: string | null;
}

export interface ChoiceSet {
  id: string;
  kind: 'variant' | 'product' | 'generic';
  prompt: string;
  options: ChoiceOption[];
}

export interface RefinementAction {
  id: string;
  label: string;
  payload?: Record<string, unknown>;
}

export interface ComparisonRow {
  key: string;
  values: Record<string, string>;
}

export interface ComparisonBlock {
  productIds: string[];
  rows: ComparisonRow[];
}

export interface CartItem {
  productId: string;
  name?: string;
  quantity: number;
  price?: Price;
}

export interface CartTotals {
  subtotal?: Price;
  total?: Price;
}

export interface CartSummary {
  cartId?: string;
  itemCount: number;
  items: CartItem[];
  totals?: CartTotals;
}

/**
 * Snapshot of cart data passed to the onCartChanged callback.
 * Contains the essential cart information for the host application.
 */
export interface CartSnapshot {
  cartId: string;
  itemCount?: number;
  items?: CartItem[];
  totals?: CartTotals;
}

/**
 * Metadata passed alongside cart updates.
 */
export interface CartChangedMeta {
  turnId?: string;
  sessionId?: string;
}

/**
 * Payload passed to the onProductSelected callback when a user clicks/selects a product card.
 * Contains enough information for the host application to navigate to the product detail page.
 */
export interface ProductSelectedPayload {
  productId: string;
  title: string;
  variantName?: string | null;
  uniqueName?: string | null;
  thumbnailImageKey?: string | null;
  /** Source of the selection - which UI component triggered it */
  source?: 'cards' | 'shortlist' | 'compare';
}

export interface ErrorEnvelope {
  category: 'validation' | 'auth' | 'upstream' | 'policy' | 'internal';
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface DebugBlock {
  toolTrace?: unknown[];
}

export interface ConfirmationOption {
  label: string;
  value: string;
  style?: 'primary' | 'secondary';
}

export interface ConfirmationBlock {
  id: string;
  kind: string;
  prompt: string;
  options: ConfirmationOption[];
}

export interface ChatResponse {
  turnId: string;
  sessionId: string;
  text: string;
  cards?: ProductCard[];
  choices?: ChoiceSet;
  refinements?: RefinementAction[];
  comparison?: ComparisonBlock;
  cart?: CartSummary;
  confirmation?: ConfirmationBlock;
  error?: ErrorEnvelope;
  debug?: DebugBlock;
}

export interface ChatRequest {
  applicationId: string;
  sessionId: string;
  message: string;
  context: Record<string, unknown>;
}

export interface DeltaEvent {
  text: string;
}

export interface ErrorEvent {
  error: ErrorEnvelope;
}

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  response?: ChatResponse;
  isStreaming?: boolean;
  error?: ErrorEnvelope;
}

export interface AgentWidgetProps {
  endpoint: string;
  applicationId: string;
  getContext: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  getAuthToken: () => Promise<string>;
  defaultOpen?: boolean;
  title?: string;
  /**
   * Base URL for product images. When provided, relative image URLs from product cards
   * will be resolved against this base. Should typically end with "/" but the implementation
   * handles both cases. Absolute URLs (http:// or https://) are not modified.
   */
  imageBaseUrl?: string;
  /**
   * Optional callback to resolve an image key to a full URL.
   * Used for thumbnailImageKey on product cards.
   * If not provided, keys that look like URLs (start with http) are returned as-is,
   * otherwise the imageBaseUrl is used to resolve the key.
   */
  resolveImageUrl?: (imageKey: string) => string;
  /**
   * Culture code for the widget (e.g., "sv-SE", "en-GB").
   * Used to derive the UI language if uiLanguage is not provided.
   * The first two characters are used to determine the language.
   */
  cultureCode?: string;
  /**
   * Optional override for the UI language ("sv" | "en").
   * Takes precedence over cultureCode if provided.
   * Falls back to "en" if the language is not supported.
   */
  uiLanguage?: string;
  /**
   * Optional callback invoked when the agent response includes cart data.
   * Called with the cart snapshot and metadata (turnId, sessionId).
   * Only invoked when the cart has changed (based on cartId and content).
   */
  onCartChanged?: (cart: CartSnapshot, meta: CartChangedMeta) => void;
  /**
   * Optional callback invoked when a user clicks/selects a product card surface.
   * NOT triggered when clicking action buttons (Tell me more, Add to cart).
   * Use this to navigate the host application to the product detail page (PDP).
   */
  onProductSelected?: (payload: ProductSelectedPayload) => void;
}
