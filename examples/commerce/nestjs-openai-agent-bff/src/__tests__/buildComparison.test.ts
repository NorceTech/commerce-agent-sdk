import { describe, it, expect } from 'vitest';
import {
  buildComparison,
  normalizeProductForComparison,
} from '../agent/compare/buildComparison.js';
import { MAX_FEATURES } from '../agent/compare/compareTypes.js';
import type { CompareProductData } from '../agent/compare/compareTypes.js';

function createMockProduct(id: string, overrides: Partial<CompareProductData> = {}): CompareProductData {
  return {
    productId: id,
    name: `Product ${id}`,
    brand: `Brand ${id}`,
    price: {
      amount: 100,
      currency: 'SEK',
      formatted: '100 SEK',
    },
    attributes: {
      color: 'black',
      size: 'M',
      material: 'cotton',
    },
    url: `https://example.com/product/${id}`,
    ...overrides,
  };
}

describe('buildComparison', () => {
  describe('basic functionality', () => {
    it('should build comparison for 2 products', () => {
      const products = [
        createMockProduct('prod-1'),
        createMockProduct('prod-2'),
      ];

      const result = buildComparison(products);

      expect(result.productIds).toHaveLength(2);
      expect(result.productIds).toContain('prod-1');
      expect(result.productIds).toContain('prod-2');
      expect(result.items).toHaveLength(2);
      expect(result.title).toBeDefined();
    });

    it('should build comparison for 3 products', () => {
      const products = [
        createMockProduct('prod-1'),
        createMockProduct('prod-2'),
        createMockProduct('prod-3'),
      ];

      const result = buildComparison(products);

      expect(result.productIds).toHaveLength(3);
      expect(result.items).toHaveLength(3);
    });

    it('should include product details in items', () => {
      const products = [
        createMockProduct('prod-1', { name: 'Test Product', brand: 'Test Brand' }),
        createMockProduct('prod-2'),
      ];

      const result = buildComparison(products);

      const item1 = result.items.find(i => i.productId === 'prod-1');
      expect(item1).toBeDefined();
      expect(item1?.name).toBe('Test Product');
      expect(item1?.brand).toBe('Test Brand');
    });
  });

  describe('table generation', () => {
    it('should generate table with headers and rows', () => {
      const products = [
        createMockProduct('prod-1'),
        createMockProduct('prod-2'),
      ];

      const result = buildComparison(products);

      expect(result.table).toBeDefined();
      expect(result.table?.headers).toBeDefined();
      expect(result.table?.headers.length).toBeGreaterThan(0);
      expect(result.table?.rows).toBeDefined();
      expect(result.table?.rows.length).toBeGreaterThan(0);
    });

    it('should have stable headers across products', () => {
      const products = [
        createMockProduct('prod-1', { attributes: { color: 'red', size: 'M' } }),
        createMockProduct('prod-2', { attributes: { color: 'blue', size: 'L' } }),
      ];

      const result = buildComparison(products);

      expect(result.table?.headers).toContain('Feature');
      expect(result.table?.headers.length).toBe(3);
    });

    it('should intersect attributes across products', () => {
      const products = [
        createMockProduct('prod-1', { attributes: { color: 'red', size: 'M', unique1: 'val1' } }),
        createMockProduct('prod-2', { attributes: { color: 'blue', size: 'L', unique2: 'val2' } }),
      ];

      const result = buildComparison(products);

      const featureNames = result.table?.rows.map(r => r.feature) ?? [];
      expect(featureNames).toContain('Color');
      expect(featureNames).toContain('Size');
    });

    it('should cap features at MAX_FEATURES', () => {
      const manyAttributes: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        manyAttributes[`attr${i}`] = `value${i}`;
      }

      const products = [
        createMockProduct('prod-1', { attributes: manyAttributes }),
        createMockProduct('prod-2', { attributes: manyAttributes }),
      ];

      const result = buildComparison(products);

      expect(result.table?.rows.length).toBeLessThanOrEqual(MAX_FEATURES);
    });

    it('should return MAX_FEATURES constant as 8', () => {
      expect(MAX_FEATURES).toBe(8);
    });
  });

  describe('price handling', () => {
    it('should include price in items', () => {
      const products = [
        createMockProduct('prod-1', { price: { amount: 199, currency: 'SEK', formatted: '199 SEK' } }),
        createMockProduct('prod-2', { price: { amount: 299, currency: 'SEK', formatted: '299 SEK' } }),
      ];

      const result = buildComparison(products);

      const item1 = result.items.find(i => i.productId === 'prod-1');
      expect(item1?.price?.amount).toBe(199);
      expect(item1?.price?.currency).toBe('SEK');
    });

    it('should handle missing price gracefully', () => {
      const products = [
        createMockProduct('prod-1', { price: undefined }),
        createMockProduct('prod-2'),
      ];

      const result = buildComparison(products);

      expect(result.items).toHaveLength(2);
      const item1 = result.items.find(i => i.productId === 'prod-1');
      expect(item1?.price).toBeUndefined();
    });
  });

  describe('custom title', () => {
    it('should use provided title', () => {
      const products = [
        createMockProduct('prod-1'),
        createMockProduct('prod-2'),
      ];

      const result = buildComparison(products, 'Custom Comparison Title');

      expect(result.title).toBe('Custom Comparison Title');
    });

    it('should generate title when not provided', () => {
      const products = [
        createMockProduct('prod-1', { name: 'Product A' }),
        createMockProduct('prod-2', { name: 'Product B' }),
      ];

      const result = buildComparison(products);

      expect(result.title).toBeDefined();
      expect(result.title.length).toBeGreaterThan(0);
    });
  });
});

