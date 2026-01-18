import { describe, it, expect } from 'vitest';
import { buildMcpArgs, injectContext } from '../agent/context/index.js';
import type { ToolContext } from '../session/sessionTypes.js';

describe('injectContext', () => {
  describe('buildMcpArgs', () => {
    it('should inject context from toolContext when provided', () => {
      const args = { query: 'test' };
      const toolContext: ToolContext = { cultureCode: 'sv-SE', currencyCode: 'SEK' };

      const result = buildMcpArgs(args, toolContext);

      expect(result.mcpArgs.context).toEqual(toolContext);
      expect(result.effectiveContext).toEqual(toolContext);
      expect(result.modelContextIgnored).toBe(false);
    });

    it('should omit context when toolContext is undefined', () => {
      const args = { query: 'test' };

      const result = buildMcpArgs(args, undefined);

      expect(result.mcpArgs).not.toHaveProperty('context');
      expect(result.effectiveContext).toBeUndefined();
      expect(result.modelContextIgnored).toBe(false);
    });

    it('should strip context from args and use toolContext instead (defense in depth)', () => {
      const modelContext = { cultureCode: 'en-US', currencyCode: 'USD' };
      const args = { query: 'test', context: modelContext };
      const toolContext: ToolContext = { cultureCode: 'sv-SE', currencyCode: 'SEK' };

      const result = buildMcpArgs(args, toolContext);

      // Should use toolContext, not model-provided context
      expect(result.mcpArgs.context).toEqual(toolContext);
      expect(result.effectiveContext).toEqual(toolContext);
      // Should flag that model context was ignored
      expect(result.modelContextIgnored).toBe(true);
      expect(result.modelProvidedContextPreview).toEqual({
        cultureCode: 'en-US',
        currencyCode: 'USD',
      });
    });

    it('should strip context from args when toolContext is undefined (no guessing)', () => {
      const modelContext = { cultureCode: 'en-US', currencyCode: 'USD' };
      const args = { query: 'test', context: modelContext };

      const result = buildMcpArgs(args, undefined);

      // Should NOT use model-provided context, should omit entirely
      expect(result.mcpArgs).not.toHaveProperty('context');
      expect(result.effectiveContext).toBeUndefined();
      // Should flag that model context was ignored
      expect(result.modelContextIgnored).toBe(true);
      expect(result.modelProvidedContextPreview).toEqual({
        cultureCode: 'en-US',
        currencyCode: 'USD',
      });
    });

    it('should preserve other args while stripping context', () => {
      const args = {
        query: 'laptop',
        filters: { category: 'electronics' },
        pageSize: 10,
        context: { cultureCode: 'en-US' },
      };
      const toolContext: ToolContext = { cultureCode: 'sv-SE' };

      const result = buildMcpArgs(args, toolContext);

      expect(result.mcpArgs.query).toBe('laptop');
      expect(result.mcpArgs.filters).toEqual({ category: 'electronics' });
      expect(result.mcpArgs.pageSize).toBe(10);
      expect(result.mcpArgs.context).toEqual(toolContext);
    });

    it('should handle args with no context field', () => {
      const args = { query: 'test', pageSize: 5 };
      const toolContext: ToolContext = { cultureCode: 'sv-SE' };

      const result = buildMcpArgs(args, toolContext);

      expect(result.mcpArgs.context).toEqual(toolContext);
      expect(result.modelContextIgnored).toBe(false);
      expect(result.modelProvidedContextPreview).toBeUndefined();
    });

    it('should handle empty toolContext object', () => {
      const args = { query: 'test' };
      const toolContext: ToolContext = {};

      const result = buildMcpArgs(args, toolContext);

      expect(result.mcpArgs.context).toEqual({});
      expect(result.effectiveContext).toEqual({});
    });

    it('should only extract safe fields for modelProvidedContextPreview', () => {
      const modelContext = {
        cultureCode: 'en-US',
        currencyCode: 'USD',
        priceListIds: [1, 2, 3],
        customerId: 12345,
        companyId: 67890,
        salesAreaId: 100,
        sensitiveField: 'should-not-appear',
      };
      const args = { query: 'test', context: modelContext };
      const toolContext: ToolContext = { cultureCode: 'sv-SE' };

      const result = buildMcpArgs(args, toolContext);

      // Should only include safe preview fields
      expect(result.modelProvidedContextPreview).toEqual({
        cultureCode: 'en-US',
        currencyCode: 'USD',
      });
    });
  });

  describe('injectContext', () => {
    it('should return mcpArgs with context injected', () => {
      const args = { query: 'test' };
      const toolContext: ToolContext = { cultureCode: 'sv-SE' };

      const result = injectContext(args, toolContext);

      expect(result.query).toBe('test');
      expect(result.context).toEqual(toolContext);
    });

    it('should strip model-provided context and use toolContext', () => {
      const args = { query: 'test', context: { cultureCode: 'en-US' } };
      const toolContext: ToolContext = { cultureCode: 'sv-SE' };

      const result = injectContext(args, toolContext);

      expect(result.context).toEqual(toolContext);
    });

    it('should omit context when toolContext is undefined', () => {
      const args = { query: 'test' };

      const result = injectContext(args, undefined);

      expect(result).not.toHaveProperty('context');
    });
  });
});
