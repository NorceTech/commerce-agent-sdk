/**
 * Select compare candidates from working memory.
 * 
 * This module resolves which products to compare based on user text
 * and working memory (lastResults, shortlist).
 */

import type { WorkingMemory, LastResultItem, ShortlistItem } from '../../session/sessionTypes.js';
import { MAX_COMPARE, CompareCandidateResult } from './compareTypes.js';
import { extractOrdinals } from './comparePlanner.js';

/**
 * Selects up to MAX_COMPARE (3) products to compare from working memory.
 * 
 * Resolution priority:
 * 1. Explicit ordinals in user text (e.g., "option 1 and 2" -> lastResults[0], lastResults[1])
 * 2. Explicit productIds/partNos mentioned in user text
 * 3. Shortlist items if user says "compare these" or similar
 * 
 * @param userText - The user's message text
 * @param workingMemory - The session's working memory containing lastResults and shortlist
 * @returns CompareCandidateResult with selected productIds and reasons, or null if cannot resolve
 */
export function selectCompareCandidates(
  userText: string,
  workingMemory: WorkingMemory | undefined
): CompareCandidateResult | null {
  if (!workingMemory) {
    return null;
  }

  const lastResults = workingMemory.lastResults ?? [];
  const shortlist = workingMemory.shortlist ?? [];

  // Try to resolve from ordinals first
  const ordinalResult = tryResolveFromOrdinals(userText, lastResults);
  if (ordinalResult && ordinalResult.productIds.length >= 2) {
    return ordinalResult;
  }

  // Try to resolve from explicit productIds/partNos
  const explicitResult = tryResolveFromExplicitIds(userText, lastResults);
  if (explicitResult && explicitResult.productIds.length >= 2) {
    return explicitResult;
  }

  // Try to resolve from shortlist if user references "these" or similar
  const shortlistResult = tryResolveFromShortlist(userText, shortlist, lastResults);
  if (shortlistResult && shortlistResult.productIds.length >= 2) {
    return shortlistResult;
  }

  // If we have partial results, combine them
  const combined = combinePartialResults(ordinalResult, explicitResult, shortlistResult);
  if (combined && combined.productIds.length >= 2) {
    return combined;
  }

  return null;
}

/**
 * Tries to resolve products from ordinal references in user text.
 * 
 * @param userText - The user's message text
 * @param lastResults - Array of last search results
 * @returns CompareCandidateResult or null
 */
function tryResolveFromOrdinals(
  userText: string,
  lastResults: LastResultItem[]
): CompareCandidateResult | null {
  if (lastResults.length === 0) {
    return null;
  }

  const ordinals = extractOrdinals(userText);
  if (ordinals.length === 0) {
    return null;
  }

  const productIds: string[] = [];
  const reasons: CompareCandidateResult['reasons'] = [];

  for (const ordinal of ordinals) {
    // ordinal is 1-based, array is 0-based
    const index = ordinal - 1;
    if (index >= 0 && index < lastResults.length) {
      const item = lastResults[index];
      if (!productIds.includes(item.productId)) {
        productIds.push(item.productId);
        reasons.push({
          productId: item.productId,
          source: 'lastResults',
          index: ordinal,
          matchType: 'ordinal',
        });
      }
    }

    // Cap at MAX_COMPARE
    if (productIds.length >= MAX_COMPARE) {
      break;
    }
  }

  if (productIds.length === 0) {
    return null;
  }

  return { productIds, reasons };
}

/**
 * Tries to resolve products from explicit productIds or partNos in user text.
 * 
 * @param userText - The user's message text
 * @param lastResults - Array of last search results
 * @returns CompareCandidateResult or null
 */