describe('normalizeProductForComparison', () => {
  it('should normalize raw product data with card structure', () => {
    const rawProduct = {
      card: {
        productId: 'test-123',
        title: 'Test Product',
        brand: 'Test Brand',
        price: '199',
        currency: 'SEK',
        attributes: {
          color: 'red',
        },
      },
    };

    const result = normalizeProductForComparison(rawProduct);

    expect(result).not.toBeNull();
    expect(result?.productId).toBe('test-123');
    expect(result?.name).toBe('Test Product');
    expect(result?.brand).toBe('Test Brand');
  });

  it('should normalize raw product data with flat structure', () => {
    const rawProduct = {
      productId: 'test-456',
      name: 'Flat Product',
      brand: 'Flat Brand',
      price: {
        amount: 299,
        currency: 'SEK',
      },
    };

    const result = normalizeProductForComparison(rawProduct);

    expect(result).not.toBeNull();
    expect(result?.productId).toBe('test-456');
    expect(result?.name).toBe('Flat Product');
  });

  it('should return null for invalid input', () => {
    expect(normalizeProductForComparison(null)).toBeNull();
    expect(normalizeProductForComparison(undefined)).toBeNull();
    expect(normalizeProductForComparison('string')).toBeNull();
    expect(normalizeProductForComparison(123)).toBeNull();
  });

  it('should return null for object without productId', () => {
    const rawProduct = {
      name: 'No ID Product',
      brand: 'Brand',
    };

    const result = normalizeProductForComparison(rawProduct);

    expect(result).toBeNull();
  });

  it('should handle nested price object', () => {
    const rawProduct = {
      productId: 'test-789',
      name: 'Price Test',
      price: {
        amount: 150,
        currency: 'EUR',
        formatted: '150 EUR',
      },
    };

    const result = normalizeProductForComparison(rawProduct);

    expect(result?.price?.amount).toBe(150);
    expect(result?.price?.currency).toBe('EUR');
  });

  it('should handle string price', () => {
    const rawProduct = {
      card: {
        productId: 'test-price',
        title: 'String Price Product',
        price: '250',
        currency: 'SEK',
      },
    };

    const result = normalizeProductForComparison(rawProduct);

    expect(result?.price?.amount).toBe(250);
    expect(result?.price?.currency).toBe('SEK');
  });
});
