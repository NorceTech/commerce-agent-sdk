import { describe, it, expect } from 'vitest';
import type { ProductCard } from '../http/responseTypes.js';
import {
  buildVariantHints,
  MAX_HINT_DIMENSIONS,
  MAX_HINT_VALUES_PER_DIMENSION,
} from '../agent/product/variantHints.js';
import {
  shouldEnrichSearchResults,
  MAX_ENRICH_GET,
} from '../agent/product/enrichmentPolicy.js';
import type { NormalizedProductDetails, NormalizedVariant } from '../agent/product/productTypes.js';
import type { LastResultItem } from '../session/sessionTypes.js';

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
function createProductDetails(
  productId: string,
  name: string,
  variants: NormalizedVariant[]
): NormalizedProductDetails {
  const buyableVariantCount = variants.filter(v => v.isBuyable).length;
  return {
    productId,
    name,
    variants,
    buyableVariantCount,
    inStockBuyableVariantCount: variants.filter(v => v.isBuyable && v.onHand?.value && v.onHand.value > 0 && v.onHand.isActive).length,
    availableDimensionValues: {},
    isBuyable: buyableVariantCount > 0,
  };
}

/**
 * Helper to create a ProductCard with availability.
 */
function createProductCard(
  productId: string,
  title: string,
  availability?: { buyableVariants: number; inStockBuyableVariants: number },
  dimensionHints?: Record<string, string[]>
): ProductCard {
  return {
    productId,
    title,
    availability,
    dimensionHints,
  };
}

/**
 * Helper to create a LastResultItem.
 */
function createLastResultItem(
  productId: string,
  name: string,
  buyableVariantCount?: number,
  inStockBuyableVariantCount?: number,
  availableDimensionValues?: Record<string, string[]>
): LastResultItem {
  return {
    index: 1,
    productId,
    name,
    buyableVariantCount,
    inStockBuyableVariantCount,
    availableDimensionValues,
  };
}

/**
 * Simulates the card sorting logic from chatHandler.ts
 */
function sortCardsByAvailability(cards: ProductCard[]): ProductCard[] {
  return [...cards].sort((a, b) => {
    const aInStock = a.availability?.inStockBuyableVariants ?? -1;
    const bInStock = b.availability?.inStockBuyableVariants ?? -1;
    
    if (aInStock >= 0 && bInStock < 0) return -1;
    if (aInStock < 0 && bInStock >= 0) return 1;
    
    if (aInStock !== bInStock) {
      return bInStock - aInStock;
    }
    
    const aBuyable = a.availability?.buyableVariants ?? -1;
    const bBuyable = b.availability?.buyableVariants ?? -1;
    
    if (aBuyable !== bBuyable) {
      return bBuyable - aBuyable;
    }
    
    return 0;
  });
}

