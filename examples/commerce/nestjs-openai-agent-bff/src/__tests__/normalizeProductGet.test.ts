import { describe, it, expect } from 'vitest';
import {
  normalizeProductGet,
  extractVariantDimensions,
  buildVariantLabel,
  normalizeVariant,
  computeBuyabilitySummary,
  aggregateDimensionValues,
  extractVariantAvailabilitySummary,
  MAX_VARIANTS,
} from '../agent/product/normalizeProductGet.js';
import type { NormalizedVariant } from '../agent/product/productTypes.js';
import productGetResultWithVariants from './fixtures/productGetResultWithVariants.json';

describe('normalizeProductGet', () => {
  describe('normalizeProductGet function', () => {
    it('should normalize a product with variants from MCP response', () => {
      const result = normalizeProductGet(productGetResultWithVariants);

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('118936');
      expect(result!.uniqueName).toBe('bear-slippers');
      expect(result!.partNo).toBe('1012443');
      expect(result!.name).toBe('Bear Slippers');
      expect(result!.priceIncVat).toBe(459);
      expect(result!.priceExVat).toBe(367.2);
      expect(result!.manufacturerName).toBe('CozyBrand');
      expect(result!.imageUrl).toBe('/images/products/118936/main.jpg');
      expect(result!.isBuyable).toBe(false);
    });

    it('should coerce numeric productId to string', () => {
      const result = normalizeProductGet(productGetResultWithVariants);

      expect(result).not.toBeNull();
      expect(typeof result!.productId).toBe('string');
      expect(result!.productId).toBe('118936');
    });

    it('should normalize variants with coerced IDs', () => {
      const result = normalizeProductGet(productGetResultWithVariants);

      expect(result).not.toBeNull();
      expect(result!.variants).toHaveLength(3);

      const firstVariant = result!.variants[0];
      expect(typeof firstVariant.variantProductId).toBe('string');
      expect(firstVariant.variantProductId).toBe('118934');
      expect(firstVariant.uniqueName).toBe('bear-slippers-22-23-eu');
      expect(firstVariant.partNo).toBe('1012444');
      expect(firstVariant.name).toBe('Brown, 22-23 EU');
      expect(firstVariant.isBuyable).toBe(true);
    });

    it('should compute buyableVariantCount correctly when parent isBuyable is false but variants are buyable', () => {
      const result = normalizeProductGet(productGetResultWithVariants);

      expect(result).not.toBeNull();
      expect(result!.isBuyable).toBe(false);
      expect(result!.buyableVariantCount).toBe(2);
    });

    it('should compute inStockBuyableVariantCount correctly', () => {
      const result = normalizeProductGet(productGetResultWithVariants);

      expect(result).not.toBeNull();
      expect(result!.inStockBuyableVariantCount).toBe(1);
    });

    it('should aggregate dimension values correctly', () => {
      const result = normalizeProductGet(productGetResultWithVariants);

      expect(result).not.toBeNull();
      expect(result!.availableDimensionValues).toHaveProperty('Color');
      expect(result!.availableDimensionValues).toHaveProperty('Size');
      expect(result!.availableDimensionValues['Color']).toContain('Brown');
      expect(result!.availableDimensionValues['Size']).toContain('22-23 EU');
      expect(result!.availableDimensionValues['Size']).toContain('24-25 EU');
      expect(result!.availableDimensionValues['Size']).toContain('26-27 EU');
    });

    it('should return null for invalid input', () => {
      expect(normalizeProductGet(null)).toBeNull();
      expect(normalizeProductGet(undefined)).toBeNull();
      expect(normalizeProductGet({})).toBeNull();
      expect(normalizeProductGet({ content: [] })).toBeNull();
    });

    it('should handle direct object format (not MCP wrapper)', () => {
      const directProduct = {
        productId: 12345,
        name: 'Test Product',
        variants: [],
      };

      const result = normalizeProductGet(directProduct);

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('12345');
      expect(result!.name).toBe('Test Product');
    });

    it('should include variantName at top level when present', () => {
      const productWithVariantName = {
        productId: 12345,
        name: 'Test Product',
        variantName: 'Test Product - Default Variant',
        variants: [],
      };

      const result = normalizeProductGet(productWithVariantName);

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('12345');
      expect(result!.name).toBe('Test Product');
      expect(result!.variantName).toBe('Test Product - Default Variant');
    });

    it('should not include variantName at top level when not present', () => {
      const productWithoutVariantName = {
        productId: 12345,
        name: 'Test Product',
        variants: [],
      };

      const result = normalizeProductGet(productWithoutVariantName);

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('12345');
      expect(result!.name).toBe('Test Product');
      expect(result!.variantName).toBeUndefined();
    });

    it('should cap variants at MAX_VARIANTS', () => {
      const manyVariants = Array.from({ length: 100 }, (_, i) => ({
        productId: i + 1,
        name: `Variant ${i + 1}`,
        isBuyable: true,
      }));

      const product = {
        productId: 1,
        name: 'Product with many variants',
        variants: manyVariants,
      };

      const result = normalizeProductGet(product);

      expect(result).not.toBeNull();
      expect(result!.variants).toHaveLength(MAX_VARIANTS);
    });
  });

  describe('extractVariantDimensions', () => {
    it('should extract dimensions from variantParametrics', () => {
      const variant = {
        variantParametrics: [
          { name: 'Color', value: 'Brown', code: 'basecolor', groupName: 'Specification', isPrimary: true },
          { name: 'Size', value: '22-23 EU', code: 'ArticleSize', groupName: 'Dimensions', isPrimary: true },
        ],
      };

      const { dimensions, dimsMap } = extractVariantDimensions(variant);

      expect(dimensions).toHaveLength(2);
      expect(dimensions[0].name).toBe('Color');
      expect(dimensions[0].value).toBe('Brown');
      expect(dimensions[0].code).toBe('basecolor');
      expect(dimensions[0].isPrimary).toBe(true);

      expect(dimsMap['Color']).toBe('Brown');
      expect(dimsMap['Size']).toBe('22-23 EU');
    });

    it('should merge parametrics after variantParametrics without duplicates', () => {
      const variant = {
        variantParametrics: [
          { name: 'Color', value: 'Brown', code: 'basecolor', isPrimary: true },
        ],
        parametrics: [
          { name: 'Color', value: 'Different Brown', code: 'basecolor', isPrimary: true },
          { name: 'Material', value: 'Cotton', code: 'material', isPrimary: false },
        ],
      };

      const { dimensions, dimsMap } = extractVariantDimensions(variant);

      expect(dimensions).toHaveLength(2);
      expect(dimsMap['Color']).toBe('Brown');
      expect(dimsMap['Material']).toBe('Cotton');
    });

    it('should sort dimensions with primary first', () => {
      const variant = {
        variantParametrics: [
          { name: 'Material', value: 'Cotton', isPrimary: false },
          { name: 'Color', value: 'Brown', isPrimary: true },
          { name: 'Size', value: 'M', isPrimary: true },
        ],
      };

      const { dimensions } = extractVariantDimensions(variant);

      expect(dimensions[0].isPrimary).toBe(true);
      expect(dimensions[1].isPrimary).toBe(true);
      expect(dimensions[2].isPrimary).toBe(false);
    });

    it('should handle empty parametrics', () => {
      const variant = {};

      const { dimensions, dimsMap } = extractVariantDimensions(variant);

      expect(dimensions).toHaveLength(0);
      expect(Object.keys(dimsMap)).toHaveLength(0);
    });

    it('should skip parametrics without name or value', () => {
      const variant = {
        variantParametrics: [
          { name: 'Color', value: 'Brown' },
          { name: '', value: 'Invalid' },
          { name: 'Size' },
          { value: 'NoName' },
        ],
      };

      const { dimensions } = extractVariantDimensions(variant);

      expect(dimensions).toHaveLength(1);
      expect(dimensions[0].name).toBe('Color');
    });
  });

  describe('buildVariantLabel', () => {
    it('should build label from primary dimensions', () => {
      const variant = { name: 'Brown, 22-23 EU' };
      const dimensions = [
        { name: 'Color', value: 'Brown', isPrimary: true },
        { name: 'Size', value: '22-23 EU', isPrimary: true },
      ];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Color: Brown - Size: 22-23 EU');
    });

    it('should fallback to variant.name if no primary dimensions', () => {
      const variant = { name: 'Brown, 22-23 EU' };
      const dimensions = [
        { name: 'Material', value: 'Cotton', isPrimary: false },
      ];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Brown, 22-23 EU');
    });

    it('should return "Unknown variant" if no dimensions and no name', () => {
      const variant = {};
      const dimensions: Array<{ name: string; value: string; isPrimary?: boolean }> = [];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Unknown variant');
    });

    it('should use variantName as fallback when no primary dimensions but variantName is present', () => {
      const variant = { name: 'Brown, 22-23 EU', variantName: 'Bear Slippers - Brown Small' };
      const dimensions = [
        { name: 'Material', value: 'Cotton', isPrimary: false },
      ];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Bear Slippers - Brown Small');
    });

    it('should prefer primary dimensions over variantName', () => {
      const variant = { name: 'Brown, 22-23 EU', variantName: 'Bear Slippers - Brown Small' };
      const dimensions = [
        { name: 'Color', value: 'Brown', isPrimary: true },
        { name: 'Size', value: '22-23 EU', isPrimary: true },
      ];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Color: Brown - Size: 22-23 EU');
    });

    it('should fallback to variant.name when no primary dimensions and no variantName', () => {
      const variant = { name: 'Brown, 22-23 EU' };
      const dimensions = [
        { name: 'Material', value: 'Cotton', isPrimary: false },
      ];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Brown, 22-23 EU');
    });

    it('should limit to 3 primary dimensions', () => {
      const variant = { name: 'Test' };
      const dimensions = [
        { name: 'Color', value: 'Brown', isPrimary: true },
        { name: 'Size', value: 'M', isPrimary: true },
        { name: 'Material', value: 'Cotton', isPrimary: true },
        { name: 'Style', value: 'Casual', isPrimary: true },
      ];

      const label = buildVariantLabel(variant, dimensions);

      expect(label).toBe('Color: Brown - Size: M - Material: Cotton');
      expect(label).not.toContain('Style');
    });
  });

  describe('normalizeVariant', () => {
    it('should normalize a variant with all fields', () => {
      const rawVariant = {
        productId: 118934,
        uniqueName: 'bear-slippers-22-23-eu',
        partNo: '1012444',
        name: 'Brown, 22-23 EU',
        price: 367.2,
        priceIncVat: 459,
        isBuyable: true,
        onHand: {
          value: 5,
          isActive: true,
          nextDeliveryDate: '2024-01-15',
        },
        variantParametrics: [
          { name: 'Color', value: 'Brown', isPrimary: true },
          { name: 'Size', value: '22-23 EU', isPrimary: true },
        ],
        eanCode: '5715493536770',
        uom: 'st',
        uomCount: 1,
      };

      const variant = normalizeVariant(rawVariant);

      expect(variant.variantProductId).toBe('118934');
      expect(variant.uniqueName).toBe('bear-slippers-22-23-eu');
      expect(variant.partNo).toBe('1012444');
      expect(variant.name).toBe('Brown, 22-23 EU');
      expect(variant.price).toBe(367.2);
      expect(variant.priceIncVat).toBe(459);
      expect(variant.isBuyable).toBe(true);
      expect(variant.onHand?.value).toBe(5);
      expect(variant.onHand?.isActive).toBe(true);
      expect(variant.nextDeliveryDate).toBe('2024-01-15');
      expect(variant.eanCode).toBe('5715493536770');
      expect(variant.uom).toBe('st');
      expect(variant.uomCount).toBe(1);
      expect(variant.dimensions).toHaveLength(2);
      expect(variant.dimsMap['Color']).toBe('Brown');
      expect(variant.label).toBe('Color: Brown - Size: 22-23 EU');
    });

    it('should handle variant with missing optional fields', () => {
      const rawVariant = {
        productId: 123,
        isBuyable: false,
      };

      const variant = normalizeVariant(rawVariant);

      expect(variant.variantProductId).toBe('123');
      expect(variant.isBuyable).toBe(false);
      expect(variant.uniqueName).toBeUndefined();
      expect(variant.partNo).toBeUndefined();
      expect(variant.onHand).toBeUndefined();
    });

    it('should coerce string productId', () => {
      const rawVariant = {
        productId: '456',
        isBuyable: true,
      };

      const variant = normalizeVariant(rawVariant);

      expect(variant.variantProductId).toBe('456');
    });

    it('should include variantName when present', () => {
      const rawVariant = {
        productId: 789,
        name: 'Brown, 22-23 EU',
        variantName: 'Bear Slippers - Brown Small',
        isBuyable: true,
      };

      const variant = normalizeVariant(rawVariant);

      expect(variant.variantProductId).toBe('789');
      expect(variant.name).toBe('Brown, 22-23 EU');
      expect(variant.variantName).toBe('Bear Slippers - Brown Small');
    });

    it('should not include variantName when not present', () => {
      const rawVariant = {
        productId: 789,
        name: 'Brown, 22-23 EU',
        isBuyable: true,
      };

      const variant = normalizeVariant(rawVariant);

      expect(variant.variantProductId).toBe('789');
      expect(variant.name).toBe('Brown, 22-23 EU');
      expect(variant.variantName).toBeUndefined();
    });
  });

  describe('computeBuyabilitySummary', () => {
    it('should count buyable variants correctly', () => {
      const variants: NormalizedVariant[] = [
        { variantProductId: '1', isBuyable: true, dimensions: [], dimsMap: {}, label: 'V1' },
        { variantProductId: '2', isBuyable: true, dimensions: [], dimsMap: {}, label: 'V2' },
        { variantProductId: '3', isBuyable: false, dimensions: [], dimsMap: {}, label: 'V3' },
      ];

      const summary = computeBuyabilitySummary(variants);

      expect(summary.buyableVariantCount).toBe(2);
    });

    it('should count in-stock buyable variants correctly', () => {
      const variants: NormalizedVariant[] = [
        { variantProductId: '1', isBuyable: true, onHand: { value: 5, isActive: true }, dimensions: [], dimsMap: {}, label: 'V1' },
        { variantProductId: '2', isBuyable: true, onHand: { value: 0, isActive: true }, dimensions: [], dimsMap: {}, label: 'V2' },
        { variantProductId: '3', isBuyable: true, onHand: { value: 3, isActive: false }, dimensions: [], dimsMap: {}, label: 'V3' },
        { variantProductId: '4', isBuyable: false, onHand: { value: 10, isActive: true }, dimensions: [], dimsMap: {}, label: 'V4' },
      ];

      const summary = computeBuyabilitySummary(variants);

      expect(summary.buyableVariantCount).toBe(3);
      expect(summary.inStockBuyableVariantCount).toBe(1);
    });

    it('should handle empty variants array', () => {
      const summary = computeBuyabilitySummary([]);

      expect(summary.buyableVariantCount).toBe(0);
      expect(summary.inStockBuyableVariantCount).toBe(0);
    });
  });

  describe('aggregateDimensionValues', () => {
    it('should aggregate unique values per dimension', () => {
      const variants: NormalizedVariant[] = [
        { variantProductId: '1', isBuyable: true, dimensions: [{ name: 'Color', value: 'Brown' }, { name: 'Size', value: 'S' }], dimsMap: {}, label: 'V1' },
        { variantProductId: '2', isBuyable: true, dimensions: [{ name: 'Color', value: 'Brown' }, { name: 'Size', value: 'M' }], dimsMap: {}, label: 'V2' },
        { variantProductId: '3', isBuyable: true, dimensions: [{ name: 'Color', value: 'Black' }, { name: 'Size', value: 'L' }], dimsMap: {}, label: 'V3' },
      ];

      const result = aggregateDimensionValues(variants);

      expect(result['Color']).toHaveLength(2);
      expect(result['Color']).toContain('Brown');
      expect(result['Color']).toContain('Black');
      expect(result['Size']).toHaveLength(3);
      expect(result['Size']).toContain('S');
      expect(result['Size']).toContain('M');
      expect(result['Size']).toContain('L');
    });

    it('should handle empty variants array', () => {
      const result = aggregateDimensionValues([]);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle variants without dimensions', () => {
      const variants: NormalizedVariant[] = [
        { variantProductId: '1', isBuyable: true, dimensions: [], dimsMap: {}, label: 'V1' },
      ];

      const result = aggregateDimensionValues(variants);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('extractVariantAvailabilitySummary', () => {
    it('should extract compact summary from normalized product', () => {
      const result = normalizeProductGet(productGetResultWithVariants);
      expect(result).not.toBeNull();

      const summary = extractVariantAvailabilitySummary(result!);

      expect(summary.buyableVariantCount).toBe(2);
      expect(summary.inStockBuyableVariantCount).toBe(1);
      expect(summary.availableDimensionValues).toHaveProperty('Color');
      expect(summary.availableDimensionValues).toHaveProperty('Size');
    });
  });
});
