import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../config.js', () => ({
  config: {
    norce: {
      mcp: {
        statusSeed: '',
      },
    },
  },
}));

import { productSearchSchema, productGetSchema, createTools } from '../agent/tools.js';
import {
  cartGetSchema,
  cartAddItemSchema,
  cartSetItemQuantitySchema,
  cartRemoveItemSchema,
} from '../agent/cart/cartSchemas.js';

/**
 * Tests to ensure tool schemas are correctly converted to JSON Schema format
 * that OpenAI expects: { type: "object", properties: {...}, required: [...] }
 */
describe('Tool Schema Conversion', () => {
  describe('z.toJSONSchema conversion', () => {
    it('should convert productSearchSchema to JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(productSearchSchema);
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
      expect(jsonSchema).toHaveProperty('required');
    });

    it('should convert productGetSchema to JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(productGetSchema);
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });

    it('should include required fields in productSearchSchema (full schema with context)', () => {
      const jsonSchema = z.toJSONSchema(productSearchSchema) as {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
      };
      
      expect(jsonSchema.required).toContain('query');
      // Note: Full schema still has context for backwards compatibility,
      // but LLM schemas (used for OpenAI) do not include context
    });

    it('should include all expected properties in productSearchSchema (full schema)', () => {
      const jsonSchema = z.toJSONSchema(productSearchSchema) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.properties).toHaveProperty('query');
      expect(jsonSchema.properties).toHaveProperty('filters');
      expect(jsonSchema.properties).toHaveProperty('pageSize');
      // Full schema has context for backwards compatibility
      expect(jsonSchema.properties).toHaveProperty('context');
    });

    it('should include all expected properties in productGetSchema (full schema)', () => {
      const jsonSchema = z.toJSONSchema(productGetSchema) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.properties).toHaveProperty('productId');
      expect(jsonSchema.properties).toHaveProperty('partNo');
      // Full schema has context for backwards compatibility
      expect(jsonSchema.properties).toHaveProperty('context');
    });

    it('should produce valid JSON Schema without $ref at top level', () => {
      const jsonSchema = z.toJSONSchema(productSearchSchema) as Record<string, unknown>;
      
      // OpenAI requires the schema to have type: "object" at top level, not a $ref
      expect(jsonSchema).not.toHaveProperty('$ref');
      expect(jsonSchema.type).toBe('object');
    });
  });

  describe('createTools output format', () => {
    it('should create tools with parameters that have type "object"', () => {
      // Create mock dependencies
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);

      expect(tools.length).toBeGreaterThan(0);
      
      // Verify each tool's parameters schema
      for (const tool of tools) {
        const jsonSchema = z.toJSONSchema(tool.parameters) as Record<string, unknown>;
        expect(jsonSchema.type).toBe('object');
        expect(jsonSchema).toHaveProperty('properties');
      }
    });

    it('should have product_search tool with correct schema structure', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const productSearchTool = tools.find(t => t.name === 'product_search');

      expect(productSearchTool).toBeDefined();
      
      const jsonSchema = z.toJSONSchema(productSearchTool!.parameters) as {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
      };
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('query');
      expect(jsonSchema.required).toContain('query');
    });

    it('should have product_get tool with correct schema structure (LLM schema without context)', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const productGetTool = tools.find(t => t.name === 'product_get');

      expect(productGetTool).toBeDefined();
      
      const jsonSchema = z.toJSONSchema(productGetTool!.parameters) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('productId');
      expect(jsonSchema.properties).toHaveProperty('partNo');
      // LLM schemas do NOT include context - context is caller-owned and injected server-side
      expect(jsonSchema.properties).not.toHaveProperty('context');
    });
  });

  describe('OpenAI tool format validation', () => {
    it('should produce parameters without execute field for OpenAI', () => {
      // This test ensures we don't accidentally pass the execute function to OpenAI
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      
      for (const tool of tools) {
        const jsonSchema = z.toJSONSchema(tool.parameters) as Record<string, unknown>;
        
        // The JSON Schema should not contain any function references
        expect(jsonSchema).not.toHaveProperty('execute');
        expect(typeof jsonSchema.type).toBe('string');
      }
    });

    it('should produce clean JSON Schema without $schema property when stripped', () => {
      const jsonSchema = z.toJSONSchema(productSearchSchema) as Record<string, unknown>;
      
      // When we strip $schema for OpenAI, the remaining object should be valid
      const { $schema, ...parameters } = jsonSchema;
      
      expect(parameters.type).toBe('object');
      expect(parameters).toHaveProperty('properties');
      expect(parameters).not.toHaveProperty('$schema');
    });
  });

  describe('productGetSchema validation', () => {
    it('should accept productId as string and return string', () => {
      const result = productGetSchema.safeParse({
        productId: '123',
        context: {},
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('123');
        expect(typeof result.data.productId).toBe('string');
      }
    });

    it('should accept productId as number and coerce to string', () => {
      const result = productGetSchema.safeParse({
        productId: 123,
        context: {},
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('123');
        expect(typeof result.data.productId).toBe('string');
      }
    });

    it('should accept partNo as string', () => {
      const result = productGetSchema.safeParse({
        partNo: 'ABC-123',
        context: {},
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.partNo).toBe('ABC-123');
      }
    });

    it('should reject when both productId and partNo are missing', () => {
      const result = productGetSchema.safeParse({
        context: {},
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Either productId or partNo must be provided');
      }
    });

    it('should accept when only productId is provided', () => {
      const result = productGetSchema.safeParse({
        productId: 456,
        context: {},
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept when only partNo is provided', () => {
      const result = productGetSchema.safeParse({
        partNo: 'XYZ-789',
        context: {},
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept when both productId and partNo are provided', () => {
      const result = productGetSchema.safeParse({
        productId: 123,
        partNo: 'ABC-123',
        context: {},
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.productId).toBe('123');
        expect(result.data.partNo).toBe('ABC-123');
      }
    });
  });

  describe('Cart tool schema registration', () => {
    it('should include all cart tools in createTools output', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('cart_get');
      expect(toolNames).toContain('cart_add_item');
      expect(toolNames).toContain('cart_set_item_quantity');
      expect(toolNames).toContain('cart_remove_item');
    });

    it('should have cart_get tool with valid JSON Schema', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const cartGetTool = tools.find(t => t.name === 'cart_get');

      expect(cartGetTool).toBeDefined();
      
      const jsonSchema = z.toJSONSchema(cartGetTool!.parameters) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });

    it('should have cart_add_item tool with valid JSON Schema', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const cartAddItemTool = tools.find(t => t.name === 'cart_add_item');

      expect(cartAddItemTool).toBeDefined();
      
      const jsonSchema = z.toJSONSchema(cartAddItemTool!.parameters) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('partNo');
      expect(jsonSchema.properties).toHaveProperty('quantity');
    });

    it('should have cart_set_item_quantity tool with valid JSON Schema', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const cartSetItemQuantityTool = tools.find(t => t.name === 'cart_set_item_quantity');

      expect(cartSetItemQuantityTool).toBeDefined();
      
      const jsonSchema = z.toJSONSchema(cartSetItemQuantityTool!.parameters) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('productId');
      expect(jsonSchema.properties).toHaveProperty('quantity');
    });

    it('should have cart_remove_item tool with valid JSON Schema', () => {
      const mockDeps = {
        tokenProvider: { getAccessToken: async () => 'test-token' },
        mcpClient: { callTool: async () => ({ content: [] }) },
      };

      const tools = createTools(mockDeps as any);
      const cartRemoveItemTool = tools.find(t => t.name === 'cart_remove_item');

      expect(cartRemoveItemTool).toBeDefined();
      
      const jsonSchema = z.toJSONSchema(cartRemoveItemTool!.parameters) as {
        type: string;
        properties: Record<string, unknown>;
      };
      
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toHaveProperty('productId');
    });

    it('should convert cartGetSchema to JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartGetSchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });

    it('should convert cartAddItemSchema to JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartAddItemSchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });

    it('should convert cartSetItemQuantitySchema to JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartSetItemQuantitySchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });

    it('should convert cartRemoveItemSchema to JSON Schema with type "object"', () => {
      const jsonSchema = z.toJSONSchema(cartRemoveItemSchema);
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema).toHaveProperty('properties');
    });
  });
});
