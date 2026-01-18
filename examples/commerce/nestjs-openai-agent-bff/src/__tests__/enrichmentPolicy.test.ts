import { describe, it, expect } from 'vitest';
import {
  shouldEnrichSearchResults,
  selectProductsToEnrich,
  MAX_ENRICH_GET,
} from '../agent/product/enrichmentPolicy.js';
import type { LastResultItem } from '../session/sessionTypes.js';

/**
 * Helper to create a minimal LastResultItem for testing.
 */
function createLastResultItem(
  productId: string,
  name: string,
  buyableVariantCount?: number,
  inStockBuyableVariantCount?: number
): LastResultItem {
  return {
    index: 1,
    productId,
    name,
    buyableVariantCount,
    inStockBuyableVariantCount,
  };
}

describe('enrichmentPolicy', () => {
  describe('shouldEnrichSearchResults', () => {
    describe('dimension/variant interest triggers', () => {
      it('should trigger enrichment when user asks about size', () => {
        const lastResults = [createLastResultItem('1', 'Product 1')];
        
        const decision = shouldEnrichSearchResults('Do you have this in size 26-27?', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('dimensions');
      });

      it('should trigger enrichment when user asks about color', () => {
        const lastResults = [createLastResultItem('1', 'Product 1')];
        
        const decision = shouldEnrichSearchResults('Is this available in brown?', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('dimensions');
      });

      it('should trigger enrichment when user asks about availability', () => {
        const lastResults = [createLastResultItem('1', 'Product 1')];
        
        const decision = shouldEnrichSearchResults('Is this in stock?', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('dimensions');
      });

      it('should trigger enrichment when user asks about variants', () => {
        const lastResults = [createLastResultItem('1', 'Product 1')];
        
        const decision = shouldEnrichSearchResults('What variants are available?', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('dimensions');
      });

      it('should trigger enrichment for non-Size/Color dimensions (Voltage)', () => {
        const lastResults = [createLastResultItem('1', 'Product 1', 5, 3)];
        
        const decision = shouldEnrichSearchResults('What voltage options are available?', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('dimensions');
      });

      it('should trigger enrichment for non-Size/Color dimensions (Plug)', () => {
        const lastResults = [createLastResultItem('1', 'Product 1', 5, 3)];
        
        const decision = shouldEnrichSearchResults('What plug connector types do you have?', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('dimensions');
      });
    });

    describe('purchase intent triggers', () => {
      it('should trigger enrichment when user wants to add to cart', () => {
        const lastResults = [createLastResultItem('1', 'Product 1', 5, 3)];
        
        const decision = shouldEnrichSearchResults('I want to buy this product', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('purchase intent');
      });

      it('should trigger enrichment when user wants to buy', () => {
        const lastResults = [createLastResultItem('1', 'Product 1', 5, 3)];
        
        const decision = shouldEnrichSearchResults('I want to buy this one', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('purchase intent');
      });

      it('should trigger enrichment when user selects a specific option', () => {
        const lastResults = [createLastResultItem('1', 'Product 1', 5, 3)];
        
        const decision = shouldEnrichSearchResults("I'll take the first one", lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('purchase intent');
      });
    });

    describe('missing availability signals trigger', () => {
      it('should trigger enrichment when lastResults lack availability signals', () => {
        const lastResults = [
          createLastResultItem('1', 'Product 1'),
          createLastResultItem('2', 'Product 2'),
        ];
        
        const decision = shouldEnrichSearchResults('Show me more details', lastResults);
        
        expect(decision.shouldEnrich).toBe(true);
        expect(decision.reason).toContain('lack availability signals');
      });

      it('should not trigger enrichment when lastResults have availability signals', () => {
        const lastResults = [
          createLastResultItem('1', 'Product 1', 5, 3),
          createLastResultItem('2', 'Product 2', 2, 1),
        ];
        
        const decision = shouldEnrichSearchResults('Show me more details', lastResults);
        
        expect(decision.shouldEnrich).toBe(false);
        expect(decision.reason).toContain('No enrichment trigger');
      });
    });

    describe('no trigger cases', () => {
      it('should not trigger enrichment for general queries when availability is known', () => {
        const lastResults = [
          createLastResultItem('1', 'Product 1', 5, 3),
        ];
        
        const decision = shouldEnrichSearchResults('Tell me more about this product', lastResults);
        
        expect(decision.shouldEnrich).toBe(false);
      });

      it('should not trigger enrichment when lastResults is empty', () => {
        const decision = shouldEnrichSearchResults('Do you have this in size 26?', []);
        
        expect(decision.shouldEnrich).toBe(false);
        expect(decision.productIdsToEnrich).toHaveLength(0);
      });

      it('should not trigger enrichment when lastResults is undefined', () => {
        const decision = shouldEnrichSearchResults('Do you have this in size 26?', undefined);
        
        expect(decision.shouldEnrich).toBe(false);
        expect(decision.productIdsToEnrich).toHaveLength(0);
      });
    });

    describe('product ID selection', () => {
      it('should return up to MAX_ENRICH_GET product IDs', () => {
        const lastResults = [
          createLastResultItem('1', 'Product 1'),
          createLastResultItem('2', 'Product 2'),
          createLastResultItem('3', 'Product 3'),
          createLastResultItem('4', 'Product 4'),
          createLastResultItem('5', 'Product 5'),
        ];
        
        const decision = shouldEnrichSearchResults('What sizes are available?', lastResults);
        
        expect(decision.productIdsToEnrich).toHaveLength(MAX_ENRICH_GET);
        expect(decision.productIdsToEnrich).toContain('1');
        expect(decision.productIdsToEnrich).toContain('2');
        expect(decision.productIdsToEnrich).toContain('3');
      });
    });
  });

  describe('selectProductsToEnrich', () => {
    it('should prioritize products without existing availability data', () => {
      const candidates = ['1', '2', '3', '4'];
      const existingAvailability = new Map([
        ['1', true],
        ['2', false],
        ['3', true],
        ['4', false],
      ]);
      
      const selected = selectProductsToEnrich(candidates, existingAvailability);
      
      expect(selected).toHaveLength(MAX_ENRICH_GET);
      expect(selected[0]).toBe('2');
      expect(selected[1]).toBe('4');
    });

    it('should cap at MAX_ENRICH_GET', () => {
      const candidates = ['1', '2', '3', '4', '5'];
      const existingAvailability = new Map<string, boolean>();
      
      const selected = selectProductsToEnrich(candidates, existingAvailability);
      
      expect(selected).toHaveLength(MAX_ENRICH_GET);
    });

    it('should return empty array for empty candidates', () => {
      const selected = selectProductsToEnrich([], new Map());
      
      expect(selected).toHaveLength(0);
    });

    it('should fill with products that have availability if needed', () => {
      const candidates = ['1', '2'];
      const existingAvailability = new Map([
        ['1', true],
        ['2', true],
      ]);
      
      const selected = selectProductsToEnrich(candidates, existingAvailability);
      
      expect(selected).toHaveLength(2);
      expect(selected).toContain('1');
      expect(selected).toContain('2');
    });
  });
});
