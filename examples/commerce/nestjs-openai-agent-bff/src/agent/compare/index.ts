/**
 * Compare mode module exports.
 */

export { MAX_COMPARE, MAX_FEATURES } from './compareTypes.js';
export type { CompareCandidateResult, CompareProductData, ComparisonSummaryResult } from './compareTypes.js';

export { looksLikeCompareIntent, extractOrdinals } from './comparePlanner.js';

export { selectCompareCandidates, buildCompareHint } from './selectCompareCandidates.js';

export { buildComparison, normalizeProductForComparison } from './buildComparison.js';

export { summarizeComparison, applyHighlightsToItems } from './summarizeComparison.js';
