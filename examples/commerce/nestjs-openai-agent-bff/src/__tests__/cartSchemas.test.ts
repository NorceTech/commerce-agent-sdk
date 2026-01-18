import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  cartGetSchema,
  cartAddItemSchema,
  cartSetItemQuantitySchema,
  cartRemoveItemSchema,
} from '../agent/cart/cartSchemas.js';

describe('cartSchemas', () => {
  describe('cartGetSchema', () => {
    it('should accept empty object (no context)', () => {
      const result = cartGetSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept object with context', () => {
      const result = cartGetSchema.safeParse({
        context: { cultureCode: 'sv-SE', currencyCode: 'SEK' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.context).toEqual({ cultureCode: 'sv-SE', currencyCode: 'SEK' });
      }
    });

    it('should produce valid JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartGetSchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });

  describe('cartAddItemSchema', () => {
    it('should accept partNo as string', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 'PART-123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.partNo).toBe('PART-123');
        expect(result.data.quantity).toBe(1); // default
      }
    });

    it('should accept partNo as number and coerce to string', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 456,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.partNo).toBe('456');
      }
    });

    it('should accept quantity as string and coerce to number', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 'PART-123',
        quantity: '3',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(3);
      }
    });

    it('should default quantity to 1 when not provided', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 'PART-123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(1);
      }
    });

    it('should reject quantity of 0', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 'PART-123',
        quantity: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Quantity must be greater than 0');
      }
    });

    it('should reject negative quantity', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 'PART-123',
        quantity: -1,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Quantity must be greater than 0');
      }
    });

    it('should accept optional context', () => {
      const result = cartAddItemSchema.safeParse({
        partNo: 'PART-123',
        quantity: 2,
        context: { cultureCode: 'sv-SE' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.context).toEqual({ cultureCode: 'sv-SE' });
      }
    });

    it('should produce valid JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartAddItemSchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });

  describe('cartSetItemQuantitySchema', () => {
    it('should accept productId and quantity', () => {
      const result = cartSetItemQuantitySchema.safeParse({
        productId: '123',
        quantity: 5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('123');
        expect(result.data.quantity).toBe(5);
      }
    });

    it('should accept productId as number and coerce to string', () => {
      const result = cartSetItemQuantitySchema.safeParse({
        productId: 789,
        quantity: 2,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('789');
      }
    });

    it('should accept quantity as string and coerce to number', () => {
      const result = cartSetItemQuantitySchema.safeParse({
        productId: '123',
        quantity: '4',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(4);
      }
    });

    it('should reject quantity of 0', () => {
      const result = cartSetItemQuantitySchema.safeParse({
        productId: '123',
        quantity: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Quantity must be greater than 0');
      }
    });

    it('should reject negative quantity', () => {
      const result = cartSetItemQuantitySchema.safeParse({
        productId: '123',
        quantity: -5,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Quantity must be greater than 0');
      }
    });

    it('should produce valid JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartSetItemQuantitySchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });

  describe('cartRemoveItemSchema', () => {
    it('should accept productId as string', () => {
      const result = cartRemoveItemSchema.safeParse({
        productId: '123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('123');
      }
    });

    it('should accept productId as number and coerce to string', () => {
      const result = cartRemoveItemSchema.safeParse({
        productId: 456,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('456');
      }
    });

    it('should accept optional context', () => {
      const result = cartRemoveItemSchema.safeParse({
        productId: '123',
        context: { cultureCode: 'sv-SE' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.context).toEqual({ cultureCode: 'sv-SE' });
      }
    });

    it('should produce valid JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartRemoveItemSchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });
});
