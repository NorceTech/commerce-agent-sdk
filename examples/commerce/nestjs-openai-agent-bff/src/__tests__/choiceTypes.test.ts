import { describe, it, expect } from 'vitest';
import {
  choiceSetSchema,
  choiceOptionSchema,
  activeChoiceSetSchema,
  validateChoiceSet,
  safeParseChoiceSet,
  createVariantChoiceSet,
  createActiveChoiceSet,
  MAX_CHOICE_OPTIONS,
  MIN_CHOICE_OPTIONS,
  type ChoiceSet,
  type ChoiceOption,
  type ActiveChoiceSet,
} from '../http/choiceTypes.js';

describe('choiceTypes', () => {
  describe('choiceOptionSchema', () => {
    it('should validate a valid choice option', () => {
      const option: ChoiceOption = {
        id: 'variant-123',
        label: 'Size: Large • Color: Blue',
      };

      const result = choiceOptionSchema.safeParse(option);
      expect(result.success).toBe(true);
    });

    it('should validate a choice option with meta', () => {
      const option: ChoiceOption = {
        id: 'variant-123',
        label: 'Size: Large • Color: Blue',
        meta: {
          onHand: 10,
          isBuyable: true,
          partNo: 'SKU-123',
          inStock: true,
        },
      };

      const result = choiceOptionSchema.safeParse(option);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.meta?.onHand).toBe(10);
        expect(result.data.meta?.isBuyable).toBe(true);
      }
    });

    it('should reject option with empty id', () => {
      const option = {
        id: '',
        label: 'Size: Large',
      };

      const result = choiceOptionSchema.safeParse(option);
      expect(result.success).toBe(false);
    });

    it('should reject option with empty label', () => {
      const option = {
        id: 'variant-123',
        label: '',
      };

      const result = choiceOptionSchema.safeParse(option);
      expect(result.success).toBe(false);
    });
  });

  describe('choiceSetSchema', () => {
    it('should validate a valid variant choice set', () => {
      const choiceSet: ChoiceSet = {
        id: 'variant-product-123-1234567890',
        kind: 'variant',
        prompt: 'This product comes in multiple variants. Which one would you like?',
        options: [
          { id: 'v1', label: 'Size: Small' },
          { id: 'v2', label: 'Size: Medium' },
          { id: 'v3', label: 'Size: Large' },
        ],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe('variant');
        expect(result.data.options.length).toBe(3);
      }
    });

    it('should validate a product choice set', () => {
      const choiceSet: ChoiceSet = {
        id: 'product-choice-123',
        kind: 'product',
        prompt: 'Which product would you like?',
        options: [
          { id: 'p1', label: 'Product A' },
          { id: 'p2', label: 'Product B' },
          { id: 'p3', label: 'Product C' },
        ],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe('product');
      }
    });

    it('should validate a generic choice set', () => {
      const choiceSet: ChoiceSet = {
        id: 'generic-choice-123',
        kind: 'generic',
        prompt: 'Please choose an option:',
        options: [
          { id: 'opt1', label: 'Option 1' },
          { id: 'opt2', label: 'Option 2' },
          { id: 'opt3', label: 'Option 3' },
        ],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.kind).toBe('generic');
      }
    });

    it('should reject choice set with more than MAX_CHOICE_OPTIONS options', () => {
      const options = Array.from({ length: MAX_CHOICE_OPTIONS + 1 }, (_, i) => ({
        id: `v${i}`,
        label: `Option ${i}`,
      }));

      const choiceSet = {
        id: 'too-many-options',
        kind: 'variant',
        prompt: 'Choose one:',
        options,
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(false);
    });

    it('should reject choice set with empty options array', () => {
      const choiceSet = {
        id: 'empty-options',
        kind: 'variant',
        prompt: 'Choose one:',
        options: [],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(false);
    });

    it('should reject choice set with invalid kind', () => {
      const choiceSet = {
        id: 'invalid-kind',
        kind: 'invalid',
        prompt: 'Choose one:',
        options: [{ id: 'v1', label: 'Option 1' }],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(false);
    });

    it('should reject choice set with empty id', () => {
      const choiceSet = {
        id: '',
        kind: 'variant',
        prompt: 'Choose one:',
        options: [{ id: 'v1', label: 'Option 1' }],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(false);
    });

    it('should reject choice set with empty prompt', () => {
      const choiceSet = {
        id: 'no-prompt',
        kind: 'variant',
        prompt: '',
        options: [{ id: 'v1', label: 'Option 1' }],
      };

      const result = choiceSetSchema.safeParse(choiceSet);
      expect(result.success).toBe(false);
    });
  });

  describe('activeChoiceSetSchema', () => {
    it('should validate a valid active choice set', () => {
      const activeChoiceSet: ActiveChoiceSet = {
        id: 'variant-product-123-1234567890',
        kind: 'variant',
        options: [
          { id: 'v1', label: 'Size: Small' },
          { id: 'v2', label: 'Size: Medium' },
          { id: 'v3', label: 'Size: Large' },
        ],
        createdAt: Date.now(),
        parentProductId: 'product-123',
      };

      const result = activeChoiceSetSchema.safeParse(activeChoiceSet);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.parentProductId).toBe('product-123');
      }
    });

    it('should validate active choice set without parentProductId', () => {
      const activeChoiceSet: ActiveChoiceSet = {
        id: 'generic-choice-123',
        kind: 'generic',
        options: [
          { id: 'opt1', label: 'Option 1' },
          { id: 'opt2', label: 'Option 2' },
          { id: 'opt3', label: 'Option 3' },
        ],
        createdAt: Date.now(),
      };

      const result = activeChoiceSetSchema.safeParse(activeChoiceSet);
      expect(result.success).toBe(true);
    });
  });

  describe('validateChoiceSet', () => {
    it('should return validated choice set for valid input', () => {
      const choiceSet: ChoiceSet = {
        id: 'variant-123',
        kind: 'variant',
        prompt: 'Choose a variant:',
        options: [
          { id: 'v1', label: 'Option 1' },
          { id: 'v2', label: 'Option 2' },
          { id: 'v3', label: 'Option 3' },
        ],
      };

      const result = validateChoiceSet(choiceSet);
      expect(result.id).toBe('variant-123');
      expect(result.kind).toBe('variant');
    });

    it('should throw for invalid input', () => {
      const choiceSet = {
        id: 'invalid',
        kind: 'invalid_kind',
        prompt: 'Choose:',
        options: [],
      };

      expect(() => validateChoiceSet(choiceSet)).toThrow();
    });
  });

  describe('safeParseChoiceSet', () => {
    it('should return success for valid input', () => {
      const choiceSet: ChoiceSet = {
        id: 'variant-123',
        kind: 'variant',
        prompt: 'Choose a variant:',
        options: [
          { id: 'v1', label: 'Option 1' },
          { id: 'v2', label: 'Option 2' },
          { id: 'v3', label: 'Option 3' },
        ],
      };

      const result = safeParseChoiceSet(choiceSet);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid input', () => {
      const choiceSet = {
        id: 'invalid',
        options: [],
      };

      const result = safeParseChoiceSet(choiceSet);
      expect(result.success).toBe(false);
    });
  });

  describe('createVariantChoiceSet', () => {
    it('should create a valid variant choice set from variant choices', () => {
      const variantChoices = [
        { index: 1, variantProductId: 'v1', label: 'Size: Small', onHand: 5, isBuyable: true, partNo: 'SKU-1' },
        { index: 2, variantProductId: 'v2', label: 'Size: Medium', onHand: 10, isBuyable: true, partNo: 'SKU-2' },
        { index: 3, variantProductId: 'v3', label: 'Size: Large', onHand: 0, isBuyable: false, partNo: 'SKU-3' },
      ];

      const choiceSet = createVariantChoiceSet(variantChoices, 'product-123', 'Test Product');

      expect(choiceSet.kind).toBe('variant');
      expect(choiceSet.options.length).toBe(3);
      expect(choiceSet.prompt).toContain('Test Product');
      expect(choiceSet.options[0].id).toBe('v1');
      expect(choiceSet.options[0].meta?.onHand).toBe(5);
      expect(choiceSet.options[0].meta?.isBuyable).toBe(true);
      expect(choiceSet.options[0].meta?.partNo).toBe('SKU-1');
      expect(choiceSet.options[0].meta?.inStock).toBe(true);
      expect(choiceSet.options[2].meta?.inStock).toBe(false);
    });

    it('should create choice set without product name', () => {
      const variantChoices = [
        { index: 1, variantProductId: 'v1', label: 'Size: Small' },
        { index: 2, variantProductId: 'v2', label: 'Size: Medium' },
        { index: 3, variantProductId: 'v3', label: 'Size: Large' },
      ];

      const choiceSet = createVariantChoiceSet(variantChoices, 'product-123');

      expect(choiceSet.prompt).toBe('This product comes in multiple variants. Which one would you like?');
    });

    it('should cap options at MAX_CHOICE_OPTIONS', () => {
      const variantChoices = Array.from({ length: 10 }, (_, i) => ({
        index: i + 1,
        variantProductId: `v${i}`,
        label: `Option ${i}`,
      }));

      const choiceSet = createVariantChoiceSet(variantChoices, 'product-123');

      expect(choiceSet.options.length).toBe(MAX_CHOICE_OPTIONS);
    });

    it('should generate unique id with timestamp', () => {
      const variantChoices = [
        { index: 1, variantProductId: 'v1', label: 'Size: Small' },
      ];

      const choiceSet = createVariantChoiceSet(variantChoices, 'product-123');

      expect(choiceSet.id).toMatch(/^variant-product-123-\d+$/);
    });
  });

  describe('createActiveChoiceSet', () => {
    it('should create an active choice set from a choice set', () => {
      const choiceSet: ChoiceSet = {
        id: 'variant-product-123-1234567890',
        kind: 'variant',
        prompt: 'Choose a variant:',
        options: [
          { id: 'v1', label: 'Option 1' },
          { id: 'v2', label: 'Option 2' },
          { id: 'v3', label: 'Option 3' },
        ],
      };

      const activeChoiceSet = createActiveChoiceSet(choiceSet, 'product-123');

      expect(activeChoiceSet.id).toBe(choiceSet.id);
      expect(activeChoiceSet.kind).toBe(choiceSet.kind);
      expect(activeChoiceSet.options).toEqual(choiceSet.options);
      expect(activeChoiceSet.parentProductId).toBe('product-123');
      expect(activeChoiceSet.createdAt).toBeGreaterThan(0);
    });

    it('should create active choice set without parentProductId', () => {
      const choiceSet: ChoiceSet = {
        id: 'generic-123',
        kind: 'generic',
        prompt: 'Choose:',
        options: [{ id: 'opt1', label: 'Option 1' }],
      };

      const activeChoiceSet = createActiveChoiceSet(choiceSet);

      expect(activeChoiceSet.parentProductId).toBeUndefined();
    });
  });

  describe('constants', () => {
    it('should have MAX_CHOICE_OPTIONS set to 6', () => {
      expect(MAX_CHOICE_OPTIONS).toBe(6);
    });

    it('should have MIN_CHOICE_OPTIONS set to 3', () => {
      expect(MIN_CHOICE_OPTIONS).toBe(3);
    });
  });
});
