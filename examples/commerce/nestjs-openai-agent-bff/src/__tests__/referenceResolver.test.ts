import { describe, it, expect } from 'vitest';
import {
  resolveCandidate,
  looksLikeSelectionIntent,
  buildResolverHint,
  MAX_LAST_RESULTS,
  resolveActiveChoice,
  buildActiveChoiceResolverHint,
} from '../agent/referenceResolver.js';
import type { WorkingMemory, LastResultItem, ActiveChoiceSet } from '../session/sessionTypes.js';

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

describe('referenceResolver', () => {
  describe('resolveCandidate', () => {
    describe('ordinal patterns', () => {
      it('should resolve "#2" to lastResults[1]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('#2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-2');
        expect(result?.index).toBe(2);
        expect(result?.confidence).toBe('high');
        expect(result?.reason).toContain('#2');
      });

      it('should resolve "option 3" to lastResults[2]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('option 3', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-3');
        expect(result?.index).toBe(3);
      });

      it('should resolve "number 2" to lastResults[1]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('number 2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-2');
        expect(result?.index).toBe(2);
      });

      it('should resolve "nr 4" to lastResults[3]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('nr 4', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-4');
        expect(result?.index).toBe(4);
      });

      it('should resolve "nr. 1" to lastResults[0]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('nr. 1', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-1');
        expect(result?.index).toBe(1);
      });

      it('should resolve "2nd" to lastResults[1]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('2nd', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-2');
        expect(result?.index).toBe(2);
      });

      it('should resolve "3rd" to lastResults[2]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('3rd', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-3');
        expect(result?.index).toBe(3);
      });

      it('should resolve "1st" to lastResults[0]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('1st', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-1');
        expect(result?.index).toBe(1);
      });

      it('should resolve just "2" to lastResults[1]', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-2');
        expect(result?.index).toBe(2);
      });

      it('should return null for out-of-bounds ordinal', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(3),
        };

        const result = resolveCandidate('#5', workingMemory);

        expect(result).toBeNull();
      });

      it('should return null for ordinal 0', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('#0', workingMemory);

        expect(result).toBeNull();
      });
    });

    describe('exact id/sku match', () => {
      it('should resolve exact productId mention', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('I want prod-3', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-3');
        expect(result?.index).toBe(3);
        expect(result?.reason).toContain('productId');
      });

      it('should resolve exact partNo mention', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('Show me SKU-2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-2');
        expect(result?.index).toBe(2);
        expect(result?.reason).toContain('partNo');
      });

      it('should be case-insensitive for id match', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('I want PROD-3', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-3');
      });
    });

    describe('descriptive references (model handles)', () => {
      it('should return null for "the black one"', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('the black one', workingMemory);

        expect(result).toBeNull();
      });

      it('should return null for "the cheaper one"', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('the cheaper one', workingMemory);

        expect(result).toBeNull();
      });

      it('should return null for "that one"', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('that one', workingMemory);

        expect(result).toBeNull();
      });

      it('should return null for "I like the red product"', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('I like the red product', workingMemory);

        expect(result).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should return null for undefined workingMemory', () => {
        const result = resolveCandidate('#2', undefined);

        expect(result).toBeNull();
      });

      it('should return null for empty lastResults', () => {
        const workingMemory: WorkingMemory = {
          lastResults: [],
        };

        const result = resolveCandidate('#2', workingMemory);

        expect(result).toBeNull();
      });

      it('should return null for workingMemory without lastResults', () => {
        const workingMemory: WorkingMemory = {
          shortlist: [{ productId: 'prod-1' }],
        };

        const result = resolveCandidate('#2', workingMemory);

        expect(result).toBeNull();
      });

      it('should handle whitespace in input', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveCandidate('  #2  ', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.productId).toBe('prod-2');
      });
    });
  });

  describe('looksLikeSelectionIntent', () => {
    it('should return true for short messages with selection keywords', () => {
      expect(looksLikeSelectionIntent('that one')).toBe(true);
      expect(looksLikeSelectionIntent('this one')).toBe(true);
      expect(looksLikeSelectionIntent('option 2')).toBe(true);
      expect(looksLikeSelectionIntent('#3')).toBe(true);
      expect(looksLikeSelectionIntent('I like that')).toBe(true);
    });

    it('should return true for ordinal patterns even in longer messages', () => {
      expect(looksLikeSelectionIntent('I would like to see more details about option 2 please')).toBe(true);
      expect(looksLikeSelectionIntent('Can you tell me more about #3?')).toBe(true);
    });

    it('should return false for general queries', () => {
      expect(looksLikeSelectionIntent('Show me running shoes')).toBe(false);
      expect(looksLikeSelectionIntent('What products do you have in blue?')).toBe(false);
    });

    it('should return true for "number" keyword', () => {
      expect(looksLikeSelectionIntent('number 2')).toBe(true);
    });

    it('should return true for "nr" keyword', () => {
      expect(looksLikeSelectionIntent('nr 2')).toBe(true);
    });
  });

  describe('buildResolverHint', () => {
    it('should build a hint message with productId and index', () => {
      const result = {
        productId: 'prod-2',
        index: 2,
        confidence: 'high' as const,
        reason: 'ordinal pattern "#2" matched index 2',
      };

      const hint = buildResolverHint(result);

      expect(hint).toContain('ResolverHint');
      expect(hint).toContain('prod-2');
      expect(hint).toContain('index=2');
      expect(hint).toContain('ordinal pattern');
    });
  });

  describe('MAX_LAST_RESULTS', () => {
    it('should be 10', () => {
      expect(MAX_LAST_RESULTS).toBe(10);
    });
  });

  describe('resolveActiveChoice', () => {
    function createActiveChoiceSet(count: number): ActiveChoiceSet {
      return {
        id: 'variant-product-123-1234567890',
        kind: 'variant',
        options: Array.from({ length: count }, (_, i) => ({
          id: `variant-${i + 1}`,
          label: `Option ${i + 1}`,
          meta: {
            partNo: `SKU-${i + 1}`,
            onHand: 10 - i,
            isBuyable: true,
          },
        })),
        createdAt: Date.now(),
        parentProductId: 'product-123',
      };
    }

    describe('ordinal patterns', () => {
      it('should resolve "#2" to activeChoiceSet.options[1]', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('#2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-2');
        expect(result?.index).toBe(2);
        expect(result?.confidence).toBe('high');
        expect(result?.kind).toBe('variant');
        expect(result?.parentProductId).toBe('product-123');
      });

      it('should resolve "option 3" to activeChoiceSet.options[2]', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('option 3', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-3');
        expect(result?.index).toBe(3);
      });

      it('should resolve "2nd" to activeChoiceSet.options[1]', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('2nd', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-2');
        expect(result?.index).toBe(2);
      });

      it('should resolve just "2" to activeChoiceSet.options[1]', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-2');
        expect(result?.index).toBe(2);
      });

      it('should return null for out-of-bounds ordinal', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(3),
        };

        const result = resolveActiveChoice('#5', workingMemory);

        expect(result).toBeNull();
      });
    });

    describe('exact id match', () => {
      it('should resolve exact choice id mention', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('I want variant-3', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-3');
        expect(result?.index).toBe(3);
        expect(result?.reason).toContain('choice id');
      });

      it('should resolve exact partNo from meta', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('Show me SKU-2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-2');
        expect(result?.index).toBe(2);
        expect(result?.reason).toContain('partNo');
      });

      it('should be case-insensitive for id match', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('I want VARIANT-3', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.choiceId).toBe('variant-3');
      });
    });

    describe('edge cases', () => {
      it('should return null for undefined workingMemory', () => {
        const result = resolveActiveChoice('#2', undefined);

        expect(result).toBeNull();
      });

      it('should return null for empty activeChoiceSet options', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: {
            id: 'empty',
            kind: 'variant',
            options: [],
            createdAt: Date.now(),
          },
        };

        const result = resolveActiveChoice('#2', workingMemory);

        expect(result).toBeNull();
      });

      it('should return null for workingMemory without activeChoiceSet', () => {
        const workingMemory: WorkingMemory = {
          lastResults: createLastResults(5),
        };

        const result = resolveActiveChoice('#2', workingMemory);

        expect(result).toBeNull();
      });

      it('should include meta in result', () => {
        const workingMemory: WorkingMemory = {
          activeChoiceSet: createActiveChoiceSet(5),
        };

        const result = resolveActiveChoice('#2', workingMemory);

        expect(result).not.toBeNull();
        expect(result?.meta).toBeDefined();
        expect(result?.meta?.partNo).toBe('SKU-2');
        expect(result?.meta?.onHand).toBe(9);
      });
    });
  });

  describe('buildActiveChoiceResolverHint', () => {
    it('should build a hint message with choiceId, index, and kind', () => {
      const result = {
        choiceId: 'variant-2',
        index: 2,
        confidence: 'high' as const,
        reason: 'ordinal pattern "#2" matched choice index 2',
        kind: 'variant' as const,
        parentProductId: 'product-123',
      };

      const hint = buildActiveChoiceResolverHint(result);

      expect(hint).toContain('ActiveChoiceResolverHint');
      expect(hint).toContain('variant-2');
      expect(hint).toContain('index=2');
      expect(hint).toContain('kind=variant');
      expect(hint).toContain('ordinal pattern');
    });
  });
});
