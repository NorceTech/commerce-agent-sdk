import { describe, it, expect } from 'vitest';
import {
  buildVariantHints,
  buildVariantHintsFromVariants,
  MAX_HINT_DIMENSIONS,
  MAX_HINT_VALUES_PER_DIMENSION,
} from '../agent/product/variantHints.js';
import type { NormalizedProductDetails, NormalizedVariant } from '../agent/product/productTypes.js';

/**
 * Helper to create a minimal normalized variant for testing.
 */
function createVariant(
  id: string,
  isBuyable: boolean,
  dimensions: Array<{ name: string; value: string; isPrimary?: boolean }> = [],
  onHand?: { value: number; isActive: boolean }
): NormalizedVariant {
  return {
    variantProductId: id,
    isBuyable,
    dimensions,
    dimsMap: Object.fromEntries(dimensions.map(d => [d.name, d.value])),
    label: `Variant ${id}`,
    onHand,
  };
}

/**
 * Helper to create a minimal normalized product details for testing.
 */
function createProductDetails(variants: NormalizedVariant[]): NormalizedProductDetails {
  const buyableVariantCount = variants.filter(v => v.isBuyable).length;
  return {
    productId: 'test-product',
    name: 'Test Product',
    variants,
    buyableVariantCount,
    inStockBuyableVariantCount: variants.filter(v => v.isBuyable && v.onHand?.value && v.onHand.value > 0 && v.onHand.isActive).length,
    availableDimensionValues: {},
    isBuyable: buyableVariantCount > 0,
  };
}

describe('variantHints', () => {
  describe('buildVariantHints', () => {
    it('should return zero counts for product with no variants', () => {
      const product = createProductDetails([]);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(0);
      expect(hints.inStockBuyableVariantCount).toBe(0);
      expect(Object.keys(hints.dimensionHints)).toHaveLength(0);
    });

    it('should count buyable variants correctly', () => {
      const variants = [
        createVariant('1', true),
        createVariant('2', true),
        createVariant('3', false),
      ];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(2);
    });

    it('should count in-stock buyable variants correctly', () => {
      const variants = [
        createVariant('1', true, [], { value: 5, isActive: true }),
        createVariant('2', true, [], { value: 0, isActive: true }),
        createVariant('3', true, [], { value: 3, isActive: false }),
        createVariant('4', false, [], { value: 10, isActive: true }),
      ];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(3);
      expect(hints.inStockBuyableVariantCount).toBe(1);
    });

    it('should aggregate dimension values from buyable variants only', () => {
      const variants = [
        createVariant('1', true, [{ name: 'Color', value: 'Brown' }, { name: 'Size', value: 'S' }]),
        createVariant('2', true, [{ name: 'Color', value: 'Brown' }, { name: 'Size', value: 'M' }]),
        createVariant('3', false, [{ name: 'Color', value: 'Black' }, { name: 'Size', value: 'L' }]),
      ];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.dimensionHints['Color']).toHaveLength(1);
      expect(hints.dimensionHints['Color']).toContain('Brown');
      expect(hints.dimensionHints['Color']).not.toContain('Black');
      expect(hints.dimensionHints['Size']).toHaveLength(2);
      expect(hints.dimensionHints['Size']).toContain('S');
      expect(hints.dimensionHints['Size']).toContain('M');
      expect(hints.dimensionHints['Size']).not.toContain('L');
    });

    it('should handle 0..N dimensions (not just Size/Color)', () => {
      const variants = [
        createVariant('1', true, [
          { name: 'Voltage', value: '230V' },
          { name: 'Plug', value: 'EU' },
          { name: 'Wattage', value: '100W' },
        ]),
        createVariant('2', true, [
          { name: 'Voltage', value: '110V' },
          { name: 'Plug', value: 'US' },
          { name: 'Wattage', value: '100W' },
        ]),
      ];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.dimensionHints['Voltage']).toContain('230V');
      expect(hints.dimensionHints['Voltage']).toContain('110V');
      expect(hints.dimensionHints['Plug']).toContain('EU');
      expect(hints.dimensionHints['Plug']).toContain('US');
      expect(hints.dimensionHints['Wattage']).toContain('100W');
    });

    it('should prefer primary dimensions when selecting which to include', () => {
      const dimensions = [
        { name: 'Primary1', value: 'V1', isPrimary: true },
        { name: 'Primary2', value: 'V2', isPrimary: true },
        { name: 'NonPrimary1', value: 'V3', isPrimary: false },
        { name: 'NonPrimary2', value: 'V4', isPrimary: false },
        { name: 'NonPrimary3', value: 'V5', isPrimary: false },
        { name: 'NonPrimary4', value: 'V6', isPrimary: false },
        { name: 'NonPrimary5', value: 'V7', isPrimary: false },
      ];
      const variants = [createVariant('1', true, dimensions)];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      const includedDimensions = Object.keys(hints.dimensionHints);
      expect(includedDimensions).toHaveLength(MAX_HINT_DIMENSIONS);
      expect(includedDimensions).toContain('Primary1');
      expect(includedDimensions).toContain('Primary2');
    });

    it('should cap dimensions at MAX_HINT_DIMENSIONS', () => {
      const dimensions = Array.from({ length: 10 }, (_, i) => ({
        name: `Dim${i}`,
        value: `Value${i}`,
        isPrimary: false,
      }));
      const variants = [createVariant('1', true, dimensions)];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(Object.keys(hints.dimensionHints)).toHaveLength(MAX_HINT_DIMENSIONS);
    });

    it('should cap values per dimension at MAX_HINT_VALUES_PER_DIMENSION', () => {
      const variants = Array.from({ length: 15 }, (_, i) =>
        createVariant(`${i}`, true, [{ name: 'Size', value: `Size${i}` }])
      );
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.dimensionHints['Size']).toHaveLength(MAX_HINT_VALUES_PER_DIMENSION);
    });

    it('should handle variants with no dimensions', () => {
      const variants = [
        createVariant('1', true, []),
        createVariant('2', true, []),
      ];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(2);
      expect(Object.keys(hints.dimensionHints)).toHaveLength(0);
    });

    it('should handle mixed variants with and without dimensions', () => {
      const variants = [
        createVariant('1', true, [{ name: 'Color', value: 'Brown' }]),
        createVariant('2', true, []),
        createVariant('3', true, [{ name: 'Color', value: 'Black' }]),
      ];
      const product = createProductDetails(variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(3);
      expect(hints.dimensionHints['Color']).toHaveLength(2);
    });
  });

  describe('buildVariantHintsFromVariants', () => {
    it('should compute hints from a subset of variants', () => {
      const variants = [
        createVariant('1', true, [{ name: 'Color', value: 'Brown' }], { value: 5, isActive: true }),
        createVariant('2', true, [{ name: 'Color', value: 'Black' }], { value: 0, isActive: true }),
      ];

      const hints = buildVariantHintsFromVariants(variants);

      expect(hints.buyableVariantCount).toBe(2);
      expect(hints.inStockBuyableVariantCount).toBe(1);
      expect(hints.dimensionHints['Color']).toContain('Brown');
      expect(hints.dimensionHints['Color']).toContain('Black');
    });

    it('should handle empty variants array', () => {
      const hints = buildVariantHintsFromVariants([]);

      expect(hints.buyableVariantCount).toBe(0);
      expect(hints.inStockBuyableVariantCount).toBe(0);
      expect(Object.keys(hints.dimensionHints)).toHaveLength(0);
    });
  });
});
