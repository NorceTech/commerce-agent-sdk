import type { McpState, ToolContext, VariantChoice } from '../../session/sessionTypes.js';
import type { NormalizedProductDetails } from '../product/productTypes.js';
import { normalizeProductGet } from '../product/normalizeProductGet.js';
import {
  selectBuyableVariants,
  type VariantCandidate,
  type VariantSelectionResult,
  MAX_VARIANT_OPTIONS,
} from './selectVariant.js';
import type { Tool } from '../tools.js';

/**
 * Result of variant preflight check when the cart operation can proceed.
 */
export interface PreflightProceedResult {
  type: 'proceed';
  /** The productId to use (may be rewritten to variant productId) */
  productId: string;
  /** Whether the productId was rewritten from parent to variant */
  rewritten: boolean;
  /** The variant that was selected (if rewritten) */
  selectedVariant?: VariantCandidate;
}

/**
 * Result of variant preflight check when disambiguation is needed.
 */
export interface PreflightDisambiguateResult {
  type: 'disambiguate';
  /** Message to show to the user asking them to choose a variant */
  message: string;
  /** Variant choices to store in working memory */
  variantChoices: VariantChoice[];
  /** Parent product ID for reference */
  parentProductId: string;
  /** Product name for context */
  productName?: string;
}

/**
 * Result of variant preflight check when the product is not buyable.
 */
export interface PreflightNotBuyableResult {
  type: 'not_buyable';
  /** Error message explaining why the product cannot be added */
  message: string;
  /** Parent product ID for reference */
  parentProductId: string;
}

/**
 * Result of variant preflight check when product_get needs to be called first.
 */
export interface PreflightNeedsFetchResult {
  type: 'needs_fetch';
  /** The productId that needs to be fetched */
  productId: string;
}

/**
 * Union type for all possible preflight results.
 */
export type VariantPreflightResult =
  | PreflightProceedResult
  | PreflightDisambiguateResult
  | PreflightNotBuyableResult
  | PreflightNeedsFetchResult;

/**
 * Converts variant candidates to VariantChoice objects for session storage.
 */
function candidatesToChoices(candidates: VariantCandidate[]): VariantChoice[] {
  return candidates.slice(0, MAX_VARIANT_OPTIONS).map((c, idx): VariantChoice => ({
    index: idx + 1,
    variantProductId: c.variantProductId,
    label: c.label,
    dimsMap: c.dimsMap,
    onHand: c.onHand,
    isBuyable: c.isBuyable,
    partNo: c.partNo,
    eanCode: c.eanCode,
    uniqueName: c.uniqueName,
  }));
}

/**
 * Checks if a productId is a variant productId (exists in the variants array).
 */
function isVariantProductId(
  productId: string,
  productDetails: NormalizedProductDetails
): boolean {
  return productDetails.variants.some(
    (v) => v.variantProductId === productId
  );
}

/**
 * Performs variant preflight check for a cart_add_item operation.
 * 
 * This function determines whether:
 * 1. The operation can proceed directly (single variant or already a variant ID)
 * 2. Disambiguation is needed (multiple buyable variants)
 * 3. The product is not buyable
 * 4. Product details need to be fetched first
 * 
 * @param productId - The productId from the cart_add_item args
 * @param cachedProductDetails - Map of productId to normalized product details from recent product_get calls
 * @returns VariantPreflightResult indicating the next action
 */
