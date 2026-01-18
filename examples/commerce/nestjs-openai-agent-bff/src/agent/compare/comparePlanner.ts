/**
 * Compare intent detection and planning.
 * 
 * This module provides lightweight heuristics to detect if a user message
 * likely requests a product comparison. It does NOT hardcode language-heavy
 * phrase lists - it uses minimal signals that work across varied wording.
 */

/**
 * Ordinal pattern regex for detecting multiple product references.
 * Matches patterns like "1 and 2", "option 1, 2, 3", "#1 vs #2", etc.
 */
const MULTIPLE_ORDINAL_PATTERN = /(?:#?\d+\s*(?:and|&|,|vs\.?|or)\s*)+#?\d+/i;

/**
 * Pattern for detecting "difference between" or "which is better" style questions.
 */
const COMPARISON_QUESTION_PATTERN = /\b(?:difference|better|worse|prefer|versus|vs\.?)\b/i;

/**
 * Pattern for detecting explicit compare keyword.
 */
const COMPARE_KEYWORD_PATTERN = /\bcompare\b/i;

/**
 * Pattern for detecting multiple product IDs or part numbers in the text.
 * Matches UUIDs, numeric IDs, or alphanumeric part numbers.
 */
const MULTIPLE_ID_PATTERN = /(?:[a-f0-9-]{8,}|[A-Z0-9]{4,})\s*(?:and|&|,|vs\.?|or)\s*(?:[a-f0-9-]{8,}|[A-Z0-9]{4,})/i;

/**
 * Checks if the user message likely requests a comparison.
 * 
 * Uses simple signals to detect compare intent:
 * - Contains "compare" keyword
 * - Mentions 2+ ordinals ("option 1 and 2", "#1 vs #2")
 * - Contains "difference between" or "which is better"
 * - Contains 2+ product IDs/partNos
 * 
 * This is a heuristic only - the model can still choose compare mode via tool calling.
 * 
 * @param userText - The user's message text
 * @returns true if the message likely requests a comparison
 */
export function looksLikeCompareIntent(userText: string): boolean {
  const text = userText.trim();
  
  if (text.length === 0) {
    return false;
  }

  // Check for explicit compare keyword
  if (COMPARE_KEYWORD_PATTERN.test(text)) {
    return true;
  }

  // Check for multiple ordinals (e.g., "option 1 and 2", "#1 vs #2")
  if (MULTIPLE_ORDINAL_PATTERN.test(text)) {
    return true;
  }

  // Check for comparison question patterns
  if (COMPARISON_QUESTION_PATTERN.test(text)) {
    // Only trigger if there's also some indication of multiple items
    const hasMultipleReferences = 
      /\b(?:these|those|them|both|two|three|2|3)\b/i.test(text) ||
      MULTIPLE_ORDINAL_PATTERN.test(text);
    if (hasMultipleReferences) {
      return true;
    }
  }

  // Check for multiple product IDs
  if (MULTIPLE_ID_PATTERN.test(text)) {
    return true;
  }

  return false;
}

/**
 * Extracts ordinal numbers from user text.
 * Returns 1-based indices that can be used to look up products in lastResults.
 * 
 * @param userText - The user's message text
 * @returns Array of 1-based indices found in the text
 */
export function extractOrdinals(userText: string): number[] {
  const ordinals: number[] = [];
  const text = userText.trim();

  // Match patterns like "#1", "option 1", "number 1", "1st", "first", etc.
  const patterns = [
    /#(\d+)/g,
    /\boption\s*(\d+)/gi,
    /\bnumber\s*(\d+)/gi,
    /\bnr\.?\s*(\d+)/gi,
    /\b(\d+)(?:st|nd|rd|th)\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= 10 && !ordinals.includes(num)) {
        ordinals.push(num);
      }
    }
  }

  // Also check for standalone numbers in comparison context
  // e.g., "compare 1 and 2", "1 vs 2", "1, 2, 3"
  // First, find sequences of numbers separated by connectors
  const sequencePattern = /\b(\d+)(?:\s*(?:and|&|,|vs\.?|or)\s*(\d+))+/gi;
  let match;
  while ((match = sequencePattern.exec(text)) !== null) {
    // Extract all numbers from the matched sequence
    const numberMatches = match[0].match(/\d+/g);
    if (numberMatches) {
      for (const numStr of numberMatches) {
        const num = parseInt(numStr, 10);
        if (num >= 1 && num <= 10 && !ordinals.includes(num)) {
          ordinals.push(num);
        }
      }
    }
  }

  return ordinals.sort((a, b) => a - b);
}
