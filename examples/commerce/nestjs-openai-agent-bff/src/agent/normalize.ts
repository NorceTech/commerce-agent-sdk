import type { ProductCard, AvailabilityStatus } from '../http/responseTypes.js';

/**
 * Maximum number of items to return in search results to avoid token blowups.
 */
const MAX_SEARCH_ITEMS = 10;

/**
 * Maximum number of cards to return for UI display (3-6 range).
 */
const MAX_CARDS = 6;
const MIN_CARDS = 3;

/**
 * Normalized onHand data from product.search results.
 */
export interface NormalizedOnHand {
  value?: number;
  incomingValue?: number;
  nextDeliveryDate?: string | null;
  leadtimeDayCount?: number;
  isActive?: boolean;
}

/**
 * Computed availability information for a product.
 */
export interface ProductAvailabilityInfo {
  status: AvailabilityStatus;
  onHandValue?: number;
  incomingValue?: number;
  nextDeliveryDate?: string | null;
  leadtimeDayCount?: number;
}

/**
 * Normalized product item structure for search results.
 */
export interface NormalizedProductItem {
  id?: string;
  partNo?: string;
  name?: string;
  /** Variant name from MCP (separate from name for UI flexibility) */
  variantName?: string | null;
  description?: string;
  price?: unknown;
  imageUrl?: string;
  /** Thumbnail image key from product.search for widget thumbnail rendering */
  thumbnailImageKey?: string | null;
  onHand?: NormalizedOnHand;
  availability?: ProductAvailabilityInfo;
  [key: string]: unknown;
}

/**
 * Normalized search result structure.
 */
export interface NormalizedSearchResult {
  items: NormalizedProductItem[];
  totalCount?: number;
  truncated: boolean;
}

/**
 * Normalized product detail structure.
 */
export interface NormalizedProductDetail {
  id?: string;
  partNo?: string;
  name?: string;
  description?: string;
  price?: unknown;
  imageUrl?: string;
  variants?: unknown[];
  [key: string]: unknown;
}

/**
 * Normalizes raw onHand data from MCP product.search results.
 * Handles missing/null fields safely by coercing to appropriate types.
 *
 * @param raw - Raw onHand object from MCP response
 * @returns Normalized onHand data or undefined if input is invalid
 */
export function normalizeOnHand(raw: unknown): NormalizedOnHand | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const rawObj = raw as Record<string, unknown>;
  const normalized: NormalizedOnHand = {};

  // Coerce value to number, default to undefined if not present
  if (rawObj.value !== undefined && rawObj.value !== null) {
    const numValue = Number(rawObj.value);
    if (!isNaN(numValue)) {
      normalized.value = numValue;
    }
  }

  // Coerce incomingValue to number
  if (rawObj.incomingValue !== undefined && rawObj.incomingValue !== null) {
    const numValue = Number(rawObj.incomingValue);
    if (!isNaN(numValue)) {
      normalized.incomingValue = numValue;
    }
  }

  // Preserve nextDeliveryDate as string or null
  if (rawObj.nextDeliveryDate !== undefined) {
    if (rawObj.nextDeliveryDate === null) {
      normalized.nextDeliveryDate = null;
    } else if (typeof rawObj.nextDeliveryDate === 'string') {
      normalized.nextDeliveryDate = rawObj.nextDeliveryDate;
    }
  }

  // Coerce leadtimeDayCount to number
  if (rawObj.leadtimeDayCount !== undefined && rawObj.leadtimeDayCount !== null) {
    const numValue = Number(rawObj.leadtimeDayCount);
    if (!isNaN(numValue)) {
      normalized.leadtimeDayCount = numValue;
    }
  }

  // Coerce isActive to boolean
  if (rawObj.isActive !== undefined && rawObj.isActive !== null) {
    normalized.isActive = rawObj.isActive === true || rawObj.isActive === 'true';
  }

  // Return undefined if no fields were extracted
  if (Object.keys(normalized).length === 0) {
    return undefined;
  }

  return normalized;
}