function tryResolveFromExplicitIds(
  userText: string,
  lastResults: LastResultItem[]
): CompareCandidateResult | null {
  if (lastResults.length === 0) {
    return null;
  }

  const lowerText = userText.toLowerCase();
  const productIds: string[] = [];
  const reasons: CompareCandidateResult['reasons'] = [];

  for (const item of lastResults) {
    // Check if productId is mentioned
    if (item.productId && lowerText.includes(item.productId.toLowerCase())) {
      if (!productIds.includes(item.productId)) {
        productIds.push(item.productId);
        reasons.push({
          productId: item.productId,
          source: 'lastResults',
          index: item.index,
          matchType: 'productId',
        });
      }
    }

    // Check if partNo is mentioned
    if (item.partNo && lowerText.includes(item.partNo.toLowerCase())) {
      if (!productIds.includes(item.productId)) {
        productIds.push(item.productId);
        reasons.push({
          productId: item.productId,
          source: 'lastResults',
          index: item.index,
          matchType: 'partNo',
        });
      }
    }

    // Cap at MAX_COMPARE
    if (productIds.length >= MAX_COMPARE) {
      break;
    }
  }

  if (productIds.length === 0) {
    return null;
  }

  return { productIds, reasons };
}

/**
 * Tries to resolve products from shortlist when user references "these" or similar.
 * 
 * @param userText - The user's message text
 * @param shortlist - Array of shortlisted products
 * @param lastResults - Array of last search results (for fallback)
 * @returns CompareCandidateResult or null
 */
function tryResolveFromShortlist(
  userText: string,
  shortlist: ShortlistItem[],
  lastResults: LastResultItem[]
): CompareCandidateResult | null {
  const lowerText = userText.toLowerCase();

  // Check for references to "these", "those", "them", "both", "all"
  const shortlistTriggers = ['these', 'those', 'them', 'both', 'all'];
  const hasShortlistTrigger = shortlistTriggers.some(trigger => lowerText.includes(trigger));

  if (!hasShortlistTrigger) {
    return null;
  }

  // If shortlist has items, use them
  if (shortlist.length >= 2) {
    const productIds = shortlist.slice(0, MAX_COMPARE).map(item => item.productId);
    const reasons: CompareCandidateResult['reasons'] = productIds.map(productId => ({
      productId,
      source: 'shortlist' as const,
      matchType: 'shortlist' as const,
    }));
    return { productIds, reasons };
  }

  // Fallback: if lastResults has exactly 2-3 items, use them
  if (lastResults.length >= 2 && lastResults.length <= MAX_COMPARE) {
    const productIds = lastResults.map(item => item.productId);
    const reasons: CompareCandidateResult['reasons'] = lastResults.map(item => ({
      productId: item.productId,
      source: 'lastResults' as const,
      index: item.index,
      matchType: 'ordinal' as const,
    }));
    return { productIds, reasons };
  }

  return null;
}

/**
 * Combines partial results from different resolution methods.
 * 
 * @param results - Array of partial results to combine
 * @returns Combined CompareCandidateResult or null
 */
function combinePartialResults(
  ...results: (CompareCandidateResult | null)[]
): CompareCandidateResult | null {
  const productIds: string[] = [];
  const reasons: CompareCandidateResult['reasons'] = [];

  for (const result of results) {
    if (!result) continue;

    for (let i = 0; i < result.productIds.length; i++) {
      const productId = result.productIds[i];
      if (!productIds.includes(productId)) {
        productIds.push(productId);
        reasons.push(result.reasons[i]);
      }

      if (productIds.length >= MAX_COMPARE) {
        break;
      }
    }

    if (productIds.length >= MAX_COMPARE) {
      break;
    }
  }

  if (productIds.length === 0) {
    return null;
  }

  return { productIds, reasons };
}

/**
 * Builds a compare hint message to inject into the conversation context.
 * This guides the model to call product_get for the selected products.
 * 
 * @param result - The compare candidate result
 * @returns A hint message string
 */
export function buildCompareHint(result: CompareCandidateResult): string {
  const ids = result.productIds.join(', ');
  const reasonSummary = result.reasons
    .map(r => `${r.productId} (${r.matchType} from ${r.source}${r.index ? ` index ${r.index}` : ''})`)
    .join('; ');
  
  return `CompareHint: user wants to compare ${result.productIds.length} products. Selected: ${ids}. Reasons: ${reasonSummary}. Call product_get for each to get details for comparison.`;
}
