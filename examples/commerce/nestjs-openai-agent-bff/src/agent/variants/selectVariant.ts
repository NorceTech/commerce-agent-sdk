import type {
  NormalizedProductDetails,
  NormalizedVariant,
} from '../product/productTypes.js';

/**
 * Maximum number of variant options to show in disambiguation question.
 */
export const MAX_VARIANT_OPTIONS = 6;

/**
 * Minimum number of variant options to show (if available).
 */
export const MIN_VARIANT_OPTIONS = 3;

/**
 * Represents a buyable variant candidate for selection.
 */
export interface VariantCandidate {
  variantProductId: string;
  label: string;
  dimsMap: Record<string, string>;
  onHand: number;
  isBuyable: boolean;
  inStock: boolean;
  nextDeliveryDate?: string | null;
  partNo?: string;
  eanCode?: string;
  uniqueName?: string;
  name?: string;
}

/**
 * Result of variant selection when exactly one buyable variant is found.
 */
export interface SingleVariantResult {
  type: 'single';
  variant: VariantCandidate;
}

/**
 * Result of variant selection when multiple buyable variants are found.
 */
export interface MultipleVariantsResult {
  type: 'multiple';
  candidates: VariantCandidate[];
  message: string;
}

/**
 * Result of variant selection when no buyable variants are found.
 */
export interface NoBuyableVariantsResult {
  type: 'not_buyable';
  reason: string;
}

/**
 * Result of variant selection when product has no variants.
 */
export interface NoVariantsResult {
  type: 'no_variants';
  productIsBuyable: boolean;
}

/**
 * Union type for all possible variant selection results.
 */
export type VariantSelectionResult =
  | SingleVariantResult
  | MultipleVariantsResult
  | NoBuyableVariantsResult
  | NoVariantsResult;

/**
 * Builds a human-readable label for a variant using its dimensions.
 * Format: "Dimension1: Value1 - Dimension2: Value2 (in stock: N)" or "(out of stock)"
 *
 * @param variant - The normalized variant
 * @returns Human-readable label string
 */
export function buildVariantLabelForSelection(variant: NormalizedVariant): string {
  const parts: string[] = [];

  // Build dimension parts from dimsMap (already sorted by isPrimary in normalizeVariant)
  const dimEntries = Object.entries(variant.dimsMap);
  if (dimEntries.length > 0) {
    // Take up to 3 dimensions for the label
    const labelDims = dimEntries.slice(0, 3);
    for (const [name, value] of labelDims) {
      parts.push(`${name}: ${value}`);
    }
  } else if (variant.name) {
    // Fallback to variant name if no dimensions
    parts.push(variant.name);
  } else {
    parts.push('Variant');
  }

  // Add stock info
  const inStock = variant.onHand && variant.onHand.value > 0 && variant.onHand.isActive;
  if (inStock) {
    parts.push(`(in stock: ${variant.onHand!.value})`);
  } else {
    parts.push('(out of stock)');
  }

  return parts.join(' - ');
}

/**
 * Converts a NormalizedVariant to a VariantCandidate.
 *
 * @param variant - The normalized variant
 * @returns VariantCandidate object
 */
function toVariantCandidate(variant: NormalizedVariant): VariantCandidate {
  const inStock = Boolean(
    variant.onHand && variant.onHand.value > 0 && variant.onHand.isActive
  );

  return {
    variantProductId: variant.variantProductId,
    label: buildVariantLabelForSelection(variant),
    dimsMap: variant.dimsMap,
    onHand: variant.onHand?.value ?? 0,
    isBuyable: variant.isBuyable,
    inStock,
    nextDeliveryDate: variant.nextDeliveryDate,
    partNo: variant.partNo,
    eanCode: variant.eanCode,
    uniqueName: variant.uniqueName,
    name: variant.name,
  };
}

/**
 * Sorts variant candidates by buyability and stock availability.
 * Priority:
 * 1. isBuyable === true
 * 2. In stock (onHand.value > 0)
 * 3. Earliest nextDeliveryDate (if out of stock)
 *
 * @param candidates - Array of variant candidates
 * @returns Sorted array of variant candidates
 */
function sortVariantCandidates(candidates: VariantCandidate[]): VariantCandidate[] {
  return [...candidates].sort((a, b) => {
    // First: buyable variants first
    if (a.isBuyable !== b.isBuyable) {
      return a.isBuyable ? -1 : 1;
    }

    // Second: in-stock variants first
    if (a.inStock !== b.inStock) {
      return a.inStock ? -1 : 1;
    }

    // Third: higher stock first
    if (a.onHand !== b.onHand) {
      return b.onHand - a.onHand;
    }

    // Fourth: earlier delivery date first (for out-of-stock items)
    if (!a.inStock && !b.inStock) {
      const aDate = a.nextDeliveryDate ? new Date(a.nextDeliveryDate).getTime() : Infinity;
      const bDate = b.nextDeliveryDate ? new Date(b.nextDeliveryDate).getTime() : Infinity;
      return aDate - bDate;
    }

    return 0;
  });
}

