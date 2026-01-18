import type { WorkingMemory, LastResultItem, VariantChoice, ActiveChoiceSet } from '../session/sessionTypes.js';
import type { ChoiceOption } from '../http/choiceTypes.js';

/**
 * Maximum number of items to keep in lastResults.
 */
export const MAX_LAST_RESULTS = 10;

/**
 * Result of reference resolution attempt for products.
 */
export interface ResolverResult {
  productId: string;
  index: number;
  confidence: 'high' | 'medium';
  reason: string;
}

/**
 * Result of reference resolution attempt for variant choices.
 */
export interface VariantResolverResult {
  variantProductId: string;
  partNo?: string;
  index: number;
  confidence: 'high' | 'medium';
  reason: string;
  parentProductId?: string;
}

/**
 * Ordinal patterns for reference resolution.
 * These are language-agnostic patterns that match common ordinal references.
 * Format: regex pattern -> 1-based index extraction function
 */
const ORDINAL_PATTERNS: Array<{ pattern: RegExp; getIndex: (match: RegExpMatchArray) => number }> = [
  // "#2", "#3", etc.
  { pattern: /^#(\d+)$/i, getIndex: (m) => parseInt(m[1], 10) },
  // "option 2", "option 3", etc.
  { pattern: /\boption\s*(\d+)\b/i, getIndex: (m) => parseInt(m[1], 10) },
  // "number 2", "number 3", etc.
  { pattern: /\bnumber\s*(\d+)\b/i, getIndex: (m) => parseInt(m[1], 10) },
  // "nr 2", "nr. 2", etc.
  { pattern: /\bnr\.?\s*(\d+)\b/i, getIndex: (m) => parseInt(m[1], 10) },
  // "2nd", "3rd", "4th", etc.
  { pattern: /\b(\d+)(?:st|nd|rd|th)\b/i, getIndex: (m) => parseInt(m[1], 10) },
  // Just a number at the start or end: "2", "show me 2"
  { pattern: /^(\d+)$/, getIndex: (m) => parseInt(m[1], 10) },
];

/**
 * Attempts to resolve a user reference to a productId from working memory.
 * 
 * This is a deterministic fallback resolver that handles:
 * 1. Explicit ordinal patterns: "#2", "2nd", "number 2", "option 2", "nr 2"
 * 2. Direct id/sku mentions if user types exact productId/partNo present in lastResults
 * 
 * It does NOT handle descriptive references like "the black one" or "the cheaper one" -
 * those are left to the model using PRODUCT_MEMORY context.
 * 
 * @param userText - The user's message text
 * @param workingMemory - The session's working memory containing lastResults
 * @returns ResolverResult if a match is found with high confidence, null otherwise
 */
export function resolveCandidate(
  userText: string,
  workingMemory: WorkingMemory | undefined
): ResolverResult | null {
  if (!workingMemory?.lastResults || workingMemory.lastResults.length === 0) {
    return null;
  }

  const lastResults = workingMemory.lastResults;
  const trimmedText = userText.trim();

  // Try ordinal patterns first
  const ordinalResult = tryOrdinalPatterns(trimmedText, lastResults);
  if (ordinalResult) {
    return ordinalResult;
  }

  // Try exact productId/partNo match
  const exactMatch = tryExactIdMatch(trimmedText, lastResults);
  if (exactMatch) {
    return exactMatch;
  }

  return null;
}

/**
 * Attempts to match ordinal patterns in the user text.
 * 
 * @param text - Trimmed user text
 * @param lastResults - Array of last search results
 * @returns ResolverResult if ordinal pattern matches, null otherwise
 */
function tryOrdinalPatterns(
  text: string,
  lastResults: LastResultItem[]
): ResolverResult | null {
  for (const { pattern, getIndex } of ORDINAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const index = getIndex(match);
      // Validate index is within bounds (1-based)
      if (index >= 1 && index <= lastResults.length) {
        const item = lastResults[index - 1];
        return {
          productId: item.productId,
          index: item.index,
          confidence: 'high',
          reason: `ordinal pattern "${match[0]}" matched index ${index}`,
        };
      }
    }
  }
  return null;
}

