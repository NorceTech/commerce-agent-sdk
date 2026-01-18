import type { ProductCard } from '../widget/types';

export interface ProductLabel {
  primary: string;
  secondary?: string;
}

/**
 * Formats a product card's label for display.
 * Returns a primary label (always the title) and an optional secondary label (variantName).
 *
 * Rules:
 * - primary = card.title (always)
 * - secondary = card.variantName when:
 *   - variantName is present
 *   - variantName is not empty/whitespace
 *   - variantName is not identical to title
 */
export function formatProductLabel(card: ProductCard): ProductLabel {
  const primary = card.title;
  let secondary: string | undefined;

  if (
    card.variantName != null &&
    card.variantName.trim() !== '' &&
    card.variantName !== card.title
  ) {
    secondary = card.variantName;
  }

  return { primary, secondary };
}

/**
 * Formats a product card's label as a single display string.
 * Useful for single-line displays or aria-labels.
 *
 * Format: "title — variantName" when variantName is present, otherwise just "title"
 */
export function formatProductLabelString(card: ProductCard): string {
  const { primary, secondary } = formatProductLabel(card);
  return secondary ? `${primary} — ${secondary}` : primary;
}