/**
 * Computes availability status from normalized onHand data.
 * Uses deterministic rules:
 * - if onHand missing => "unknown"
 * - if onHand.isActive === false => "inactive"
 * - else if (onHand.value ?? 0) > 0 => "in_stock"
 * - else => "out_of_stock"
 *
 * @param onHand - Normalized onHand data
 * @returns Computed availability information
 */
export function computeAvailability(onHand: NormalizedOnHand | undefined): ProductAvailabilityInfo {
  if (!onHand) {
    return { status: 'unknown' };
  }

  // Check if product is inactive
  if (onHand.isActive === false) {
    return {
      status: 'inactive',
      onHandValue: onHand.value,
      incomingValue: onHand.incomingValue,
      nextDeliveryDate: onHand.nextDeliveryDate,
      leadtimeDayCount: onHand.leadtimeDayCount,
    };
  }

  // Check if product is in stock
  const onHandValue = onHand.value ?? 0;
  if (onHandValue > 0) {
    return {
      status: 'in_stock',
      onHandValue: onHand.value,
      incomingValue: onHand.incomingValue,
      nextDeliveryDate: onHand.nextDeliveryDate,
      leadtimeDayCount: onHand.leadtimeDayCount,
    };
  }

  // Product is out of stock
  return {
    status: 'out_of_stock',
    onHandValue: onHand.value,
    incomingValue: onHand.incomingValue,
    nextDeliveryDate: onHand.nextDeliveryDate,
    leadtimeDayCount: onHand.leadtimeDayCount,
  };
}

/**
 * Raw onHand structure from MCP product.get response.
 * Can appear at root level or within variant objects.
 */
export interface RawOnHand {
  value?: number;
  incomingValue?: number;
  nextDeliveryDate?: string | null;
  leadtimeDayCount?: number;
  isActive?: boolean;
}

/**
 * Raw variant structure from MCP product.get response.
 * Used for selecting the correct onHand source.
 */
export interface RawVariantForOnHand {
  productId?: number | string;
  onHand?: RawOnHand;
}

/**
 * Raw product.get response structure for onHand extraction.
 */
export interface RawProductGetForOnHand {
  onHand?: RawOnHand;
  variants?: RawVariantForOnHand[];
}

/**
 * Selects the relevant onHand source from a product.get response.
 * Prefers matching variant's onHand if present; otherwise falls back to root onHand.
 *
 * @param productGet - Raw product.get response (or parsed content)
 * @param requestedProductId - The productId that was requested (string)
 * @returns The relevant onHand object or undefined if not found
 */
export function getRelevantOnHand(
  productGet: RawProductGetForOnHand | null | undefined,
  requestedProductId: string | undefined
): RawOnHand | undefined {
  if (!productGet) {
    return undefined;
  }

  // If we have a requested productId, try to find matching variant's onHand
  if (requestedProductId) {
    const requestedId = String(requestedProductId);
    const variants = productGet.variants;
    
    if (Array.isArray(variants)) {
      const matchingVariant = variants.find(
        (v) => v && String(v.productId) === requestedId
      );
      
      if (matchingVariant?.onHand) {
        return matchingVariant.onHand;
      }
    }
  }

  // Fall back to root onHand
  return productGet.onHand;
}

/**
 * Derives ProductAvailabilityInfo from raw onHand data.
 * This is a convenience wrapper around normalizeOnHand + computeAvailability.
 *
 * @param rawOnHand - Raw onHand object from MCP response
 * @returns ProductAvailabilityInfo with status and values
 */
export function deriveAvailabilityFromOnHand(
  rawOnHand: RawOnHand | undefined
): ProductAvailabilityInfo {
  const normalized = normalizeOnHand(rawOnHand);
  return computeAvailability(normalized);
}

/**
 * Normalizes product search results by capping the number of items
 * to prevent huge payloads from being sent back to the LLM.
 *
 * @param result - Raw result from MCP product.search tool
 * @returns Normalized result with capped items
 */
