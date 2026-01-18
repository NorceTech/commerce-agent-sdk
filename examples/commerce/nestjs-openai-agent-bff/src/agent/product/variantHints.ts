import type { NormalizedProductDetails, NormalizedVariant, VariantDimension } from './productTypes.js';

/**
 * Maximum number of dimensions to include in dimension hints.
 */
export const MAX_HINT_DIMENSIONS = 6;

/**
 * Maximum number of values per dimension in dimension hints.
 */
export const MAX_HINT_VALUES_PER_DIMENSION = 10;

/**
 * Result of building variant hints from product details.
 */
export interface VariantHints {
  /** Number of buyable variants (isBuyable === true) */
  buyableVariantCount: number;
  /** Number of buyable variants that are in stock (isBuyable && onHand.value > 0 && onHand.isActive) */
  inStockBuyableVariantCount: number;
  /** Generic dimension hints with capped values. Keys are dimension names, values are arrays of unique values. */
  dimensionHints: Record<string, string[]>;
}

/**
 * Checks if a variant is in stock (has positive onHand value and is active).
 */
function isVariantInStock(variant: NormalizedVariant): boolean {
  return variant.onHand !== undefined && variant.onHand.value > 0 && variant.onHand.isActive;
}

/**
 * Aggregates dimension values from buyable variants only.
 * Returns a map of dimension name to set of unique values.
 * Prefers dimensions marked as isPrimary when selecting which to include.
 *
 * @param variants - Array of normalized variants
 * @returns Map of dimension name to set of unique values
 */
function aggregateBuyableVariantDimensions(
  variants: NormalizedVariant[]
): { dimensionValues: Map<string, Set<string>>; primaryDimensions: Set<string> } {
  const dimensionValues = new Map<string, Set<string>>();
  const primaryDimensions = new Set<string>();

  for (const variant of variants) {
    if (!variant.isBuyable) continue;

    for (const dim of variant.dimensions) {
      if (!dimensionValues.has(dim.name)) {
        dimensionValues.set(dim.name, new Set());
      }
      dimensionValues.get(dim.name)!.add(dim.value);

      if (dim.isPrimary === true) {
        primaryDimensions.add(dim.name);
      }
    }
  }

  return { dimensionValues, primaryDimensions };
}

/**
 * Selects which dimensions to include in hints, preferring primary dimensions.
 * Caps at MAX_HINT_DIMENSIONS.
 *
 * @param dimensionValues - Map of dimension name to set of values
 * @param primaryDimensions - Set of dimension names marked as primary
 * @returns Array of dimension names to include
 */
function selectDimensionsToInclude(
  dimensionValues: Map<string, Set<string>>,
  primaryDimensions: Set<string>
): string[] {
  const allDimensions = Array.from(dimensionValues.keys());

  // Sort: primary dimensions first, then by number of values (descending)
  allDimensions.sort((a, b) => {
    const aIsPrimary = primaryDimensions.has(a) ? 0 : 1;
    const bIsPrimary = primaryDimensions.has(b) ? 0 : 1;

    if (aIsPrimary !== bIsPrimary) {
      return aIsPrimary - bIsPrimary;
    }

    // Secondary sort by number of values (more values = more interesting)
    const aValues = dimensionValues.get(a)?.size ?? 0;
    const bValues = dimensionValues.get(b)?.size ?? 0;
    return bValues - aValues;
  });

  return allDimensions.slice(0, MAX_HINT_DIMENSIONS);
}

/**
 * Builds variant hints from normalized product details.
 * Aggregates availability and dimension information from buyable variants only.
 *
 * @param productDetails - Normalized product details with variants
 * @returns VariantHints with buyable counts and dimension hints
 */
export function buildVariantHints(productDetails: NormalizedProductDetails): VariantHints {
  const { variants } = productDetails;

  // Count buyable and in-stock buyable variants
  let buyableVariantCount = 0;
  let inStockBuyableVariantCount = 0;

  for (const variant of variants) {
    if (variant.isBuyable) {
      buyableVariantCount++;
      if (isVariantInStock(variant)) {
        inStockBuyableVariantCount++;
      }
    }
  }

  // Aggregate dimension values from buyable variants only
  const { dimensionValues, primaryDimensions } = aggregateBuyableVariantDimensions(variants);

  // Select which dimensions to include (prefer primary, cap at MAX_HINT_DIMENSIONS)
  const selectedDimensions = selectDimensionsToInclude(dimensionValues, primaryDimensions);

  // Build dimension hints with capped values
  const dimensionHints: Record<string, string[]> = {};
  for (const dimName of selectedDimensions) {
    const values = dimensionValues.get(dimName);
    if (values) {
      dimensionHints[dimName] = Array.from(values).slice(0, MAX_HINT_VALUES_PER_DIMENSION);
    }
  }

  return {
    buyableVariantCount,
    inStockBuyableVariantCount,
    dimensionHints,
  };
}

/**
 * Builds variant hints from a subset of variants (e.g., only buyable variants).
 * This is useful when you want to compute hints for a filtered set of variants.
 *
 * @param variants - Array of normalized variants to compute hints from
 * @returns VariantHints with counts and dimension hints
 */
export function buildVariantHintsFromVariants(variants: NormalizedVariant[]): VariantHints {
  let buyableVariantCount = 0;
  let inStockBuyableVariantCount = 0;

  for (const variant of variants) {
    if (variant.isBuyable) {
      buyableVariantCount++;
      if (isVariantInStock(variant)) {
        inStockBuyableVariantCount++;
      }
    }
  }

  const { dimensionValues, primaryDimensions } = aggregateBuyableVariantDimensions(variants);
  const selectedDimensions = selectDimensionsToInclude(dimensionValues, primaryDimensions);

  const dimensionHints: Record<string, string[]> = {};
  for (const dimName of selectedDimensions) {
    const values = dimensionValues.get(dimName);
    if (values) {
      dimensionHints[dimName] = Array.from(values).slice(0, MAX_HINT_VALUES_PER_DIMENSION);
    }
  }

  return {
    buyableVariantCount,
    inStockBuyableVariantCount,
    dimensionHints,
  };
}