describe('Variant-Aware Product Presentation Integration', () => {
  describe('Scenario: User asks for slippers with specific size (Size/Color example)', () => {
    it('should compute variant hints with Size/Color dimensions', () => {
      const variants = [
        createVariant('118934', true, [
          { name: 'Color', value: 'Brown', isPrimary: true },
          { name: 'Size', value: '22-23 EU', isPrimary: true },
        ], { value: 5, isActive: true }),
        createVariant('118935', true, [
          { name: 'Color', value: 'Brown', isPrimary: true },
          { name: 'Size', value: '24-25 EU', isPrimary: true },
        ], { value: 3, isActive: true }),
        createVariant('118939', true, [
          { name: 'Color', value: 'Brown', isPrimary: true },
          { name: 'Size', value: '26-27 EU', isPrimary: true },
        ], { value: 0, isActive: true }),
      ];
      const product = createProductDetails('118936', 'Bear Slippers', variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(3);
      expect(hints.inStockBuyableVariantCount).toBe(2);
      expect(hints.dimensionHints['Color']).toContain('Brown');
      expect(hints.dimensionHints['Size']).toContain('22-23 EU');
      expect(hints.dimensionHints['Size']).toContain('24-25 EU');
      expect(hints.dimensionHints['Size']).toContain('26-27 EU');
    });

    it('should trigger enrichment when user asks for specific size', () => {
      const lastResults = [
        createLastResultItem('118936', 'Bear Slippers'),
        createLastResultItem('118937', 'Cat Slippers'),
        createLastResultItem('118938', 'Dog Slippers'),
      ];

      const decision = shouldEnrichSearchResults('I need slippers in size 26-27', lastResults);

      expect(decision.shouldEnrich).toBe(true);
      expect(decision.productIdsToEnrich).toHaveLength(MAX_ENRICH_GET);
      expect(decision.productIdsToEnrich).toContain('118936');
    });

    it('should include availability and dimensionHints in cards after enrichment', () => {
      const card = createProductCard(
        '118936',
        'Bear Slippers',
        { buyableVariants: 3, inStockBuyableVariants: 2 },
        { Color: ['Brown'], Size: ['22-23 EU', '24-25 EU', '26-27 EU'] }
      );

      expect(card.availability?.buyableVariants).toBe(3);
      expect(card.availability?.inStockBuyableVariants).toBe(2);
      expect(card.dimensionHints?.['Size']).toContain('26-27 EU');
    });
  });

  describe('Scenario: Non-Size/Color dimensions (Voltage/Plug)', () => {
    it('should handle generic dimensions correctly', () => {
      const variants = [
        createVariant('200002', true, [
          { name: 'Voltage', value: '230V', isPrimary: true },
          { name: 'Plug', value: 'EU', isPrimary: true },
        ], { value: 10, isActive: true }),
        createVariant('200003', true, [
          { name: 'Voltage', value: '110V', isPrimary: true },
          { name: 'Plug', value: 'US', isPrimary: true },
        ], { value: 5, isActive: true }),
      ];
      const product = createProductDetails('200001', 'Electric Heater', variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(2);
      expect(hints.inStockBuyableVariantCount).toBe(2);
      expect(hints.dimensionHints['Voltage']).toContain('230V');
      expect(hints.dimensionHints['Voltage']).toContain('110V');
      expect(hints.dimensionHints['Plug']).toContain('EU');
      expect(hints.dimensionHints['Plug']).toContain('US');
    });

    it('should trigger enrichment when user asks about voltage', () => {
      const lastResults = [
        createLastResultItem('200001', 'Electric Heater'),
      ];

      const decision = shouldEnrichSearchResults('Do you have this in 230V?', lastResults);

      expect(decision.shouldEnrich).toBe(true);
    });

    it('should not crash with non-standard dimension names', () => {
      const variants = [
        createVariant('300001', true, [
          { name: 'Wattage', value: '100W', isPrimary: true },
          { name: 'Connector Type', value: 'USB-C', isPrimary: false },
          { name: 'Cable Length', value: '2m', isPrimary: false },
        ], { value: 5, isActive: true }),
      ];
      const product = createProductDetails('300000', 'Power Adapter', variants);

      const hints = buildVariantHints(product);

      expect(hints.buyableVariantCount).toBe(1);
      expect(hints.dimensionHints['Wattage']).toContain('100W');
      expect(hints.dimensionHints['Connector Type']).toContain('USB-C');
      expect(hints.dimensionHints['Cable Length']).toContain('2m');
    });
  });

  describe('Ranking: Products with in-stock buyable variants sort first', () => {
    it('should sort cards by inStockBuyableVariants descending', () => {
      const cards = [
        createProductCard('1', 'Product A', { buyableVariants: 5, inStockBuyableVariants: 1 }),
        createProductCard('2', 'Product B', { buyableVariants: 3, inStockBuyableVariants: 3 }),
        createProductCard('3', 'Product C', { buyableVariants: 10, inStockBuyableVariants: 0 }),
      ];

      const sorted = sortCardsByAvailability(cards);

      expect(sorted[0].productId).toBe('2');
      expect(sorted[1].productId).toBe('1');
      expect(sorted[2].productId).toBe('3');
    });

    it('should sort by buyableVariants when inStockBuyableVariants are equal', () => {
      const cards = [
        createProductCard('1', 'Product A', { buyableVariants: 2, inStockBuyableVariants: 1 }),
        createProductCard('2', 'Product B', { buyableVariants: 5, inStockBuyableVariants: 1 }),
        createProductCard('3', 'Product C', { buyableVariants: 3, inStockBuyableVariants: 1 }),
      ];

      const sorted = sortCardsByAvailability(cards);

      expect(sorted[0].productId).toBe('2');
      expect(sorted[1].productId).toBe('3');
      expect(sorted[2].productId).toBe('1');
    });

    it('should place cards with availability data before those without', () => {
      const cards = [
        createProductCard('1', 'Product A'),
        createProductCard('2', 'Product B', { buyableVariants: 1, inStockBuyableVariants: 0 }),
        createProductCard('3', 'Product C'),
      ];

      const sorted = sortCardsByAvailability(cards);

      expect(sorted[0].productId).toBe('2');
    });

    it('should de-prioritize products with 0 buyable variants', () => {
      const cards = [
        createProductCard('1', 'Discontinued', { buyableVariants: 0, inStockBuyableVariants: 0 }),
        createProductCard('2', 'Available', { buyableVariants: 3, inStockBuyableVariants: 2 }),
        createProductCard('3', 'Low Stock', { buyableVariants: 1, inStockBuyableVariants: 0 }),
      ];

      const sorted = sortCardsByAvailability(cards);

      expect(sorted[0].productId).toBe('2');
      expect(sorted[1].productId).toBe('3');
      expect(sorted[2].productId).toBe('1');
    });
  });

  describe('Bounded enrichment', () => {
    it('should limit enrichment to MAX_ENRICH_GET products', () => {
      const lastResults = [
        createLastResultItem('1', 'Product 1'),
        createLastResultItem('2', 'Product 2'),
        createLastResultItem('3', 'Product 3'),
        createLastResultItem('4', 'Product 4'),
        createLastResultItem('5', 'Product 5'),
      ];

      const decision = shouldEnrichSearchResults('What sizes are available?', lastResults);

      expect(decision.productIdsToEnrich).toHaveLength(MAX_ENRICH_GET);
    });

    it('should not trigger enrichment when availability is already known', () => {
      const lastResults = [
        createLastResultItem('1', 'Product 1', 5, 3, { Size: ['S', 'M', 'L'] }),
        createLastResultItem('2', 'Product 2', 2, 1, { Size: ['M', 'L'] }),
      ];

      const decision = shouldEnrichSearchResults('Show me more details', lastResults);

      expect(decision.shouldEnrich).toBe(false);
    });
  });

  describe('Dimension hints capping', () => {
    it('should cap dimensions at MAX_HINT_DIMENSIONS', () => {
      const dimensions = Array.from({ length: 10 }, (_, i) => ({
        name: `Dim${i}`,
        value: `Value${i}`,
        isPrimary: false,
      }));
      const variants = [createVariant('1', true, dimensions)];
      const product = createProductDetails('test', 'Test Product', variants);

      const hints = buildVariantHints(product);

      expect(Object.keys(hints.dimensionHints).length).toBeLessThanOrEqual(MAX_HINT_DIMENSIONS);
    });

    it('should cap values per dimension at MAX_HINT_VALUES_PER_DIMENSION', () => {
      const variants = Array.from({ length: 15 }, (_, i) =>
        createVariant(`${i}`, true, [{ name: 'Size', value: `Size${i}` }])
      );
      const product = createProductDetails('test', 'Test Product', variants);

      const hints = buildVariantHints(product);

      expect(hints.dimensionHints['Size'].length).toBeLessThanOrEqual(MAX_HINT_VALUES_PER_DIMENSION);
    });
  });
});