export function normalizeProductSearchResult(result: unknown): NormalizedSearchResult {
  if (!result || typeof result !== 'object') {
    return {
      items: [],
      totalCount: 0,
      truncated: false,
    };
  }

  const resultObj = result as Record<string, unknown>;

  let items: unknown[] = [];
  let totalCount: number | undefined;

  if (Array.isArray(resultObj.content)) {
    const content = resultObj.content as Array<{ type?: string; text?: string }>;
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) {
              items = parsed.items;
              totalCount = parsed.totalCount;
            } else if (Array.isArray(parsed.products)) {
              items = parsed.products;
              totalCount = parsed.totalCount;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } else if (Array.isArray(resultObj.items)) {
    items = resultObj.items;
    totalCount = resultObj.totalCount as number | undefined;
  } else if (Array.isArray(resultObj.products)) {
    items = resultObj.products;
    totalCount = resultObj.totalCount as number | undefined;
  } else if (Array.isArray(result)) {
    items = result;
  }

  const truncated = items.length > MAX_SEARCH_ITEMS;
  const cappedItems = items.slice(0, MAX_SEARCH_ITEMS);

  // Process each item to extract and normalize onHand data
  const normalizedItems: NormalizedProductItem[] = cappedItems.map((item) => {
    if (!item || typeof item !== 'object') {
      return item as NormalizedProductItem;
    }

    const itemObj = item as Record<string, unknown>;
    const normalizedItem: NormalizedProductItem = { ...itemObj };

    // Extract and normalize onHand data if present
    if (itemObj.onHand !== undefined) {
      const onHand = normalizeOnHand(itemObj.onHand);
      if (onHand) {
        normalizedItem.onHand = onHand;
        normalizedItem.availability = computeAvailability(onHand);
      }
    } else {
      // No onHand data - set availability to unknown
      normalizedItem.availability = computeAvailability(undefined);
    }

    // Extract variantName if present (separate from name for UI flexibility)
    if (itemObj.variantName !== undefined) {
      normalizedItem.variantName = typeof itemObj.variantName === 'string' 
        ? itemObj.variantName 
        : null;
    }

    // Extract thumbnailImageKey if present
    // Normalize: missing -> undefined, null -> null, number -> String(value), string -> string
    if (itemObj.thumbnailImageKey !== undefined) {
      if (itemObj.thumbnailImageKey === null) {
        normalizedItem.thumbnailImageKey = null;
      } else if (typeof itemObj.thumbnailImageKey === 'string') {
        normalizedItem.thumbnailImageKey = itemObj.thumbnailImageKey;
      } else if (typeof itemObj.thumbnailImageKey === 'number') {
        normalizedItem.thumbnailImageKey = String(itemObj.thumbnailImageKey);
      } else {
        normalizedItem.thumbnailImageKey = null;
      }
    }

    return normalizedItem;
  });

  return {
    items: normalizedItems,
    totalCount: totalCount ?? items.length,
    truncated,
  };
}

/**
 * Normalizes product get result.
 * For single product details, we don't need to cap items but we ensure
 * a stable structure is returned.
 *
 * @param result - Raw result from MCP product.get tool
 * @returns Normalized product detail
 */
export function normalizeProductGetResult(result: unknown): NormalizedProductDetail | null {
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
            return parsed as NormalizedProductDetail;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  return resultObj as NormalizedProductDetail;
}

/**
 * Extracts a stable product ID from a raw product object.
 * Tries multiple field names in order of preference.
 * 
 * @param product - Raw product object from MCP
 * @returns Product ID as string, or undefined if not found
 */
function extractProductId(product: Record<string, unknown>): string | undefined {
  const idFields = ['productId', 'id', 'partNo', 'productNumber', 'sku', 'code'];
  for (const field of idFields) {
    const value = product[field];
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }
  return undefined;
}

/**
 * Extracts the product title from a raw product object.
 * Tries multiple field names in order of preference.
 * 
 * @param product - Raw product object from MCP
 * @returns Product title, or undefined if not found
 */