/**
 * Attempts to find an exact match for productId or partNo in the user text.
 * 
 * @param text - Trimmed user text
 * @param lastResults - Array of last search results
 * @returns ResolverResult if exact id/sku match found, null otherwise
 */
function tryExactIdMatch(
  text: string,
  lastResults: LastResultItem[]
): ResolverResult | null {
  const lowerText = text.toLowerCase();

  for (const item of lastResults) {
    // Check exact productId match (case-insensitive)
    if (item.productId && lowerText.includes(item.productId.toLowerCase())) {
      return {
        productId: item.productId,
        index: item.index,
        confidence: 'high',
        reason: `exact productId "${item.productId}" found in text`,
      };
    }

    // Check exact partNo match (case-insensitive)
    if (item.partNo && lowerText.includes(item.partNo.toLowerCase())) {
      return {
        productId: item.productId,
        index: item.index,
        confidence: 'high',
        reason: `exact partNo "${item.partNo}" found in text`,
      };
    }
  }

  return null;
}

/**
 * Checks if the user message looks like a selection intent.
 * Used to determine whether to inject a resolver hint.
 * 
 * Heuristics:
 * - Short message (< 50 chars) with selection keywords
 * - Contains ordinal patterns: "#2", "2nd", "option 2", etc.
 * - Just a number: "2", "3", etc.
 * 
 * @param userText - The user's message text
 * @returns true if the message looks like a selection intent
 */
export function looksLikeSelectionIntent(userText: string): boolean {
  const trimmed = userText.trim();
  
  // Check for ordinal patterns first (works for any message length)
  for (const { pattern } of ORDINAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  
  // Short messages with selection keywords are likely selections
  if (trimmed.length < 50) {
    const lowerText = trimmed.toLowerCase();
    const selectionKeywords = ['that', 'this', 'option', '#', 'one', 'number', 'nr', 'like'];
    return selectionKeywords.some(keyword => lowerText.includes(keyword));
  }
  
  return false;
}

/**
 * Builds a resolver hint message to inject into the conversation context.
 * This guides the model to use the resolved productId without bypassing it.
 * 
 * @param result - The resolver result
 * @returns A hint message string
 */
export function buildResolverHint(result: ResolverResult): string {
  return `ResolverHint: user likely refers to productId="${result.productId}" from lastResults index=${result.index} (${result.reason})`;
}

/**
 * Attempts to resolve a user reference to a variant from variantChoices in working memory.
 * 
 * This handles:
 * 1. Explicit ordinal patterns: "#2", "2nd", "number 2", "option 2", "nr 2"
 * 2. Direct identifier mentions: exact variantProductId, partNo, eanCode, uniqueName
 * 
 * It does NOT handle descriptive references like "the black one" or "the larger one" -
 * those are left to the model using the variant labels.
 * 
 * @param userText - The user's message text
 * @param workingMemory - The session's working memory containing variantChoices
 * @returns VariantResolverResult if a match is found, null otherwise
 */
export function resolveVariantChoice(
  userText: string,
  workingMemory: WorkingMemory | undefined
): VariantResolverResult | null {
  if (!workingMemory?.variantChoices || workingMemory.variantChoices.length === 0) {
    return null;
  }

  const variantChoices = workingMemory.variantChoices;
  const trimmedText = userText.trim();

  // Try ordinal patterns first
  const ordinalResult = tryVariantOrdinalPatterns(trimmedText, variantChoices);
  if (ordinalResult) {
    ordinalResult.parentProductId = workingMemory.variantChoicesParentProductId;
    return ordinalResult;
  }

  // Try exact identifier match
  const exactMatch = tryVariantExactIdMatch(trimmedText, variantChoices);
  if (exactMatch) {
    exactMatch.parentProductId = workingMemory.variantChoicesParentProductId;
    return exactMatch;
  }

  return null;
}

/**
 * Attempts to match ordinal patterns in the user text for variant choices.
 * 
 * @param text - Trimmed user text
 * @param variantChoices - Array of variant choices
 * @returns VariantResolverResult if ordinal pattern matches, null otherwise
 */
function tryVariantOrdinalPatterns(
  text: string,
  variantChoices: VariantChoice[]
): VariantResolverResult | null {
  for (const { pattern, getIndex } of ORDINAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const index = getIndex(match);
      // Validate index is within bounds (1-based)
      if (index >= 1 && index <= variantChoices.length) {
        const choice = variantChoices[index - 1];
        return {
          variantProductId: choice.variantProductId,
          partNo: choice.partNo,
          index: choice.index,
          confidence: 'high',
          reason: `ordinal pattern "${match[0]}" matched variant index ${index}`,
        };
      }
    }
  }
  return null;
}

