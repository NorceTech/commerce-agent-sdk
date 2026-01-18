/**
 * Type definitions for compare mode functionality.
 */

/**
 * Maximum number of products that can be compared at once.
 */
export const MAX_COMPARE = 3;

/**
 * Maximum number of features to include in the comparison table.
 */
export const MAX_FEATURES = 8;

/**
 * Result of selecting compare candidates from working memory.
 */
export interface CompareCandidateResult {
  productIds: string[];
  reasons: Array<{
    productId: string;
    source: 'lastResults' | 'shortlist' | 'explicit';
    index?: number;
    matchType: 'ordinal' | 'productId' | 'partNo' | 'shortlist';
  }>;
}

/**
 * Normalized product data for comparison building.
 */
export interface CompareProductData {
  productId: string;
  name: string;
  brand?: string;
  price?: {
    amount?: number;
    currency?: string;
    formatted?: string;
  };
  attributes: Record<string, string | number | boolean | null>;
  url?: string;
}

/**
 * Result of the comparison summarization.
 */
export interface ComparisonSummaryResult {
  summaryText: string;
  perProductHighlights: Map<string, string[]>;
}
