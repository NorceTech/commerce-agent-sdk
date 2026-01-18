/**
 * Search fallback refinement builder.
 * 
 * This module provides utilities for building structured refinement actions
 * when a search returns 0 results or when the user might benefit from
 * narrowing/broadening their search.
 */

import type { RefinementAction } from '../../http/refinementTypes.js';
import { simplifySearchQueryWithDetails, broadenSearchQuery } from './querySimplifier.js';

/**
 * Information about a search attempt for building refinements.
 */
export interface SearchAttemptInfo {
  /** The original query from the user/model */
  originalQuery: string;
  /** The effective query sent to MCP (after simplification) */
  effectiveQuery: string;
  /** Whether the query was simplified */
  wasSimplified: boolean;
  /** Tokens that were dropped during simplification */
  droppedTokens?: string[];
  /** Whether a fallback broaden retry was attempted */
  fallbackRetryAttempted: boolean;
  /** The broadened query used for retry (if applicable) */
  broadenedQuery?: string;
  /** Number of results returned */
  resultCount: number;
}

/**
 * Builds refinement actions for a search that returned 0 results.
 * 
 * This function generates 2-4 structured refinement actions that the widget
 * can render as buttons for the user to click.
 * 
 * @param searchInfo - Information about the search attempt
 * @returns Array of refinement actions (2-4 actions)
 */
export function buildEmptySearchRefinements(searchInfo: SearchAttemptInfo): RefinementAction[] {
  const refinements: RefinementAction[] = [];
  
  // If we haven't tried broadening yet and there's a broader query available
  if (!searchInfo.fallbackRetryAttempted) {
    const broaderQuery = broadenSearchQuery(searchInfo.effectiveQuery);
    if (broaderQuery) {
      refinements.push({
        id: 'broaden_search',
        label: `Search for "${broaderQuery}"`,
        payload: {
          type: 'search_broaden',
          query: broaderQuery,
        },
      });
    }
  }
  
  // If we simplified the query and dropped tokens, offer to search with just the first keyword
  if (searchInfo.wasSimplified && searchInfo.droppedTokens && searchInfo.droppedTokens.length > 0) {
    const firstToken = searchInfo.effectiveQuery.split(/\s+/)[0];
    if (firstToken && firstToken !== searchInfo.effectiveQuery) {
      refinements.push({
        id: 'search_keyword_only',
        label: `Search for only "${firstToken}"`,
        payload: {
          type: 'search_broaden',
          query: firstToken,
        },
      });
    }
  }
  
  // If the original query is different from the effective query, offer to retry with original
  if (searchInfo.originalQuery !== searchInfo.effectiveQuery) {
    refinements.push({
      id: 'retry_original',
      label: `Try "${searchInfo.originalQuery}"`,
      payload: {
        type: 'search_retry',
        query: searchInfo.originalQuery,
      },
    });
  }
  
  // Always offer to remove constraints if we have dropped tokens
  if (searchInfo.droppedTokens && searchInfo.droppedTokens.length > 0) {
    refinements.push({
      id: 'remove_constraints',
      label: 'Remove constraints',
      payload: {
        type: 'remove_constraints',
        constraintsToRemove: searchInfo.droppedTokens,
      },
    });
  }
  
  // If we already tried broadening and still got 0 results, offer clarification
  if (searchInfo.fallbackRetryAttempted && searchInfo.resultCount === 0) {
    refinements.push({
      id: 'ask_clarify',
      label: 'Help me find what you need',
      payload: {
        type: 'ask_clarify',
        question: 'Could you describe what you\'re looking for in different words?',
      },
    });
  }
  
  // Always include at least one refinement for 0-result scenarios
  // This ensures the widget always has something to render
  if (refinements.length === 0 && searchInfo.resultCount === 0) {
    refinements.push({
      id: 'ask_clarify',
      label: 'Help me find what you need',
      payload: {
        type: 'ask_clarify',
        question: 'Could you describe what you\'re looking for in different words?',
      },
    });
  }
  
  // Cap at 4 refinements
  return refinements.slice(0, 4);
}

/**
 * Builds refinement actions for a search that returned results but might benefit from filtering.
 * 
 * This function generates optional refinement actions when results are broad
 * and the user might want to narrow them down.
 * 
 * @param searchInfo - Information about the search attempt
 * @param availableDimensions - Optional dimensions available for filtering (e.g., ["Color", "Size"])
 * @returns Array of refinement actions (0-2 actions)
 */
export function buildFilterRefinements(
  searchInfo: SearchAttemptInfo,
  availableDimensions?: string[]
): RefinementAction[] {
  const refinements: RefinementAction[] = [];
  
  // Only suggest filters if we have dimensions and results are potentially broad
  if (availableDimensions && availableDimensions.length > 0) {
    // Add up to 2 filter suggestions
    for (const dimension of availableDimensions.slice(0, 2)) {
      refinements.push({
        id: `filter_by_${dimension.toLowerCase().replace(/\s+/g, '_')}`,
        label: `Filter by ${dimension}`,
        payload: {
          type: 'filter_by_dimension',
          dimension,
        },
      });
    }
  }
  
  return refinements;
}

/**
 * Determines if refinements should be included in the response.
 * 
 * @param searchInfo - Information about the search attempt
 * @returns True if refinements should be included
 */
export function shouldIncludeRefinements(searchInfo: SearchAttemptInfo): boolean {
  // Include refinements if:
  // 1. Search returned 0 results
  // 2. Search was simplified and might have lost important terms
  if (searchInfo.resultCount === 0) {
    return true;
  }
  if (searchInfo.wasSimplified && searchInfo.droppedTokens && searchInfo.droppedTokens.length > 0) {
    return true;
  }
  return false;
}

/**
 * Builds a short explanation message for empty search results.
 * 
 * @param searchInfo - Information about the search attempt
 * @returns A user-friendly explanation message
 */
export function buildEmptySearchMessage(searchInfo: SearchAttemptInfo): string {
  if (searchInfo.fallbackRetryAttempted && searchInfo.broadenedQuery) {
    return `I couldn't find any products matching "${searchInfo.originalQuery}" or "${searchInfo.broadenedQuery}". Would you like to try a different search?`;
  }
  
  if (searchInfo.wasSimplified && searchInfo.droppedTokens && searchInfo.droppedTokens.length > 0) {
    return `I couldn't find any products matching "${searchInfo.originalQuery}". I tried simplifying the search but still found no results. Would you like to try a different approach?`;
  }
  
  return `I couldn't find any products matching "${searchInfo.originalQuery}". Would you like to try a different search?`;
}
