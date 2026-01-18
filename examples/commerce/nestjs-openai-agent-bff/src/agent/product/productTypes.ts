/**
 * Variant dimension extracted from variantParametrics.
 * Represents a single dimension like "Color" or "Size".
 */
export interface VariantDimension {
  name: string;
  value: string;
  code?: string;
  groupName?: string;
  isPrimary?: boolean;
}

/**
 * Stock/availability information for a variant.
 */
export interface VariantOnHand {
  value: number;
  isActive: boolean;
}

/**
 * Normalized variant structure with key fields for buyability, stock, and dimensions.
 */
export interface NormalizedVariant {
  variantProductId: string;
  uniqueName?: string;
  partNo?: string;
  name?: string;
  /** Variant name from MCP (separate from name for UI flexibility) */
  variantName?: string | null;
  isBuyable: boolean;
  onHand?: VariantOnHand;
  nextDeliveryDate?: string | null;
  priceIncVat?: number;
  priceExVat?: number;
  price?: number;
  dimensions: VariantDimension[];
  dimsMap: Record<string, string>;
  label: string;
  eanCode?: string;
  uom?: string;
  uomCount?: number;
}

/**
 * Normalized product details including variant-level data.
 * This is the main structure returned by normalizeProductGet.
 */
export interface NormalizedProductDetails {
  productId: string;
  uniqueName?: string;
  partNo?: string;
  name?: string;
  /** Variant name from MCP (separate from name for UI flexibility) */
  variantName?: string | null;
  description?: string;
  priceIncVat?: number;
  priceExVat?: number;
  manufacturerName?: string;
  imageUrl?: string;
  isBuyable: boolean;
  variants: NormalizedVariant[];
  buyableVariantCount: number;
  inStockBuyableVariantCount: number;
  availableDimensionValues: Record<string, string[]>;
  /** Root-level onHand data from product.get response */
  rootOnHand?: ProductGetOnHand;
}

/**
 * OnHand data extracted from product.get response for availability calculation.
 * Can come from root level or matching variant.
 */
export interface ProductGetOnHand {
  value?: number;
  incomingValue?: number;
  nextDeliveryDate?: string | null;
  leadtimeDayCount?: number;
  isActive?: boolean;
}

/**
 * Summary of variant availability for working memory.
 * This is a compact representation that doesn't include full variant lists.
 */
export interface VariantAvailabilitySummary {
  buyableVariantCount: number;
  inStockBuyableVariantCount: number;
  availableDimensionValues: Record<string, string[]>;
  /** OnHand data for availability calculation (from matching variant or root) */
  onHand?: ProductGetOnHand;
}
