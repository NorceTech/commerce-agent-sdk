import type {
  NormalizedProductDetails,
  NormalizedVariant,
  VariantDimension,
  VariantOnHand,
  VariantAvailabilitySummary,
  ProductGetOnHand,
} from './productTypes.js';

/**
 * Maximum number of variants to include in normalized output.
 * Prevents pathological payloads from blowing up LLM context.
 */
export const MAX_VARIANTS = 50;

/**
 * Maximum number of dimension values to include per dimension.
 * Prevents large dimension value arrays.
 */
const MAX_DIMENSION_VALUES = 20;

/**
 * Maximum number of primary dimensions to use in variant label.
 */
const MAX_LABEL_DIMENSIONS = 3;

/**
 * Raw MCP variant parametric structure.
 */
interface RawParametric {
  name?: string;
  value?: string;
  code?: string;
  groupName?: string;
  isPrimary?: boolean;
}

/**
 * Raw MCP variant structure from product.get response.
 */
interface RawVariant {
  productId?: number | string;
  uniqueName?: string;
  partNo?: string;
  name?: string;
  /** Variant name from MCP (separate from name for UI flexibility) */
  variantName?: string | null;
  isBuyable?: boolean;
  onHand?: {
    value?: number;
    incomingValue?: number;
    nextDeliveryDate?: string | null;
    leadtimeDayCount?: number;
    isActive?: boolean;
  };
  priceIncVat?: number;
  priceExVat?: number;
  price?: number;
  variantParametrics?: RawParametric[];
  parametrics?: RawParametric[];
  eanCode?: string;
  uom?: string;
  uomCount?: number;
}

/**
 * Raw onHand structure from MCP product.get response.
 * Can appear at root level or within variant objects.
 */
interface RawOnHand {
  value?: number;
  incomingValue?: number;
  nextDeliveryDate?: string | null;
  leadtimeDayCount?: number;
  isActive?: boolean;
}

/**
 * Raw MCP product.get response structure.
 */
interface RawProductGetResponse {
  productId?: number | string;
  uniqueName?: string;
  partNo?: string;
  name?: string;
  /** Variant name from MCP (separate from name for UI flexibility) */
  variantName?: string | null;
  description?: string;
  priceIncVat?: number;
  priceExVat?: number;
  manufacturerName?: string;
  images?: Array<{ type?: string; url?: string }>;
  attributes?: Record<string, unknown>;
  variants?: RawVariant[];
  /** Root-level onHand data (product-level availability) */
  onHand?: RawOnHand;
}

/**
 * Extracts variant dimensions from variantParametrics (and optionally parametrics).
 * Prefers variantParametrics first, preserves isPrimary ordering (primary dims first).
 *
 * @param variant - Raw variant object from MCP
 * @returns Object with dimensions array and dimsMap record
 */
export function extractVariantDimensions(variant: RawVariant): {
  dimensions: VariantDimension[];
  dimsMap: Record<string, string>;
} {
  const dimensions: VariantDimension[] = [];
  const dimsMap: Record<string, string> = {};
  const seenKeys = new Set<string>();

  const processParametric = (param: RawParametric): void => {
    if (!param.name || !param.value) return;

    const key = param.code || param.name;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    const dimension: VariantDimension = {
      name: param.name,
      value: param.value,
    };

    if (param.code) dimension.code = param.code;
    if (param.groupName) dimension.groupName = param.groupName;
    if (param.isPrimary !== undefined) dimension.isPrimary = param.isPrimary;

    dimensions.push(dimension);
    dimsMap[param.name] = param.value;
  };

  if (Array.isArray(variant.variantParametrics)) {
    for (const param of variant.variantParametrics) {
      processParametric(param);
    }
  }

  if (Array.isArray(variant.parametrics)) {
    for (const param of variant.parametrics) {
      processParametric(param);
    }
  }

  dimensions.sort((a, b) => {
    const aPrimary = a.isPrimary === true ? 0 : 1;
    const bPrimary = b.isPrimary === true ? 0 : 1;
    return aPrimary - bPrimary;
  });

  return { dimensions, dimsMap };
}

/**
 * Builds a human-readable label for a variant using its primary dimensions.
 * Uses up to MAX_LABEL_DIMENSIONS primary dims formatted as "${name}: ${value}" joined with " - ".
 * Fallback order: primary dimensions > variantName > variant.name > 'Unknown variant'
 *
 * @param variant - Raw variant object from MCP
 * @param dimensions - Extracted dimensions array
 * @returns Human-readable variant label
 */
export function buildVariantLabel(
  variant: RawVariant,
  dimensions: VariantDimension[]
): string {
  const primaryDims = dimensions.filter((d) => d.isPrimary === true);

  // Prefer primary dimensions label if available
  if (primaryDims.length > 0) {
    const labelParts = primaryDims
      .slice(0, MAX_LABEL_DIMENSIONS)
      .map((d) => `${d.name}: ${d.value}`);
    return labelParts.join(' - ');
  }

  // Else prefer variantName if present
  if (variant.variantName && typeof variant.variantName === 'string') {
    return variant.variantName;
  }

  // Else fallback to variant.name
  return variant.name || 'Unknown variant';
}

