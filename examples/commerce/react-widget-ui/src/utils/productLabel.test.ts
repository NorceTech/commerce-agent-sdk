import { describe, it, expect } from 'vitest';
import { formatProductLabel, formatProductLabelString } from './productLabel';
import type { ProductCard } from '../widget/types';

describe('formatProductLabel', () => {
  it('returns primary as title when variantName is undefined', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product' };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('Test Product');
    expect(result.secondary).toBeUndefined();
  });

  it('returns primary as title when variantName is null', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: null };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('Test Product');
    expect(result.secondary).toBeUndefined();
  });

  it('returns primary as title when variantName is empty string', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: '' };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('Test Product');
    expect(result.secondary).toBeUndefined();
  });

  it('returns primary as title when variantName is whitespace only', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: '   ' };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('Test Product');
    expect(result.secondary).toBeUndefined();
  });

  it('returns primary as title when variantName equals title', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: 'Test Product' };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('Test Product');
    expect(result.secondary).toBeUndefined();
  });

  it('returns secondary as variantName when variantName is present and different from title', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: 'Red / Large' };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('Test Product');
    expect(result.secondary).toBe('Red / Large');
  });

  it('handles variantName with special characters', () => {
    const card: ProductCard = { productId: '1', title: 'T-Shirt', variantName: 'Size: M — Color: Blue' };
    const result = formatProductLabel(card);
    expect(result.primary).toBe('T-Shirt');
    expect(result.secondary).toBe('Size: M — Color: Blue');
  });
});

describe('formatProductLabelString', () => {
  it('returns only title when variantName is undefined', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product' };
    expect(formatProductLabelString(card)).toBe('Test Product');
  });

  it('returns only title when variantName is null', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: null };
    expect(formatProductLabelString(card)).toBe('Test Product');
  });

  it('returns only title when variantName is empty', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: '' };
    expect(formatProductLabelString(card)).toBe('Test Product');
  });

  it('returns only title when variantName equals title', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: 'Test Product' };
    expect(formatProductLabelString(card)).toBe('Test Product');
  });

  it('returns title and variantName separated by em dash when variantName is present', () => {
    const card: ProductCard = { productId: '1', title: 'Test Product', variantName: 'Red / Large' };
    expect(formatProductLabelString(card)).toBe('Test Product — Red / Large');
  });
});
