import { describe, it, expect } from 'vitest';
import {
  normalizeProductSearchResultToCards,
  normalizeProductGetResultToCard,
  normalizeOnHand,
  computeAvailability,
  getRelevantOnHand,
  deriveAvailabilityFromOnHand,
} from '../agent/normalize.js';
import type { ProductCard } from '../http/responseTypes.js';

import productSearchResult from './fixtures/productSearchResult.json';
import productGetResult from './fixtures/productGetResult.json';
import productSearchResultAltFields from './fixtures/productSearchResultAltFields.json';

describe('normalize', () => {
  describe('normalizeProductSearchResultToCards', () => {
    it('should convert MCP search result to ProductCard array', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResult);

      expect(cards).toBeInstanceOf(Array);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThanOrEqual(6);

      const firstCard = cards[0];
      expect(firstCard).toHaveProperty('productId');
      expect(firstCard).toHaveProperty('title');
      expect(typeof firstCard.productId).toBe('string');
      expect(typeof firstCard.title).toBe('string');
    });

    it('should cap results to MAX_CARDS (6)', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResult);

      expect(cards.length).toBeLessThanOrEqual(6);
    });

    it('should extract product fields correctly', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResult);
      const firstCard = cards[0];

      expect(firstCard.productId).toBe('12345');
      expect(firstCard.title).toBe('Blue Running Shoes');
      expect(firstCard.imageUrl).toBe('/images/products/12345/main.jpg');
      expect(firstCard.price).toBe('99.99');
      expect(firstCard.currency).toBe('SEK');
    });

    it('should extract attributes when available', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResult);
      const firstCard = cards[0];

      expect(firstCard.attributes).toBeDefined();
      expect(firstCard.attributes?.color).toBe('blue');
      expect(firstCard.attributes?.size).toBe('42');
      expect(firstCard.attributes?.brand).toBe('SportBrand');
    });

    it('should handle alternative field names (tolerant extraction)', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResultAltFields);

      expect(cards.length).toBeGreaterThan(0);

      const firstCard = cards[0];
      expect(firstCard.productId).toBe('ABC123');
      expect(firstCard.title).toBe('Wireless Headphones');
      expect(firstCard.imageUrl).toBe('/images/products/abc123/thumb.jpg');
    });

    it('should handle partNo as productId fallback', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResultAltFields);

      const secondCard = cards[1];
      expect(secondCard.productId).toBe('XYZ789');
      expect(secondCard.title).toBe('Bluetooth Speaker');
    });

    it('should handle images array for imageUrl', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResultAltFields);

      const secondCard = cards[1];
      expect(secondCard.imageUrl).toBe('/images/products/xyz789/1.jpg');
    });

    it('should return empty array for null/undefined input', () => {
      expect(normalizeProductSearchResultToCards(null)).toEqual([]);
      expect(normalizeProductSearchResultToCards(undefined)).toEqual([]);
    });

    it('should return empty array for invalid input', () => {
      expect(normalizeProductSearchResultToCards({})).toEqual([]);
      expect(normalizeProductSearchResultToCards({ content: [] })).toEqual([]);
      expect(normalizeProductSearchResultToCards('invalid')).toEqual([]);
    });

    it('should preserve relative image URLs without transformation', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResult);

      for (const card of cards) {
        if (card.imageUrl) {
          expect(card.imageUrl).toMatch(/^\/images\//);
          expect(card.imageUrl).not.toMatch(/^https?:\/\//);
        }
      }
    });

    it('should match snapshot for stability', () => {
      const cards = normalizeProductSearchResultToCards(productSearchResult);
      expect(cards).toMatchSnapshot();
    });

    it('should include variantName when present in search results', () => {
      const searchResultWithVariantName = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { 
                  productId: '1', 
                  name: 'Bear Slippers', 
                  variantName: 'Bear Slippers - Brown Small',
                  onHand: { value: 10, isActive: true } 
                },
                { 
                  productId: '2', 
                  name: 'Running Shoes', 
                  onHand: { value: 5, isActive: true } 
                },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResultWithVariantName);

      expect(cards.length).toBe(2);
      expect(cards[0].productId).toBe('1');
      expect(cards[0].title).toBe('Bear Slippers');
      expect(cards[0].variantName).toBe('Bear Slippers - Brown Small');
      expect(cards[1].productId).toBe('2');
      expect(cards[1].title).toBe('Running Shoes');
      expect(cards[1].variantName).toBeUndefined();
    });

    it('should include thumbnailImageKey when present in search results', () => {
      const searchResultWithThumbnailKey = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { 
                  productId: '1', 
                  name: 'Bear Slippers', 
                  thumbnailImageKey: 'abc123-thumb-key',
                  onHand: { value: 10, isActive: true } 
                },
                { 
                  productId: '2', 
                  name: 'Running Shoes', 
                  onHand: { value: 5, isActive: true } 
                },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResultWithThumbnailKey);

      expect(cards.length).toBe(2);
      expect(cards[0].productId).toBe('1');
      expect(cards[0].title).toBe('Bear Slippers');
      expect(cards[0].thumbnailImageKey).toBe('abc123-thumb-key');
      expect(cards[1].productId).toBe('2');
      expect(cards[1].title).toBe('Running Shoes');
      expect(cards[1].thumbnailImageKey).toBeUndefined();
    });

    it('should handle null thumbnailImageKey correctly', () => {
      const searchResultWithNullThumbnailKey = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { 
                  productId: '1', 
                  name: 'Product with null key', 
                  thumbnailImageKey: null,
                  onHand: { value: 10, isActive: true } 
                },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResultWithNullThumbnailKey);

      expect(cards.length).toBe(1);
      expect(cards[0].thumbnailImageKey).toBeNull();
    });

    it('should coerce numeric thumbnailImageKey to string', () => {
      const searchResultWithNumericThumbnailKey = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { 
                  productId: '1', 
                  name: 'Product with numeric key', 
                  thumbnailImageKey: 12345,
                  onHand: { value: 10, isActive: true } 
                },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResultWithNumericThumbnailKey);

      expect(cards.length).toBe(1);
      expect(cards[0].thumbnailImageKey).toBe('12345');
    });
  });

  describe('normalizeProductGetResultToCard', () => {
    it('should convert MCP get result to ProductCard', () => {
      const card = normalizeProductGetResultToCard(productGetResult);

      expect(card).not.toBeNull();
      expect(card).toHaveProperty('productId');
      expect(card).toHaveProperty('title');
    });

    it('should extract product fields correctly', () => {
      const card = normalizeProductGetResultToCard(productGetResult);

      expect(card?.productId).toBe('12345');
      expect(card?.title).toBe('Blue Running Shoes');
      expect(card?.imageUrl).toBe('/images/products/12345/main.jpg');
      expect(card?.price).toBe('99.99');
      expect(card?.currency).toBe('SEK');
    });

    it('should extract attributes when available', () => {
      const card = normalizeProductGetResultToCard(productGetResult);

      expect(card?.attributes).toBeDefined();
      expect(card?.attributes?.color).toBe('blue');
      expect(card?.attributes?.size).toBe('42');
      expect(card?.attributes?.brand).toBe('SportBrand');
      expect(card?.attributes?.material).toBe('synthetic');
      expect(card?.attributes?.category).toBe('footwear');
    });

    it('should extract subtitle from description', () => {
      const card = normalizeProductGetResultToCard(productGetResult);

      expect(card?.subtitle).toBeDefined();
      expect(card?.subtitle).toContain('Comfortable running shoes');
    });

    it('should return null for null/undefined input', () => {
      expect(normalizeProductGetResultToCard(null)).toBeNull();
      expect(normalizeProductGetResultToCard(undefined)).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(normalizeProductGetResultToCard({})).toBeNull();
      expect(normalizeProductGetResultToCard({ content: [] })).toBeNull();
      expect(normalizeProductGetResultToCard('invalid')).toBeNull();
    });

    it('should return null when required fields are missing', () => {
      const invalidResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ description: 'No ID or name' }),
          },
        ],
      };
      expect(normalizeProductGetResultToCard(invalidResult)).toBeNull();
    });

    it('should preserve relative image URLs without transformation', () => {
      const card = normalizeProductGetResultToCard(productGetResult);

      if (card?.imageUrl) {
        expect(card.imageUrl).toMatch(/^\/images\//);
        expect(card.imageUrl).not.toMatch(/^https?:\/\//);
      }
    });

    it('should match snapshot for stability', () => {
      const card = normalizeProductGetResultToCard(productGetResult);
      expect(card).toMatchSnapshot();
    });
  });

  describe('normalizeOnHand', () => {
    it('should parse given example correctly', () => {
      const raw = {
        value: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
        isActive: true,
      };

      const result = normalizeOnHand(raw);

      expect(result).toEqual({
        value: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
        isActive: true,
      });
    });

    it('should handle missing/null fields safely', () => {
      const raw = {
        value: 5,
      };

      const result = normalizeOnHand(raw);

      expect(result).toEqual({
        value: 5,
      });
      expect(result?.incomingValue).toBeUndefined();
      expect(result?.nextDeliveryDate).toBeUndefined();
      expect(result?.leadtimeDayCount).toBeUndefined();
      expect(result?.isActive).toBeUndefined();
    });

    it('should preserve nextDeliveryDate null', () => {
      const raw = {
        value: 0,
        nextDeliveryDate: null,
      };

      const result = normalizeOnHand(raw);

      expect(result).toEqual({
        value: 0,
        nextDeliveryDate: null,
      });
    });

    it('should coerce string numbers to numbers', () => {
      const raw = {
        value: '10',
        incomingValue: '5',
        leadtimeDayCount: '3',
      };

      const result = normalizeOnHand(raw);

      expect(result).toEqual({
        value: 10,
        incomingValue: 5,
        leadtimeDayCount: 3,
      });
    });

    it('should coerce string boolean to boolean', () => {
      const raw = {
        value: 10,
        isActive: 'true',
      };

      const result = normalizeOnHand(raw);

      expect(result?.isActive).toBe(true);
    });

    it('should return undefined for null/undefined input', () => {
      expect(normalizeOnHand(null)).toBeUndefined();
      expect(normalizeOnHand(undefined)).toBeUndefined();
    });

    it('should return undefined for non-object input', () => {
      expect(normalizeOnHand('invalid')).toBeUndefined();
      expect(normalizeOnHand(123)).toBeUndefined();
    });

    it('should return undefined for empty object', () => {
      expect(normalizeOnHand({})).toBeUndefined();
    });

    it('should ignore invalid number values', () => {
      const raw = {
        value: 'not-a-number',
        incomingValue: 5,
      };

      const result = normalizeOnHand(raw);

      expect(result).toEqual({
        incomingValue: 5,
      });
      expect(result?.value).toBeUndefined();
    });
  });

  describe('computeAvailability', () => {
    it('should return unknown when onHand is missing', () => {
      const result = computeAvailability(undefined);

      expect(result).toEqual({ status: 'unknown' });
    });

    it('should return inactive when isActive is false', () => {
      const onHand = {
        value: 10,
        isActive: false,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
      };

      const result = computeAvailability(onHand);

      expect(result.status).toBe('inactive');
      expect(result.onHandValue).toBe(10);
      expect(result.incomingValue).toBe(5);
      expect(result.nextDeliveryDate).toBe('2024-02-15');
      expect(result.leadtimeDayCount).toBe(3);
    });

    it('should return in_stock when value > 0 and active', () => {
      const onHand = {
        value: 10,
        isActive: true,
      };

      const result = computeAvailability(onHand);

      expect(result.status).toBe('in_stock');
      expect(result.onHandValue).toBe(10);
    });

    it('should return in_stock when value > 0 and isActive is undefined', () => {
      const onHand = {
        value: 5,
      };

      const result = computeAvailability(onHand);

      expect(result.status).toBe('in_stock');
      expect(result.onHandValue).toBe(5);
    });

    it('should return out_of_stock when value is 0 and active', () => {
      const onHand = {
        value: 0,
        isActive: true,
        incomingValue: 10,
        nextDeliveryDate: '2024-02-20',
      };

      const result = computeAvailability(onHand);

      expect(result.status).toBe('out_of_stock');
      expect(result.onHandValue).toBe(0);
      expect(result.incomingValue).toBe(10);
      expect(result.nextDeliveryDate).toBe('2024-02-20');
    });

    it('should return out_of_stock when value is undefined and active', () => {
      const onHand = {
        isActive: true,
      };

      const result = computeAvailability(onHand);

      expect(result.status).toBe('out_of_stock');
    });

    it('should include all onHand fields in result', () => {
      const onHand = {
        value: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
        isActive: true,
      };

      const result = computeAvailability(onHand);

      expect(result).toEqual({
        status: 'in_stock',
        onHandValue: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
      });
    });
  });

  describe('availability sorting in normalizeProductSearchResultToCards', () => {
    it('should sort in_stock products before out_of_stock', () => {
      const searchResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { productId: '1', name: 'Out of Stock Product', onHand: { value: 0, isActive: true } },
                { productId: '2', name: 'In Stock Product', onHand: { value: 10, isActive: true } },
                { productId: '3', name: 'Unknown Product' },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResult);

      expect(cards.length).toBe(3);
      expect(cards[0].productId).toBe('2');
      expect(cards[0].availability?.status).toBe('in_stock');
      expect(cards[1].productId).toBe('3');
      expect(cards[1].availability?.status).toBe('unknown');
      expect(cards[2].productId).toBe('1');
      expect(cards[2].availability?.status).toBe('out_of_stock');
    });

    it('should sort inactive products last', () => {
      const searchResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { productId: '1', name: 'Inactive Product', onHand: { value: 10, isActive: false } },
                { productId: '2', name: 'Out of Stock Product', onHand: { value: 0, isActive: true } },
                { productId: '3', name: 'In Stock Product', onHand: { value: 5, isActive: true } },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResult);

      expect(cards.length).toBe(3);
      expect(cards[0].productId).toBe('3');
      expect(cards[0].availability?.status).toBe('in_stock');
      expect(cards[1].productId).toBe('2');
      expect(cards[1].availability?.status).toBe('out_of_stock');
      expect(cards[2].productId).toBe('1');
      expect(cards[2].availability?.status).toBe('inactive');
    });

    it('should preserve original order within same availability bucket', () => {
      const searchResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { productId: '1', name: 'In Stock A', onHand: { value: 10, isActive: true } },
                { productId: '2', name: 'In Stock B', onHand: { value: 5, isActive: true } },
                { productId: '3', name: 'In Stock C', onHand: { value: 20, isActive: true } },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResult);

      expect(cards.length).toBe(3);
      expect(cards[0].productId).toBe('1');
      expect(cards[1].productId).toBe('2');
      expect(cards[2].productId).toBe('3');
    });

    it('should include availability data in cards', () => {
      const searchResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                {
                  productId: '1',
                  name: 'Product with full onHand',
                  onHand: {
                    value: 10,
                    incomingValue: 5,
                    nextDeliveryDate: '2024-02-15',
                    leadtimeDayCount: 3,
                    isActive: true,
                  },
                },
              ],
            }),
          },
        ],
      };

      const cards = normalizeProductSearchResultToCards(searchResult);

      expect(cards.length).toBe(1);
      expect(cards[0].availability).toEqual({
        status: 'in_stock',
        onHandValue: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
      });
    });
  });

  describe('getRelevantOnHand', () => {
    it('should return undefined for null/undefined input', () => {
      expect(getRelevantOnHand(null, '123')).toBeUndefined();
      expect(getRelevantOnHand(undefined, '123')).toBeUndefined();
    });

    it('should return root onHand when no variants exist', () => {
      const productGet = {
        onHand: { value: 10, isActive: true },
      };

      const result = getRelevantOnHand(productGet, '123');

      expect(result).toEqual({ value: 10, isActive: true });
    });

    it('should return root onHand when no matching variant exists', () => {
      const productGet = {
        onHand: { value: 10, isActive: true },
        variants: [
          { productId: 456, onHand: { value: 5, isActive: true } },
        ],
      };

      const result = getRelevantOnHand(productGet, '123');

      expect(result).toEqual({ value: 10, isActive: true });
    });

    it('should return matching variant onHand when variant exists (string productId)', () => {
      const productGet = {
        onHand: { value: 10, isActive: true },
        variants: [
          { productId: '123', onHand: { value: 5, isActive: true } },
          { productId: '456', onHand: { value: 3, isActive: true } },
        ],
      };

      const result = getRelevantOnHand(productGet, '123');

      expect(result).toEqual({ value: 5, isActive: true });
    });

    it('should return matching variant onHand when variant exists (number productId coerced to string)', () => {
      const productGet = {
        onHand: { value: 10, isActive: true },
        variants: [
          { productId: 123, onHand: { value: 5, isActive: true } },
          { productId: 456, onHand: { value: 3, isActive: true } },
        ],
      };

      const result = getRelevantOnHand(productGet, '123');

      expect(result).toEqual({ value: 5, isActive: true });
    });

    it('should fall back to root onHand when matching variant has no onHand', () => {
      const productGet = {
        onHand: { value: 10, isActive: true },
        variants: [
          { productId: '123' },
        ],
      };

      const result = getRelevantOnHand(productGet, '123');

      expect(result).toEqual({ value: 10, isActive: true });
    });

    it('should return undefined when no onHand exists anywhere', () => {
      const productGet = {
        variants: [{ productId: '123' }],
      };

      const result = getRelevantOnHand(productGet, '123');

      expect(result).toBeUndefined();
    });

    it('should return root onHand when requestedProductId is undefined', () => {
      const productGet = {
        onHand: { value: 10, isActive: true },
        variants: [
          { productId: '123', onHand: { value: 5, isActive: true } },
        ],
      };

      const result = getRelevantOnHand(productGet, undefined);

      expect(result).toEqual({ value: 10, isActive: true });
    });
  });

  describe('deriveAvailabilityFromOnHand', () => {
    it('should return unknown status when onHand is undefined', () => {
      const result = deriveAvailabilityFromOnHand(undefined);

      expect(result.status).toBe('unknown');
    });

    it('should return in_stock when value > 0 and active', () => {
      const result = deriveAvailabilityFromOnHand({
        value: 10,
        isActive: true,
      });

      expect(result.status).toBe('in_stock');
      expect(result.onHandValue).toBe(10);
    });

    it('should return out_of_stock when value is 0 and active', () => {
      const result = deriveAvailabilityFromOnHand({
        value: 0,
        isActive: true,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
      });

      expect(result.status).toBe('out_of_stock');
      expect(result.onHandValue).toBe(0);
      expect(result.incomingValue).toBe(5);
      expect(result.nextDeliveryDate).toBe('2024-02-15');
    });

    it('should return inactive when isActive is false', () => {
      const result = deriveAvailabilityFromOnHand({
        value: 10,
        isActive: false,
      });

      expect(result.status).toBe('inactive');
      expect(result.onHandValue).toBe(10);
    });

    it('should include all onHand fields in result', () => {
      const result = deriveAvailabilityFromOnHand({
        value: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
        isActive: true,
      });

      expect(result).toEqual({
        status: 'in_stock',
        onHandValue: 10,
        incomingValue: 5,
        nextDeliveryDate: '2024-02-15',
        leadtimeDayCount: 3,
      });
    });
  });
});
