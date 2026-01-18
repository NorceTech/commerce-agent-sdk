export type {
  VariantDimension,
  VariantOnHand,
  NormalizedVariant,
  NormalizedProductDetails,
  VariantAvailabilitySummary,
  ProductGetOnHand,
} from './productTypes.js';

export {
  MAX_VARIANTS,
  extractVariantDimensions,
  buildVariantLabel,
  normalizeVariant,
  computeBuyabilitySummary,
  aggregateDimensionValues,
  normalizeProductGet,
  extractVariantAvailabilitySummary,
  getRelevantOnHandFromNormalized,
} from './normalizeProductGet.js';

export type { VariantHints } from './variantHints.js';

export {
  MAX_HINT_DIMENSIONS,
  MAX_HINT_VALUES_PER_DIMENSION,
  buildVariantHints,
  buildVariantHintsFromVariants,
} from './variantHints.js';

export type { EnrichmentDecision } from './enrichmentPolicy.js';

export {
  MAX_ENRICH_GET,
  shouldEnrichSearchResults,
  selectProductsToEnrich,
} from './enrichmentPolicy.js';
