import { describe, it, expect } from 'vitest';
import { getToolDisplayName, TOOL_DISPLAY_NAME } from '../agent/toolDisplayNames.js';

describe('toolDisplayNames', () => {
  describe('TOOL_DISPLAY_NAME registry', () => {
    it('should have display names for all known tools', () => {
      expect(TOOL_DISPLAY_NAME.product_search).toBe('Searching products');
      expect(TOOL_DISPLAY_NAME.product_get).toBe('Fetching product details');
      expect(TOOL_DISPLAY_NAME.cart_get).toBe('Checking your cart');
      expect(TOOL_DISPLAY_NAME.cart_add_item).toBe('Adding to cart');
      expect(TOOL_DISPLAY_NAME.cart_set_item_quantity).toBe('Updating cart');
      expect(TOOL_DISPLAY_NAME.cart_remove_item).toBe('Removing from cart');
    });
  });

  describe('getToolDisplayName', () => {
    it('should return display name for product_search', () => {
      expect(getToolDisplayName('product_search')).toBe('Searching products');
    });

    it('should return display name for product_get', () => {
      expect(getToolDisplayName('product_get')).toBe('Fetching product details');
    });

    it('should return display name for cart_get', () => {
      expect(getToolDisplayName('cart_get')).toBe('Checking your cart');
    });

    it('should return display name for cart_add_item', () => {
      expect(getToolDisplayName('cart_add_item')).toBe('Adding to cart');
    });

    it('should return display name for cart_set_item_quantity', () => {
      expect(getToolDisplayName('cart_set_item_quantity')).toBe('Updating cart');
    });

    it('should return display name for cart_remove_item', () => {
      expect(getToolDisplayName('cart_remove_item')).toBe('Removing from cart');
    });

    it('should fall back to original tool name if unknown', () => {
      expect(getToolDisplayName('unknown_tool')).toBe('unknown_tool');
    });

    it('should fall back to original tool name for empty string', () => {
      expect(getToolDisplayName('')).toBe('');
    });

    it('should fall back to original tool name for tool with special characters', () => {
      expect(getToolDisplayName('some.tool.name')).toBe('some.tool.name');
    });
  });
});