export function checkVariantPreflight(
  productId: string,
  cachedProductDetails: Map<string, NormalizedProductDetails>
): VariantPreflightResult {
  // Check if we have cached product details for this productId
  const productDetails = cachedProductDetails.get(productId);
  
  if (!productDetails) {
    // We don't have product details - need to fetch them
    return {
      type: 'needs_fetch',
      productId,
    };
  }

  // Check if the productId is already a variant productId
  if (isVariantProductId(productId, productDetails)) {
    // Already targeting a variant - proceed directly
    return {
      type: 'proceed',
      productId,
      rewritten: false,
    };
  }

  // Check if product has no variants
  if (!productDetails.variants || productDetails.variants.length === 0) {
    // No variants - check if parent product is buyable
    if (productDetails.isBuyable) {
      return {
        type: 'proceed',
        productId,
        rewritten: false,
      };
    } else {
      return {
        type: 'not_buyable',
        message: `"${productDetails.name || 'This product'}" is not available for purchase.`,
        parentProductId: productId,
      };
    }
  }

  // Product has variants - run variant selection
  const selectionResult = selectBuyableVariants(productDetails);

  switch (selectionResult.type) {
    case 'single':
      // Single buyable variant - rewrite productId
      return {
        type: 'proceed',
        productId: selectionResult.variant.variantProductId,
        rewritten: true,
        selectedVariant: selectionResult.variant,
      };

    case 'multiple':
      // Multiple buyable variants - need disambiguation
      return {
        type: 'disambiguate',
        message: selectionResult.message,
        variantChoices: candidatesToChoices(selectionResult.candidates),
        parentProductId: productId,
        productName: productDetails.name,
      };

    case 'not_buyable':
      // No buyable variants
      return {
        type: 'not_buyable',
        message: selectionResult.reason,
        parentProductId: productId,
      };

    case 'no_variants':
      // Product has empty variants array but we already checked this above
      // This shouldn't happen, but handle it gracefully
      if (selectionResult.productIsBuyable) {
        return {
          type: 'proceed',
          productId,
          rewritten: false,
        };
      } else {
        return {
          type: 'not_buyable',
          message: `"${productDetails.name || 'This product'}" is not available for purchase.`,
          parentProductId: productId,
        };
      }
  }
}

/**
 * Performs a product_get call to fetch product details for variant preflight.
 * 
 * @param productId - The productId to fetch
 * @param productGetTool - The product_get tool
 * @param mcpState - MCP session state
 * @param context - Tool context
 * @returns Normalized product details or null if fetch failed
 */
export async function fetchProductForPreflight(
  productId: string,
  productGetTool: Tool,
  mcpState: McpState,
  context?: ToolContext
): Promise<NormalizedProductDetails | null> {
  try {
    const result = await productGetTool.execute(
      { productId },
      mcpState,
      context
    );

    if (result && typeof result === 'object' && 'normalized' in result) {
      return (result as { normalized: NormalizedProductDetails | null }).normalized;
    }

    // Try to normalize from raw result
    return normalizeProductGet(result);
  } catch {
    return null;
  }
}

/**
 * Resolves a variant choice from user input.
 * Handles ordinal patterns ("option 2", "2", "#2") and explicit identifiers.
 * 
 * @param userText - The user's message text
 * @param variantChoices - The stored variant choices
 * @returns The resolved variant choice or null if no match
 */
export function resolveVariantChoice(
  userText: string,
  variantChoices: VariantChoice[]
): VariantChoice | null {
  if (!variantChoices || variantChoices.length === 0) {
    return null;
  }

  const trimmed = userText.trim();
  const lowerText = trimmed.toLowerCase();

  // Try ordinal patterns
  const ordinalPatterns = [
    /^#(\d+)$/i,
    /\boption\s*(\d+)\b/i,
    /\bnumber\s*(\d+)\b/i,
    /\bnr\.?\s*(\d+)\b/i,
    /\b(\d+)(?:st|nd|rd|th)\b/i,
    /^(\d+)$/,
  ];

  for (const pattern of ordinalPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index >= 1 && index <= variantChoices.length) {
        return variantChoices[index - 1];
      }
    }
  }

  // Try explicit identifier match
  for (const choice of variantChoices) {
    if (choice.variantProductId.toLowerCase() === lowerText) return choice;
    if (choice.partNo && choice.partNo.toLowerCase() === lowerText) return choice;
    if (choice.eanCode && choice.eanCode.toLowerCase() === lowerText) return choice;
    if (choice.uniqueName && choice.uniqueName.toLowerCase() === lowerText) return choice;
  }

  return null;
}