function extractTitle(product: Record<string, unknown>): string | undefined {
  const titleFields = ['name', 'title', 'productName', 'displayName'];
  for (const field of titleFields) {
    const value = product[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Extracts the primary image URL from a raw product object.
 * Returns the URL as-is (relative format) without transformation.
 * 
 * @param product - Raw product object from MCP
 * @returns Image URL (relative), or undefined if not found
 */
function extractImageUrl(product: Record<string, unknown>): string | undefined {
  const imageFields = ['imageUrl', 'image', 'primaryImage', 'thumbnailUrl', 'thumbnail'];
  for (const field of imageFields) {
    const value = product[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  const imagesField = product.images;
  if (Array.isArray(imagesField) && imagesField.length > 0) {
    const firstImage = imagesField[0];
    if (typeof firstImage === 'string') {
      return firstImage;
    }
    if (typeof firstImage === 'object' && firstImage !== null) {
      const imgObj = firstImage as Record<string, unknown>;
      const urlFields = ['url', 'src', 'imageUrl'];
      for (const urlField of urlFields) {
        if (typeof imgObj[urlField] === 'string') {
          return imgObj[urlField] as string;
        }
      }
    }
  }

  return undefined;
}

/**
 * Extracts price information from a raw product object.
 * 
 * @param product - Raw product object from MCP
 * @returns Object with price and currency strings, or undefined values
 */
function extractPrice(product: Record<string, unknown>): { price?: string; currency?: string } {
  const priceField = product.price;
  let priceValue: string | undefined;
  let currency: string | undefined;
  
  const topLevelCurrency = product.currency || product.currencyCode;
  if (typeof topLevelCurrency === 'string' && topLevelCurrency.trim() !== '') {
    currency = topLevelCurrency.trim();
  }
  
  if (typeof priceField === 'number') {
    priceValue = String(priceField);
    return { price: priceValue, currency };
  }
  
  if (typeof priceField === 'string' && priceField.trim() !== '') {
    priceValue = priceField.trim();
    return { price: priceValue, currency };
  }
  
  if (typeof priceField === 'object' && priceField !== null) {
    const priceObj = priceField as Record<string, unknown>;
    const valueFields = ['value', 'amount', 'price', 'sellingPrice', 'listPrice'];
    
    for (const field of valueFields) {
      const val = priceObj[field];
      if (val !== undefined && val !== null) {
        priceValue = String(val);
        break;
      }
    }
    
    const currencyFields = ['currency', 'currencyCode', 'currencySymbol'];
    
    for (const field of currencyFields) {
      const val = priceObj[field];
      if (typeof val === 'string' && val.trim() !== '') {
        currency = val.trim();
        break;
      }
    }
    
    return { price: priceValue, currency };
  }
  
  return { currency };
}

/**
 * Extracts a small subset of attributes from a raw product object.
 * Focuses on common attributes: color, size, material, brand.
 * 
 * @param product - Raw product object from MCP
 * @returns Record of attribute key-value pairs
 */
function extractAttributes(product: Record<string, unknown>): Record<string, string> {
  const attrs: Record<string, string> = {};
  const targetAttrs = ['color', 'size', 'material', 'brand', 'category', 'manufacturer'];
  
  for (const attr of targetAttrs) {
    const value = product[attr];
    if (typeof value === 'string' && value.trim() !== '') {
      attrs[attr] = value.trim();
    }
  }

  const attributesField = product.attributes;
  if (typeof attributesField === 'object' && attributesField !== null && !Array.isArray(attributesField)) {
    const attrObj = attributesField as Record<string, unknown>;
    for (const attr of targetAttrs) {
      if (attrs[attr]) continue;
      const value = attrObj[attr];
      if (typeof value === 'string' && value.trim() !== '') {
        attrs[attr] = value.trim();
      }
    }
  }
  
  return attrs;
}

/**
 * Converts a raw product object to a ProductCard.
 * Uses tolerant extraction to handle varying MCP payload formats.
 * Includes availability data if present in the normalized product item.
 * 
 * @param product - Raw product object from MCP (may be NormalizedProductItem with availability)
 * @returns ProductCard or null if essential fields are missing
 */
function rawProductToCard(product: unknown): ProductCard | null {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return null;
  }
  
  const productObj = product as Record<string, unknown>;
  const productId = extractProductId(productObj);
  const title = extractTitle(productObj);
  
  if (!productId || !title) {
    return null;
  }
  
  const imageUrl = extractImageUrl(productObj);
  const { price, currency } = extractPrice(productObj);
  const attributes = extractAttributes(productObj);
  
  const subtitle = typeof productObj.description === 'string' 
    ? productObj.description.substring(0, 100) 
    : undefined;
  
  const card: ProductCard = {
    productId,
    title,
  };
  
  if (subtitle) card.subtitle = subtitle;
  if (price) card.price = price;
  if (currency) card.currency = currency;
  if (imageUrl) card.imageUrl = imageUrl;
  if (Object.keys(attributes).length > 0) card.attributes = attributes;
  
  // Include variantName if present (separate from title for UI flexibility)
  if (productObj.variantName !== undefined) {
    card.variantName = typeof productObj.variantName === 'string' 
      ? productObj.variantName 
      : null;
  }
  
  // Include thumbnailImageKey if present (for widget thumbnail rendering)
  if (productObj.thumbnailImageKey !== undefined) {
    if (productObj.thumbnailImageKey === null) {
      card.thumbnailImageKey = null;
    } else if (typeof productObj.thumbnailImageKey === 'string') {
      card.thumbnailImageKey = productObj.thumbnailImageKey;
    } else if (typeof productObj.thumbnailImageKey === 'number') {
      card.thumbnailImageKey = String(productObj.thumbnailImageKey);
    } else {
      card.thumbnailImageKey = null;
    }
  }
  
  // Include availability data if present (from normalized product item)
  const availability = productObj.availability as ProductAvailabilityInfo | undefined;
  if (availability) {
    card.availability = {
      status: availability.status,
      onHandValue: availability.onHandValue,
      incomingValue: availability.incomingValue,
      nextDeliveryDate: availability.nextDeliveryDate,
      leadtimeDayCount: availability.leadtimeDayCount,
    };
  }
  
  return card;
}

/**
 * Priority order for availability status sorting.
 * Lower number = higher priority (shown first).
 */
const AVAILABILITY_PRIORITY: Record<AvailabilityStatus, number> = {
  in_stock: 0,
  unknown: 1,
  out_of_stock: 2,
  inactive: 3,
};

/**
 * Normalizes product search results to ProductCard array for UI display.
 * Caps the number of cards to MAX_CARDS (3-6 range).
 * Sorts cards by availability status: in_stock first, then unknown, then out_of_stock, then inactive.
 * Within the same availability bucket, original ordering is preserved (stable sort).
 * 
 * @param mcpResult - Raw result from MCP product.search tool
 * @returns Array of ProductCard objects sorted by availability
 */
export function normalizeProductSearchResultToCards(mcpResult: unknown): ProductCard[] {
  const normalized = normalizeProductSearchResult(mcpResult);
  const cards: ProductCard[] = [];
  
  for (const item of normalized.items) {
    const card = rawProductToCard(item);
    if (card) {
      cards.push(card);
    }
  }
  
  // Sort by availability status (stable sort preserves original order within same bucket)
  cards.sort((a, b) => {
    const aPriority = AVAILABILITY_PRIORITY[a.availability?.status ?? 'unknown'];
    const bPriority = AVAILABILITY_PRIORITY[b.availability?.status ?? 'unknown'];
    return aPriority - bPriority;
  });
  
  // Cap to MAX_CARDS after sorting
  return cards.slice(0, MAX_CARDS);
}

/**
 * Normalizes a single product get result to a ProductCard for UI display.
 * 
 * @param mcpResult - Raw result from MCP product.get tool
 * @returns ProductCard or null if conversion fails
 */
export function normalizeProductGetResultToCard(mcpResult: unknown): ProductCard | null {
  const normalized = normalizeProductGetResult(mcpResult);
  if (!normalized) {
    return null;
  }
  
  return rawProductToCard(normalized);
}
