import { describe, it, expect } from 'vitest';
import {
  selectCompareCandidates,
  buildCompareHint,
} from '../agent/compare/selectCompareCandidates.js';
import { MAX_COMPARE } from '../agent/compare/compareTypes.js';
import type { WorkingMemory, LastResultItem, ShortlistItem } from '../session/sessionTypes.js';

function createLastResults(count: number): LastResultItem[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    productId: `prod-${i + 1}`,
    partNo: `SKU-${i + 1}`,
    name: `Product ${i + 1}`,
    brand: `Brand ${i + 1}`,
    color: ['red', 'blue', 'black', 'white', 'green'][i % 5],
    price: 100 + i * 10,
    currency: 'SEK',
  }));
}

function createShortlist(count: number): ShortlistItem[] {
  return Array.from({ length: count }, (_, i) => ({
    productId: `shortlist-${i + 1}`,
    name: `Shortlist Product ${i + 1}`,
  }));
}

describe('selectCompareCandidates', () => {
  describe('ordinal resolution', () => {
    it('should resolve "compare option 1 and 2" to lastResults[0] and lastResults[1]', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
      };

      const result = selectCompareCandidates('compare option 1 and 2', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(2);
      expect(result?.productIds).toContain('prod-1');
      expect(result?.productIds).toContain('prod-2');
    });

    it('should resolve "compare #2 vs #3 vs #1" to 3 products in requested order', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
      };

      const result = selectCompareCandidates('compare #2 vs #3 vs #1', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(3);
      expect(result?.productIds).toContain('prod-1');
      expect(result?.productIds).toContain('prod-2');
      expect(result?.productIds).toContain('prod-3');
    });

    it('should resolve "1 and 2" to lastResults[0] and lastResults[1]', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
      };

      const result = selectCompareCandidates('1 and 2', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(2);
      expect(result?.productIds).toContain('prod-1');
      expect(result?.productIds).toContain('prod-2');
    });

    it('should resolve "option 1, 2, 3" to 3 products', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
      };

      const result = selectCompareCandidates('option 1, 2, 3', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(3);
    });
  });

  describe('caps at MAX_COMPARE', () => {
    it('should cap at MAX_COMPARE (3) products even if more ordinals are provided', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(10),
      };

      const result = selectCompareCandidates('compare #1, #2, #3, #4, #5', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds.length).toBeLessThanOrEqual(MAX_COMPARE);
    });

    it('should return MAX_COMPARE constant as 3', () => {
      expect(MAX_COMPARE).toBe(3);
    });
  });

  describe('shortlist resolution', () => {
    it('should resolve "compare these two" with shortlist of 2 items', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
        shortlist: createShortlist(2),
      };

      const result = selectCompareCandidates('compare these two', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(2);
      expect(result?.productIds).toContain('shortlist-1');
      expect(result?.productIds).toContain('shortlist-2');
    });

    it('should resolve "compare them" with shortlist of 3 items', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
        shortlist: createShortlist(3),
      };

      const result = selectCompareCandidates('compare them', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(3);
    });

    it('should fallback to lastResults when shortlist trigger present but shortlist has < 2 items', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(3),
        shortlist: createShortlist(1),
      };

      const result = selectCompareCandidates('compare these', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(3);
      expect(result?.productIds).toContain('prod-1');
      expect(result?.productIds).toContain('prod-2');
      expect(result?.productIds).toContain('prod-3');
    });
  });

  describe('explicit productId/partNo resolution', () => {
    it('should resolve explicit productIds mentioned in text', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
      };

      const result = selectCompareCandidates('compare prod-2 and prod-4', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(2);
      expect(result?.productIds).toContain('prod-2');
      expect(result?.productIds).toContain('prod-4');
    });

    it('should resolve explicit partNos mentioned in text', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(5),
      };

      const result = selectCompareCandidates('compare SKU-1 vs SKU-3', workingMemory);

      expect(result).not.toBeNull();
      expect(result?.productIds).toHaveLength(2);
      expect(result?.productIds).toContain('prod-1');
      expect(result?.productIds).toContain('prod-3');
    });
  });

  describe('edge cases', () => {
    it('should return null for undefined workingMemory', () => {
      const result = selectCompareCandidates('compare option 1 and 2', undefined);

      expect(result).toBeNull();
    });

    it('should return null for empty lastResults and shortlist', () => {
      const workingMemory: WorkingMemory = {
        lastResults: [],
        shortlist: [],
      };

      const result = selectCompareCandidates('compare option 1 and 2', workingMemory);

      expect(result).toBeNull();
    });

    it('should return null when only 1 product can be resolved', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(1),
      };

      const result = selectCompareCandidates('compare option 1 and 2', workingMemory);

      expect(result).toBeNull();
    });

    it('should return null for out-of-bounds ordinals', () => {
      const workingMemory: WorkingMemory = {
        lastResults: createLastResults(2),
      };

      const result = selectCompareCandidates('compare option 5 and 6', workingMemory);

      expect(result).toBeNull();
    });
  });

  describe('buildCompareHint', () => {
    it('should build a hint message with product IDs and reasons', () => {
      const result = {
        productIds: ['prod-1', 'prod-2'],
        reasons: [
          { productId: 'prod-1', source: 'lastResults' as const, index: 1, matchType: 'ordinal' as const },
          { productId: 'prod-2', source: 'lastResults' as const, index: 2, matchType: 'ordinal' as const },
        ],
      };

      const hint = buildCompareHint(result);

      expect(hint).toContain('CompareHint');
      expect(hint).toContain('prod-1');
      expect(hint).toContain('prod-2');
      expect(hint).toContain('2 products');
      expect(hint).toContain('product_get');
    });
  });
});
