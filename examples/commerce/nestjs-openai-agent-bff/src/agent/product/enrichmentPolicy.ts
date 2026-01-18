import type { LastResultItem } from '../../session/sessionTypes.js';

/**
 * Maximum number of products to enrich via product_get per search turn.
 * Keeps tool calls bounded to prevent fanout.
 */
export const MAX_ENRICH_GET = 3;

/**
 * Result of the enrichment policy check.
 */
export interface EnrichmentDecision {
  /** Whether enrichment should be triggered */
  shouldEnrich: boolean;
  /** Reason for the decision (for debugging) */
  reason: string;
  /** Product IDs to enrich (up to MAX_ENRICH_GET) */
  productIdsToEnrich: string[];
}

/**
 * Patterns that suggest user is asking about specific dimensions/variants/availability.
 * These are simple heuristics, not exhaustive phrase lists.
 * The main LLM uses PRODUCT_MEMORY + dimensionHints for actual interpretation.
 */
const DIMENSION_INTENT_PATTERNS = [
  /\b(size|sizes|sizing)\b/i,
  /\b(color|colors|colour|colours)\b/i,
  /\b(variant|variants|variation|variations)\b/i,
  /\b(available|availability|in stock|in-stock|instock)\b/i,
  /\b(buyable|purchasable|can buy|can purchase)\b/i,
  /\b(option|options)\b/i,
  /\b(dimension|dimensions)\b/i,
  /\b(voltage|wattage|power)\b/i,
  /\b(plug|connector)\b/i,
  /\b(material|fabric)\b/i,
  /\b(style|styles)\b/i,
  /\b(fit|fits)\b/i,
  /\b(length|width|height)\b/i,
  /\b(capacity|volume)\b/i,
];

/**
 * Patterns that suggest user is close to purchase intent.
 */
const PURCHASE_INTENT_PATTERNS = [
  /\b(add to cart|add to basket|buy|purchase|order|get this|want this|take this)\b/i,
  /\b(i('ll| will) take|i('ll| will) get|i('ll| will) buy)\b/i,
  /\b(checkout|check out)\b/i,
  /\b(this one|that one|the first|the second|option \d)\b/i,
];

/**
 * Checks if the user message suggests interest in specific dimensions or variants.
 */
function hasDimensionIntent(userMessage: string): boolean {
  return DIMENSION_INTENT_PATTERNS.some(pattern => pattern.test(userMessage));
}

/**
 * Checks if the user message suggests purchase intent.
 */
function hasPurchaseIntent(userMessage: string): boolean {
  return PURCHASE_INTENT_PATTERNS.some(pattern => pattern.test(userMessage));
}

/**
 * Checks if lastResults currently have availability signals.
 * Returns true if at least one item has buyableVariantCount defined.
 */
function hasAvailabilitySignals(lastResults: LastResultItem[] | undefined): boolean {
  if (!lastResults || lastResults.length === 0) {
    return false;
  }
  return lastResults.some(item => item.buyableVariantCount !== undefined);
}

/**
 * Determines whether search results should be enriched via product_get calls.
 * This is a heuristic to reduce dead ends by fetching variant availability
 * for top candidates when the user's intent suggests it would be helpful.
 *
 * Returns true only when:
 * - User asked about specific dimensions/variants/availability, OR
 * - User is close to purchase intent, OR
 * - lastResults currently have no availability signals
 *
 * @param userMessage - The user's message
 * @param lastResults - Current lastResults from working memory
 * @returns EnrichmentDecision with shouldEnrich flag and reason
 */
export function shouldEnrichSearchResults(
  userMessage: string,
  lastResults: LastResultItem[] | undefined
): EnrichmentDecision {
  // Check for dimension/variant interest
  if (hasDimensionIntent(userMessage)) {
    const productIds = (lastResults ?? [])
      .slice(0, MAX_ENRICH_GET)
      .map(item => item.productId);
    
    return {
      shouldEnrich: productIds.length > 0,
      reason: 'User asked about dimensions/variants/availability',
      productIdsToEnrich: productIds,
    };
  }

  // Check for purchase intent
  if (hasPurchaseIntent(userMessage)) {
    const productIds = (lastResults ?? [])
      .slice(0, MAX_ENRICH_GET)
      .map(item => item.productId);
    
    return {
      shouldEnrich: productIds.length > 0,
      reason: 'User shows purchase intent',
      productIdsToEnrich: productIds,
    };
  }

  // Check if lastResults lack availability signals
  if (!hasAvailabilitySignals(lastResults)) {
    const productIds = (lastResults ?? [])
      .slice(0, MAX_ENRICH_GET)
      .map(item => item.productId);
    
    return {
      shouldEnrich: productIds.length > 0,
      reason: 'lastResults lack availability signals',
      productIdsToEnrich: productIds,
    };
  }

  return {
    shouldEnrich: false,
    reason: 'No enrichment trigger detected',
    productIdsToEnrich: [],
  };
}

/**
 * Selects which product IDs should be enriched from a list of candidates.
 * Prioritizes products that don't already have availability data.
 * Caps at MAX_ENRICH_GET.
 *
 * @param candidates - List of candidate product IDs
 * @param existingAvailability - Map of productId to whether availability is known
 * @returns Array of product IDs to enrich (up to MAX_ENRICH_GET)
 */
export function selectProductsToEnrich(
  candidates: string[],
  existingAvailability: Map<string, boolean>
): string[] {
  // Prioritize products without existing availability data
  const withoutAvailability = candidates.filter(id => !existingAvailability.get(id));
  const withAvailability = candidates.filter(id => existingAvailability.get(id));
  
  // Take products without availability first, then fill with others
  const prioritized = [...withoutAvailability, ...withAvailability];
  
  return prioritized.slice(0, MAX_ENRICH_GET);
}
