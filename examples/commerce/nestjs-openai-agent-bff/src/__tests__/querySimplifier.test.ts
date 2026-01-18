import { describe, it, expect } from 'vitest';
import {
  simplifySearchQuery,
  simplifySearchQueryWithDetails,
  broadenSearchQuery,
} from '../agent/search/querySimplifier.js';

describe('querySimplifier', () => {
  describe('simplifySearchQuery', () => {
    it('should return empty string for empty input', () => {
      expect(simplifySearchQuery('')).toBe('');
      expect(simplifySearchQuery('   ')).toBe('');
    });

    it('should trim and collapse whitespace', () => {
      expect(simplifySearchQuery('  slippers  ')).toBe('slippers');
      expect(simplifySearchQuery('bear   slippers')).toBe('bear slippers');
    });

    it('should keep simple queries unchanged', () => {
      expect(simplifySearchQuery('slippers')).toBe('slippers');
      expect(simplifySearchQuery('bear slippers')).toBe('bear slippers');
      expect(simplifySearchQuery('dining table')).toBe('dining table');
    });

    it('should drop size patterns like "30-31"', () => {
      const result = simplifySearchQuery('slippers 30-31');
      expect(result).toBe('slippers');
    });

    it('should drop EU size patterns', () => {
      const result = simplifySearchQuery('slippers 30-31 EU');
      expect(result).toBe('slippers');
    });

    it('should drop pure numbers', () => {
      const result = simplifySearchQuery('slippers 30');
      expect(result).toBe('slippers');
    });

    it('should drop common connectors', () => {
      const result = simplifySearchQuery('slippers for men');
      expect(result).toBe('slippers');
    });

    it('should drop gender terms', () => {
      const result = simplifySearchQuery('slippers men');
      expect(result).toBe('slippers');
    });

    it('should drop color terms', () => {
      const result = simplifySearchQuery('slippers brown');
      expect(result).toBe('slippers');
    });

    it('should handle complex queries with multiple constraints', () => {
      const result = simplifySearchQuery('slippers men 30-31 EU brown in stock');
      expect(result).toBe('slippers');
    });

    it('should keep brand names', () => {
      const result = simplifySearchQuery('Liewood slippers');
      expect(result).toBe('Liewood slippers');
    });

    it('should handle "bear slippers size 30-31"', () => {
      const result = simplifySearchQuery('bear slippers size 30-31');
      // Should keep "bear slippers" and drop "size" and "30-31"
      expect(result).toBe('bear slippers');
    });

    it('should handle "30-31 EU slippers" (size tokens first)', () => {
      const result = simplifySearchQuery('30-31 EU slippers');
      // Should drop size tokens and keep "slippers"
      expect(result).toBe('slippers');
    });

    it('should handle "red running shoes for women size 38"', () => {
      const result = simplifySearchQuery('red running shoes for women size 38');
      // Should drop "red", "for", "women", "size", "38" and keep "running shoes"
      expect(result).toBe('running shoes');
    });

    it('should handle "oak dining table 180 cm"', () => {
      const result = simplifySearchQuery('oak dining table 180 cm');
      // Should drop "180", "cm" and keep "oak dining table"
      expect(result).toBe('oak dining table');
    });

    it('should cap at MAX_TOKENS (3)', () => {
      const result = simplifySearchQuery('oak dining table furniture');
      // Should keep first 3 content tokens
      expect(result).toBe('oak dining table');
    });

    it('should cap at MAX_LENGTH (50 chars)', () => {
      const longQuery = 'superlongproductname anotherlongword yetanotherlongword morelongwords';
      const result = simplifySearchQuery(longQuery);
      expect(result.length).toBeLessThanOrEqual(50);
    });
  });

  describe('simplifySearchQueryWithDetails', () => {
    it('should return detailed result with original and simplified', () => {
      const result = simplifySearchQueryWithDetails('slippers men 30-31');
      expect(result.original).toBe('slippers men 30-31');
      expect(result.simplified).toBe('slippers');
      expect(result.wasSimplified).toBe(true);
      expect(result.droppedTokens).toContain('men');
      expect(result.droppedTokens).toContain('30-31');
    });

    it('should mark wasSimplified as false when query is unchanged', () => {
      const result = simplifySearchQueryWithDetails('slippers');
      expect(result.wasSimplified).toBe(false);
      expect(result.droppedTokens).toEqual([]);
    });

    it('should track dropped tokens', () => {
      const result = simplifySearchQueryWithDetails('slippers men 30-31 EU brown');
      expect(result.droppedTokens).toContain('men');
      expect(result.droppedTokens).toContain('30-31');
      expect(result.droppedTokens).toContain('EU');
      expect(result.droppedTokens).toContain('brown');
    });
  });

  describe('broadenSearchQuery', () => {
    it('should return null for single-word query', () => {
      expect(broadenSearchQuery('slippers')).toBeNull();
    });

    it('should return first word for multi-word query', () => {
      expect(broadenSearchQuery('bear slippers')).toBe('bear');
      expect(broadenSearchQuery('oak dining table')).toBe('oak');
    });

    it('should handle whitespace', () => {
      expect(broadenSearchQuery('  bear  slippers  ')).toBe('bear');
    });

    it('should return null for empty query', () => {
      expect(broadenSearchQuery('')).toBeNull();
      expect(broadenSearchQuery('   ')).toBeNull();
    });
  });
});