/**
 * Builds a disambiguation message listing variant options.
 *
 * @param candidates - Array of variant candidates to list
 * @param productName - Optional product name for context
 * @returns Formatted message string
 */
export function buildVariantDisambiguationMessage(
  candidates: VariantCandidate[],
  productName?: string
): string {
  const intro = productName
    ? `"${productName}" comes in multiple variants. Which one would you like?`
    : 'This product comes in multiple variants. Which one would you like?';

  const options = candidates
    .slice(0, MAX_VARIANT_OPTIONS)
    .map((c, idx) => `${idx + 1}) ${c.label}`)
    .join('\n');

  return `${intro}\n\n${options}\n\nPlease reply with the option number (e.g., "1" or "option 2").`;
}

/**
 * Selects buyable variants from a product's variant list.
 * Returns different result types based on the number of buyable variants found.
 *
 * @param productDetails - Normalized product details including variants
 * @returns VariantSelectionResult indicating the selection outcome
 */
export function selectBuyableVariants(
  productDetails: NormalizedProductDetails
): VariantSelectionResult {
  // Check if product has no variants
  if (!productDetails.variants || productDetails.variants.length === 0) {
    return {
      type: 'no_variants',
      productIsBuyable: productDetails.isBuyable,
    };
  }

  // Filter to buyable variants only
  // NOTE: Variants must have isBuyable=true AND non-empty partNo to be addable to cart
  // MCP cart.addItem requires partNo as the item identifier
  const buyableVariants = productDetails.variants.filter(
    (v) => v.isBuyable && v.partNo && v.partNo.trim().length > 0
  );

  if (buyableVariants.length === 0) {
    // Check if there are buyable variants but they're missing partNo
    const buyableWithoutPartNo = productDetails.variants.filter(
      (v) => v.isBuyable && (!v.partNo || v.partNo.trim().length === 0)
    );
    if (buyableWithoutPartNo.length > 0) {
      return {
        type: 'not_buyable',
        reason: 'Buyable variants exist but are missing part numbers required for cart operations.',
      };
    }
    return {
      type: 'not_buyable',
      reason: 'No buyable variants available for this product.',
    };
  }

  // Convert to candidates and sort
  const candidates = buyableVariants.map(toVariantCandidate);
  const sortedCandidates = sortVariantCandidates(candidates);

  if (sortedCandidates.length === 1) {
    return {
      type: 'single',
      variant: sortedCandidates[0],
    };
  }

  // Multiple candidates - return for disambiguation
  const displayCandidates = sortedCandidates.slice(0, MAX_VARIANT_OPTIONS);
  const message = buildVariantDisambiguationMessage(displayCandidates, productDetails.name);

  return {
    type: 'multiple',
    candidates: displayCandidates,
    message,
  };
}

/**
 * Finds a variant by its productId from a list of candidates.
 *
 * @param candidates - Array of variant candidates
 * @param variantProductId - The variant product ID to find
 * @returns The matching candidate or undefined
 */
export function findVariantById(
  candidates: VariantCandidate[],
  variantProductId: string
): VariantCandidate | undefined {
  return candidates.find((c) => c.variantProductId === variantProductId);
}

/**
 * Finds a variant by index (1-based) from a list of candidates.
 *
 * @param candidates - Array of variant candidates
 * @param index - 1-based index
 * @returns The matching candidate or undefined
 */
export function findVariantByIndex(
  candidates: VariantCandidate[],
  index: number
): VariantCandidate | undefined {
  if (index < 1 || index > candidates.length) {
    return undefined;
  }
  return candidates[index - 1];
}

/**
 * Finds a variant by explicit identifier (partNo, eanCode, uniqueName).
 *
 * @param candidates - Array of variant candidates
 * @param identifier - The identifier to search for
 * @returns The matching candidate or undefined
 */
export function findVariantByIdentifier(
  candidates: VariantCandidate[],
  identifier: string
): VariantCandidate | undefined {
  const lowerIdentifier = identifier.toLowerCase();

  return candidates.find((c) => {
    if (c.variantProductId.toLowerCase() === lowerIdentifier) return true;
    if (c.partNo && c.partNo.toLowerCase() === lowerIdentifier) return true;
    if (c.eanCode && c.eanCode.toLowerCase() === lowerIdentifier) return true;
    if (c.uniqueName && c.uniqueName.toLowerCase() === lowerIdentifier) return true;
    return false;
  });
}