/**
 * Normalizes a single variant from MCP response.
 *
 * @param rawVariant - Raw variant object from MCP
 * @returns Normalized variant with coerced IDs and extracted dimensions
 */
export function normalizeVariant(rawVariant: RawVariant): NormalizedVariant {
  const { dimensions, dimsMap } = extractVariantDimensions(rawVariant);
  const label = buildVariantLabel(rawVariant, dimensions);

  const variant: NormalizedVariant = {
    variantProductId: String(rawVariant.productId ?? ''),
    isBuyable: rawVariant.isBuyable === true,
    dimensions,
    dimsMap,
    label,
  };

  if (rawVariant.uniqueName) variant.uniqueName = rawVariant.uniqueName;
  if (rawVariant.partNo) variant.partNo = rawVariant.partNo;
  if (rawVariant.name) variant.name = rawVariant.name;
  // Include variantName if present (separate from name for UI flexibility)
  if (rawVariant.variantName !== undefined) {
    variant.variantName = rawVariant.variantName;
  }

  if (rawVariant.onHand) {
    const onHand: VariantOnHand = {
      value: rawVariant.onHand.value ?? 0,
      isActive: rawVariant.onHand.isActive === true,
    };
    variant.onHand = onHand;

    if (rawVariant.onHand.nextDeliveryDate !== undefined) {
      variant.nextDeliveryDate = rawVariant.onHand.nextDeliveryDate;
    }
  }

  if (rawVariant.priceIncVat !== undefined) variant.priceIncVat = rawVariant.priceIncVat;
  if (rawVariant.priceExVat !== undefined) variant.priceExVat = rawVariant.priceExVat;
  if (rawVariant.price !== undefined) variant.price = rawVariant.price;
  if (rawVariant.eanCode) variant.eanCode = rawVariant.eanCode;
  if (rawVariant.uom) variant.uom = rawVariant.uom;
  if (rawVariant.uomCount !== undefined) variant.uomCount = rawVariant.uomCount;

  return variant;
}

/**
 * Computes buyability summary from normalized variants.
 *
 * @param variants - Array of normalized variants
 * @returns Object with buyableVariantCount and inStockBuyableVariantCount
 */
export function computeBuyabilitySummary(variants: NormalizedVariant[]): {
  buyableVariantCount: number;
  inStockBuyableVariantCount: number;
} {
  let buyableVariantCount = 0;
  let inStockBuyableVariantCount = 0;

  for (const variant of variants) {
    if (variant.isBuyable) {
      buyableVariantCount++;

      if (variant.onHand && variant.onHand.value > 0 && variant.onHand.isActive) {
        inStockBuyableVariantCount++;
      }
    }
  }

  return { buyableVariantCount, inStockBuyableVariantCount };
}

/**
 * Aggregates available dimension values across all variants.
 * Returns unique values per dimension name, capped at MAX_DIMENSION_VALUES.
 *
 * @param variants - Array of normalized variants
 * @returns Record mapping dimension names to arrays of unique values
 */
export function aggregateDimensionValues(
  variants: NormalizedVariant[]
): Record<string, string[]> {
  const dimensionValuesMap = new Map<string, Set<string>>();

  for (const variant of variants) {
    for (const dim of variant.dimensions) {
      if (!dimensionValuesMap.has(dim.name)) {
        dimensionValuesMap.set(dim.name, new Set());
      }
      dimensionValuesMap.get(dim.name)!.add(dim.value);
    }
  }

  const result: Record<string, string[]> = {};
  for (const [name, values] of dimensionValuesMap) {
    result[name] = Array.from(values).slice(0, MAX_DIMENSION_VALUES);
  }

  return result;
}

/**
 * Extracts the primary image URL from a raw product object.
 * Returns the URL as-is (relative format) without transformation.
 *
 * @param product - Raw product object from MCP
 * @returns Image URL (relative), or undefined if not found
 */
function extractImageUrl(product: RawProductGetResponse): string | undefined {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const mainImage = product.images.find((img) => img.type === 'main');
    if (mainImage?.url) {
      return mainImage.url;
    }
    if (product.images[0]?.url) {
      return product.images[0].url;
    }
  }
  return undefined;
}

/**
 * Extracts isBuyable from product attributes.
 *
 * @param product - Raw product object from MCP
 * @returns isBuyable boolean value
 */
function extractIsBuyable(product: RawProductGetResponse): boolean {
  if (product.attributes && typeof product.attributes === 'object') {
    const attrs = product.attributes as Record<string, unknown>;
    if (typeof attrs.isBuyable === 'boolean') {
      return attrs.isBuyable;
    }
  }
  return false;
}

/**
 * Parses the raw MCP product.get response content.
 * Handles both direct object and MCP content wrapper formats.
 *
 * @param result - Raw result from MCP product.get tool
 * @returns Parsed product object or null
 */
