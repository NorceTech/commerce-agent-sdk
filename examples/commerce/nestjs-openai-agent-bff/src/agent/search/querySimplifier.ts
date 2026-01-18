/**
 * Query simplifier for MCP product.search queries.
 * 
 * This module provides a lightweight guardrail to simplify search queries
 * before they are sent to the MCP product.search tool. The goal is to prevent
 * "Google-style" complex queries that the naive/full-text search backend
 * cannot handle well.
 * 
 * Rules:
 * - Trim and collapse whitespace
 * - If > 3 tokens, keep first 2-3 "content-ish" tokens
 * - Prefer longer tokens, drop pure numbers/size patterns like "30-31", "EU", "cm"
 * - Drop common connectors like "and", "with", "for"
 * - Cap length at 50 chars
 */

/**
 * Patterns that should be dropped from search queries.
 * These are size patterns, units, and common connectors that don't help search.
 */
const DROP_PATTERNS = [
  // Size patterns (e.g., "30-31", "38-40", "S-M")
  /^\d+[-–]\d+$/,
  // Pure numbers (e.g., "30", "180")
  /^\d+$/,
  // Size/unit suffixes (case-insensitive)
  /^(eu|cm|mm|m|kg|g|ml|l|inch|inches|ft|feet)$/i,
  // Common connectors (English only, as specified)
  /^(and|with|for|or|the|a|an|in|on|at|to|of)$/i,
  // Gender terms that are constraints, not product types
  /^(men|mens|men's|women|womens|women's|male|female|unisex|kids|children|boys|girls)$/i,
  // Color terms (common colors that are constraints)
  /^(red|blue|green|yellow|black|white|brown|grey|gray|pink|purple|orange|beige|navy)$/i,
  // Stock/availability terms
  /^(stock|available|instock|in-stock)$/i,
  // Price-related terms
  /^(under|over|below|above|cheap|expensive|budget|premium)$/i,
  // Size-related terms (the word "size" itself is a constraint indicator)
  /^(size|sizes|length|width|height|weight)$/i,
];

/**
 * Maximum number of tokens to keep in the simplified query.
 */
const MAX_TOKENS = 3;

/**
 * Maximum character length for the simplified query.
 */
const MAX_LENGTH = 50;

/**
 * Minimum token length to prefer (shorter tokens are deprioritized).
 */
const MIN_PREFERRED_TOKEN_LENGTH = 2;

/**
 * Checks if a token should be dropped based on the drop patterns.
 * 
 * @param token - The token to check
 * @returns True if the token should be dropped
 */
function shouldDropToken(token: string): boolean {
  return DROP_PATTERNS.some(pattern => pattern.test(token));
}

/**
 * Scores a token for content relevance.
 * Higher scores indicate more "content-ish" tokens that should be kept.
 * 
 * @param token - The token to score
 * @returns A numeric score (higher = more relevant)
 */
function scoreToken(token: string): number {
  // Tokens that should be dropped get score 0
  if (shouldDropToken(token)) {
    return 0;
  }
  
  // Prefer longer tokens (more likely to be product names/types)
  let score = token.length;
  
  // Boost tokens that look like brand names (capitalized)
  if (/^[A-Z][a-z]+/.test(token)) {
    score += 2;
  }
  
  // Slight penalty for very short tokens
  if (token.length < MIN_PREFERRED_TOKEN_LENGTH) {
    score -= 1;
  }
  
  return Math.max(score, 1); // Minimum score of 1 for non-dropped tokens
}

/**
 * Result of simplifying a search query.
 */
export interface SimplifyResult {
  /** The simplified query */
  simplified: string;
  /** The original query (trimmed) */
  original: string;
  /** Whether the query was modified */
  wasSimplified: boolean;
  /** Tokens that were dropped */
  droppedTokens: string[];
}

/**
 * Simplifies a search query for the MCP product.search tool.
 * 
 * This function acts as a safety net to prevent "Google-style" complex queries
 * from being sent to the naive/full-text search backend. It:
 * - Trims and collapses whitespace
 * - Drops size patterns, units, connectors, and constraint terms
 * - Keeps the top 2-3 most relevant tokens
 * - Caps the result at 50 characters
 * 
 * @param input - The original search query
 * @returns The simplified query string
 */
export function simplifySearchQuery(input: string): string {
  const result = simplifySearchQueryWithDetails(input);
  return result.simplified;
}

/**
 * Simplifies a search query and returns detailed information about the simplification.
 * 
 * @param input - The original search query
 * @returns Detailed result including original, simplified, and dropped tokens
 */
export function simplifySearchQueryWithDetails(input: string): SimplifyResult {
  // Trim and collapse whitespace
  const trimmed = input.trim().replace(/\s+/g, ' ');
  
  if (!trimmed) {
    return {
      simplified: '',
      original: '',
      wasSimplified: false,
      droppedTokens: [],
    };
  }
  
  // Tokenize
  const tokens = trimmed.split(' ');
  
  // Score and filter tokens
  const scoredTokens = tokens.map(token => ({
    token,
    score: scoreToken(token),
  }));
  
  // Separate kept and dropped tokens
  const keptTokens: string[] = [];
  const droppedTokens: string[] = [];
  
  for (const { token, score } of scoredTokens) {
    if (score > 0 && keptTokens.length < MAX_TOKENS) {
      keptTokens.push(token);
    } else if (score === 0) {
      droppedTokens.push(token);
    } else {
      // Token would be kept but we already have MAX_TOKENS
      droppedTokens.push(token);
    }
  }
  
  // Join kept tokens
  let simplified = keptTokens.join(' ');
  
  // Cap length
  if (simplified.length > MAX_LENGTH) {
    simplified = simplified.substring(0, MAX_LENGTH).trim();
    // Don't cut in the middle of a word
    const lastSpace = simplified.lastIndexOf(' ');
    if (lastSpace > 0 && simplified.length === MAX_LENGTH) {
      simplified = simplified.substring(0, lastSpace);
    }
  }
  
  const wasSimplified = simplified !== trimmed;
  
  return {
    simplified,
    original: trimmed,
    wasSimplified,
    droppedTokens,
  };
}

/**
 * Broadens a search query by keeping only the first token.
 * Used as a fallback when the initial search returns 0 results.
 * 
 * @param query - The query to broaden (should already be simplified)
 * @returns The broadened query (first token only), or null if already minimal
 */
export function broadenSearchQuery(query: string): string | null {
  const trimmed = query.trim();
  const tokens = trimmed.split(/\s+/);
  
  // If already a single token, cannot broaden further
  if (tokens.length <= 1) {
    return null;
  }
  
  // Return just the first token
  return tokens[0];
}
