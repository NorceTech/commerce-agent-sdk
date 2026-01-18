/**
 * Search module exports.
 * 
 * This module provides utilities for simplifying and broadening search queries
 * to make them compatible with naive/full-text search backends, as well as
 * building structured refinement actions for search fallback scenarios.
 */

export {
  simplifySearchQuery,
  simplifySearchQueryWithDetails,
  broadenSearchQuery,
  type SimplifyResult,
} from './querySimplifier.js';

export {
  buildEmptySearchRefinements,
  buildFilterRefinements,
  shouldIncludeRefinements,
  buildEmptySearchMessage,
  type SearchAttemptInfo,
} from './searchFallbackRefinements.js';