function parseProductGetResponse(result: unknown): RawProductGetResponse | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const resultObj = result as Record<string, unknown>;

  if (Array.isArray(resultObj.content)) {
    const content = resultObj.content as Array<{ type?: string; text?: string }>;
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as RawProductGetResponse;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  if ('productId' in resultObj || 'variants' in resultObj) {
    return resultObj as unknown as RawProductGetResponse;
  }

  return null;
}

/**
 * Normalizes a product.get MCP response into a structured NormalizedProductDetails object.
 * Includes variant-level data with buyability, stock, and dimension information.
 * Caps variants at MAX_VARIANTS to prevent pathological payloads.
 *
 * @param mcpResult - Raw result from MCP product.get tool
 * @returns NormalizedProductDetails or null if parsing fails
 */
export function normalizeProductGet(mcpResult: unknown): NormalizedProductDetails | null {
  const rawProduct = parseProductGetResponse(mcpResult);
  if (!rawProduct) {
    return null;
  }

  const rawVariants = Array.isArray(rawProduct.variants)
    ? rawProduct.variants.slice(0, MAX_VARIANTS)
    : [];

  const variants = rawVariants.map(normalizeVariant);
  const { buyableVariantCount, inStockBuyableVariantCount } = computeBuyabilitySummary(variants);
  const availableDimensionValues = aggregateDimensionValues(variants);

  const normalized: NormalizedProductDetails = {
    productId: String(rawProduct.productId ?? ''),
    isBuyable: extractIsBuyable(rawProduct),
    variants,
    buyableVariantCount,
    inStockBuyableVariantCount,
    availableDimensionValues,
  };

  if (rawProduct.uniqueName) normalized.uniqueName = rawProduct.uniqueName;
  if (rawProduct.partNo) normalized.partNo = rawProduct.partNo;
  if (rawProduct.name) normalized.name = rawProduct.name;
  // Include variantName if present (separate from name for UI flexibility)
  if (rawProduct.variantName !== undefined) {
    normalized.variantName = rawProduct.variantName;
  }
  if (rawProduct.description) normalized.description = rawProduct.description;
  if (rawProduct.priceIncVat !== undefined) normalized.priceIncVat = rawProduct.priceIncVat;
  if (rawProduct.priceExVat !== undefined) normalized.priceExVat = rawProduct.priceExVat;
  if (rawProduct.manufacturerName) normalized.manufacturerName = rawProduct.manufacturerName;

  const imageUrl = extractImageUrl(rawProduct);
  if (imageUrl) normalized.imageUrl = imageUrl;

  // Extract root-level onHand data if present
  if (rawProduct.onHand) {
    normalized.rootOnHand = {
      value: rawProduct.onHand.value,
      incomingValue: rawProduct.onHand.incomingValue,
      nextDeliveryDate: rawProduct.onHand.nextDeliveryDate,
      leadtimeDayCount: rawProduct.onHand.leadtimeDayCount,
      isActive: rawProduct.onHand.isActive,
    };
  }

  return normalized;
}

/**
 * Selects the relevant onHand source from normalized product details.
 * Prefers matching variant's onHand if present; otherwise falls back to root onHand.
 *
 * @param normalizedProduct - Normalized product details
 * @param requestedProductId - The productId that was requested (optional)
 * @returns The relevant onHand object or undefined if not found
 */
export function getRelevantOnHandFromNormalized(
  normalizedProduct: NormalizedProductDetails,
  requestedProductId?: string
): ProductGetOnHand | undefined {
  // If we have a requested productId, try to find matching variant's onHand
  if (requestedProductId) {
    const requestedId = String(requestedProductId);
    const matchingVariant = normalizedProduct.variants.find(
      (v) => v.variantProductId === requestedId
    );

    if (matchingVariant?.onHand) {
      // Convert VariantOnHand to ProductGetOnHand format
      return {
        value: matchingVariant.onHand.value,
        isActive: matchingVariant.onHand.isActive,
        nextDeliveryDate: matchingVariant.nextDeliveryDate,
        // Note: variant-level onHand doesn't have incomingValue or leadtimeDayCount
      };
    }
  }

  // Fall back to root onHand
  return normalizedProduct.rootOnHand;
}

/**
 * Extracts a compact variant availability summary for working memory.
 * Does NOT include full variant lists - only summary counts and dimension values.
 * Includes onHand data for availability calculation (matching variant preferred, then root).
 *
 * @param normalizedProduct - Normalized product details
 * @param requestedProductId - The productId that was requested (optional, for variant matching)
 * @returns Compact summary for working memory
 */
export function extractVariantAvailabilitySummary(
  normalizedProduct: NormalizedProductDetails,
  requestedProductId?: string
): VariantAvailabilitySummary {
  const onHand = getRelevantOnHandFromNormalized(normalizedProduct, requestedProductId);

  return {
    buyableVariantCount: normalizedProduct.buyableVariantCount,
    inStockBuyableVariantCount: normalizedProduct.inStockBuyableVariantCount,
    availableDimensionValues: normalizedProduct.availableDimensionValues,
    onHand,
  };
}