/**
 * Attempts to find an exact match for variant identifiers in the user text.
 * Checks: variantProductId, partNo, eanCode, uniqueName
 * 
 * @param text - Trimmed user text
 * @param variantChoices - Array of variant choices
 * @returns VariantResolverResult if exact identifier match found, null otherwise
 */
function tryVariantExactIdMatch(
  text: string,
  variantChoices: VariantChoice[]
): VariantResolverResult | null {
  const lowerText = text.toLowerCase();

  for (const choice of variantChoices) {
    // Check exact variantProductId match (case-insensitive)
    if (choice.variantProductId && lowerText.includes(choice.variantProductId.toLowerCase())) {
      return {
        variantProductId: choice.variantProductId,
        partNo: choice.partNo,
        index: choice.index,
        confidence: 'high',
        reason: `exact variantProductId "${choice.variantProductId}" found in text`,
      };
    }

    // Check exact partNo match (case-insensitive)
    if (choice.partNo && lowerText.includes(choice.partNo.toLowerCase())) {
      return {
        variantProductId: choice.variantProductId,
        partNo: choice.partNo,
        index: choice.index,
        confidence: 'high',
        reason: `exact partNo "${choice.partNo}" found in text`,
      };
    }

    // Check exact eanCode match (case-insensitive)
    if (choice.eanCode && lowerText.includes(choice.eanCode.toLowerCase())) {
      return {
        variantProductId: choice.variantProductId,
        partNo: choice.partNo,
        index: choice.index,
        confidence: 'high',
        reason: `exact eanCode "${choice.eanCode}" found in text`,
      };
    }

    // Check exact uniqueName match (case-insensitive)
    if (choice.uniqueName && lowerText.includes(choice.uniqueName.toLowerCase())) {
      return {
        variantProductId: choice.variantProductId,
        partNo: choice.partNo,
        index: choice.index,
        confidence: 'high',
        reason: `exact uniqueName "${choice.uniqueName}" found in text`,
      };
    }
  }

  return null;
}

/**
 * Builds a resolver hint message for variant resolution.
 * This guides the model to use the resolved variantProductId.
 * 
 * @param result - The variant resolver result
 * @returns A hint message string
 */
export function buildVariantResolverHint(result: VariantResolverResult): string {
  return `VariantResolverHint: user selected variantProductId="${result.variantProductId}" from variantChoices index=${result.index} (${result.reason})`;
}

/**
 * Result of reference resolution attempt for active choice sets.
 */
export interface ActiveChoiceResolverResult {
  choiceId: string;
  index: number;
  confidence: 'high' | 'medium';
  reason: string;
  kind: 'variant' | 'product' | 'generic';
  parentProductId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Attempts to resolve a user reference to a choice from activeChoiceSet in working memory.
 * 
 * This handles:
 * 1. Explicit ordinal patterns: "#2", "2nd", "number 2", "option 2", "nr 2"
 * 2. Direct identifier mentions: exact choice id
 * 
 * This function provides deterministic resolution of "option N" references
 * when the widget sends back a choice selection.
 * 
 * @param userText - The user's message text
 * @param workingMemory - The session's working memory containing activeChoiceSet
 * @returns ActiveChoiceResolverResult if a match is found, null otherwise
 */
export function resolveActiveChoice(
  userText: string,
  workingMemory: WorkingMemory | undefined
): ActiveChoiceResolverResult | null {
  if (!workingMemory?.activeChoiceSet || workingMemory.activeChoiceSet.options.length === 0) {
    return null;
  }

  const activeChoiceSet = workingMemory.activeChoiceSet;
  const trimmedText = userText.trim();

  // Try ordinal patterns first
  const ordinalResult = tryActiveChoiceOrdinalPatterns(trimmedText, activeChoiceSet);
  if (ordinalResult) {
    return ordinalResult;
  }

  // Try exact id match
  const exactMatch = tryActiveChoiceExactIdMatch(trimmedText, activeChoiceSet);
  if (exactMatch) {
    return exactMatch;
  }

  return null;
}

/**
 * Attempts to match ordinal patterns in the user text for active choice set.
 * 
 * @param text - Trimmed user text
 * @param activeChoiceSet - The active choice set
 * @returns ActiveChoiceResolverResult if ordinal pattern matches, null otherwise
 */
function tryActiveChoiceOrdinalPatterns(
  text: string,
  activeChoiceSet: ActiveChoiceSet
): ActiveChoiceResolverResult | null {
  for (const { pattern, getIndex } of ORDINAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const index = getIndex(match);
      // Validate index is within bounds (1-based)
      if (index >= 1 && index <= activeChoiceSet.options.length) {
        const option = activeChoiceSet.options[index - 1];
        return {
          choiceId: option.id,
          index,
          confidence: 'high',
          reason: `ordinal pattern "${match[0]}" matched choice index ${index}`,
          kind: activeChoiceSet.kind,
          parentProductId: activeChoiceSet.parentProductId,
          meta: option.meta,
        };
      }
    }
  }
  return null;
}

/**
 * Attempts to find an exact match for choice id in the user text.
 * 
 * @param text - Trimmed user text
 * @param activeChoiceSet - The active choice set
 * @returns ActiveChoiceResolverResult if exact id match found, null otherwise
 */
function tryActiveChoiceExactIdMatch(
  text: string,
  activeChoiceSet: ActiveChoiceSet
): ActiveChoiceResolverResult | null {
  const lowerText = text.toLowerCase();

  for (let i = 0; i < activeChoiceSet.options.length; i++) {
    const option = activeChoiceSet.options[i];
    
    // Check exact id match (case-insensitive)
    if (option.id && lowerText.includes(option.id.toLowerCase())) {
      return {
        choiceId: option.id,
        index: i + 1,
        confidence: 'high',
        reason: `exact choice id "${option.id}" found in text`,
        kind: activeChoiceSet.kind,
        parentProductId: activeChoiceSet.parentProductId,
        meta: option.meta,
      };
    }

    // For variant choices, also check partNo in meta
    if (activeChoiceSet.kind === 'variant' && option.meta?.partNo) {
      const partNo = String(option.meta.partNo);
      if (lowerText.includes(partNo.toLowerCase())) {
        return {
          choiceId: option.id,
          index: i + 1,
          confidence: 'high',
          reason: `exact partNo "${partNo}" found in text`,
          kind: activeChoiceSet.kind,
          parentProductId: activeChoiceSet.parentProductId,
          meta: option.meta,
        };
      }
    }
  }

  return null;
}

/**
 * Builds a resolver hint message for active choice resolution.
 * This guides the model to use the resolved choice id.
 * 
 * @param result - The active choice resolver result
 * @returns A hint message string
 */
export function buildActiveChoiceResolverHint(result: ActiveChoiceResolverResult): string {
  return `ActiveChoiceResolverHint: user selected choiceId="${result.choiceId}" from activeChoiceSet index=${result.index} kind=${result.kind} (${result.reason})`;
}
