import { describe, it, expect } from 'vitest';
import {
  capString,
  capArrayLength,
  capObjectDepth,
  redactKeys,
  dropOrSummarizeContext,
  sanitizeToolArgs,
  sanitizeErrorDetails,
} from '../debug/sanitize.js';
import type { ToolContext } from '../session/sessionTypes.js';

describe('sanitize', () => {
  describe('capString', () => {
    it('should return string unchanged if under limit', () => {
      expect(capString('hello', 10)).toBe('hello');
    });

    it('should truncate string and add ellipsis if over limit', () => {
      expect(capString('hello world', 5)).toBe('hello...');
    });

    it('should use default limit of 500', () => {
      const longString = 'a'.repeat(600);
      const result = capString(longString);
      expect(result.length).toBe(503);
      expect(result.endsWith('...')).toBe(true);
    });
  });

  describe('capArrayLength', () => {
    it('should return array unchanged if under limit', () => {
      const arr = [1, 2, 3];
      expect(capArrayLength(arr, 5)).toEqual([1, 2, 3]);
    });

    it('should truncate array if over limit', () => {
      const arr = [1, 2, 3, 4, 5];
      expect(capArrayLength(arr, 3)).toEqual([1, 2, 3]);
    });

    it('should use default limit of 20', () => {
      const arr = Array.from({ length: 25 }, (_, i) => i);
      const result = capArrayLength(arr);
      expect(result.length).toBe(20);
    });
  });

  describe('capObjectDepth', () => {
    it('should return primitives unchanged', () => {
      expect(capObjectDepth(42)).toBe(42);
      expect(capObjectDepth(true)).toBe(true);
      expect(capObjectDepth(null)).toBe(null);
      expect(capObjectDepth(undefined)).toBe(undefined);
    });

    it('should cap strings', () => {
      const longString = 'a'.repeat(600);
      const result = capObjectDepth(longString) as string;
      expect(result.length).toBe(503);
    });

    it('should replace deep objects with placeholder', () => {
      const deep = { a: { b: { c: { d: 'too deep' } } } };
      const result = capObjectDepth(deep, 3) as Record<string, unknown>;
      expect(result.a).toEqual({ b: { c: '[Object]' } });
    });

    it('should replace deep arrays with placeholder', () => {
      const deep = { a: { b: { c: [1, 2, 3] } } };
      const result = capObjectDepth(deep, 3) as Record<string, unknown>;
      expect((result.a as Record<string, unknown>).b).toEqual({ c: '[Array(3)]' });
    });

    it('should cap array length', () => {
      const arr = Array.from({ length: 25 }, (_, i) => i);
      const result = capObjectDepth(arr) as number[];
      expect(result.length).toBe(20);
    });
  });

  describe('redactKeys', () => {
    it('should redact authorization key', () => {
      const obj = { authorization: 'Bearer token123', data: 'safe' };
      const result = redactKeys(obj);
      expect(result.authorization).toBe('[REDACTED]');
      expect(result.data).toBe('safe');
    });

    it('should redact client_secret key', () => {
      const obj = { client_secret: 'secret123', name: 'test' };
      const result = redactKeys(obj);
      expect(result.client_secret).toBe('[REDACTED]');
      expect(result.name).toBe('test');
    });

    it('should redact access_token key', () => {
      const obj = { access_token: 'token123', type: 'bearer' };
      const result = redactKeys(obj);
      expect(result.access_token).toBe('[REDACTED]');
      expect(result.type).toBe('bearer');
    });

    it('should redact token key', () => {
      const obj = { token: 'abc123', valid: true };
      const result = redactKeys(obj);
      expect(result.token).toBe('[REDACTED]');
      expect(result.valid).toBe(true);
    });

    it('should redact application-id key', () => {
      const obj = { 'application-id': 'app123', version: '1.0' };
      const result = redactKeys(obj);
      expect(result['application-id']).toBe('[REDACTED]');
      expect(result.version).toBe('1.0');
    });

    it('should redact nested sensitive keys', () => {
      const obj = {
        config: {
          api_key: 'key123',
          endpoint: 'https://api.example.com',
        },
      };
      const result = redactKeys(obj);
      expect((result.config as Record<string, unknown>).api_key).toBe('[REDACTED]');
      expect((result.config as Record<string, unknown>).endpoint).toBe('https://api.example.com');
    });

    it('should redact additional custom keys', () => {
      const obj = { customSecret: 'value', normal: 'data' };
      const result = redactKeys(obj, ['customSecret']);
      expect(result.customSecret).toBe('[REDACTED]');
      expect(result.normal).toBe('data');
    });

    it('should not contain authorization in sanitized args', () => {
      const args = {
        query: 'shoes',
        authorization: 'Bearer xyz',
        context: { cultureCode: 'en-US' },
      };
      const result = sanitizeToolArgs(args);
      expect(result.authorization).toBe('[REDACTED]');
    });

    it('should not contain client_secret in sanitized args', () => {
      const args = {
        query: 'shoes',
        client_secret: 'secret123',
      };
      const result = sanitizeToolArgs(args);
      expect(result.client_secret).toBe('[REDACTED]');
    });

    it('should not contain application-id in sanitized args', () => {
      const args = {
        query: 'shoes',
        'application-id': 'app123',
      };
      const result = sanitizeToolArgs(args);
      expect(result['application-id']).toBe('[REDACTED]');
    });
  });

  describe('dropOrSummarizeContext', () => {
    it('should return contextPresent false for undefined context', () => {
      const result = dropOrSummarizeContext(undefined);
      expect(result.contextPresent).toBe(false);
      expect(result.contextSummary).toBeUndefined();
    });

    it('should summarize context with all fields', () => {
      const context: ToolContext = {
        cultureCode: 'en-US',
        currencyCode: 'USD',
        salesAreaId: 1,
        priceListIds: [1, 2, 3],
        customerId: 123,
        companyId: 456,
      };
      const result = dropOrSummarizeContext(context);
      expect(result.contextPresent).toBe(true);
      expect(result.contextSummary).toEqual({
        cultureCode: 'en-US',
        currencyCode: 'USD',
        salesAreaId: 1,
        priceListIdsCount: 3,
        customerIdPresent: true,
        companyIdPresent: true,
      });
    });

    it('should handle partial context', () => {
      const context: ToolContext = {
        cultureCode: 'sv-SE',
      };
      const result = dropOrSummarizeContext(context);
      expect(result.contextPresent).toBe(true);
      expect(result.contextSummary).toEqual({
        cultureCode: 'sv-SE',
      });
    });

    it('should return undefined contextSummary for empty context', () => {
      const context: ToolContext = {};
      const result = dropOrSummarizeContext(context);
      expect(result.contextPresent).toBe(true);
      expect(result.contextSummary).toBeUndefined();
    });
  });

  describe('sanitizeToolArgs', () => {
    it('should replace context with contextPresent flag', () => {
      const args = {
        query: 'shoes',
        context: { cultureCode: 'en-US' },
      };
      const result = sanitizeToolArgs(args);
      expect(result.context).toBeUndefined();
      expect(result.contextPresent).toBe(true);
      expect(result.query).toBe('shoes');
    });

    it('should cap long strings', () => {
      const args = {
        query: 'a'.repeat(600),
      };
      const result = sanitizeToolArgs(args);
      expect((result.query as string).length).toBe(503);
    });

    it('should preserve numbers and booleans', () => {
      const args = {
        pageSize: 10,
        includeDetails: true,
      };
      const result = sanitizeToolArgs(args);
      expect(result.pageSize).toBe(10);
      expect(result.includeDetails).toBe(true);
    });

    it('should cap arrays', () => {
      const args = {
        ids: Array.from({ length: 25 }, (_, i) => i),
      };
      const result = sanitizeToolArgs(args);
      expect((result.ids as number[]).length).toBe(20);
    });

    it('should sanitize nested objects', () => {
      const args = {
        filters: {
          brand: 'Nike',
          token: 'secret',
        },
      };
      const result = sanitizeToolArgs(args);
      expect((result.filters as Record<string, unknown>).brand).toBe('Nike');
      expect((result.filters as Record<string, unknown>).token).toBe('[REDACTED]');
    });
  });

  describe('sanitizeErrorDetails', () => {
    it('should return undefined for undefined input', () => {
      expect(sanitizeErrorDetails(undefined)).toBeUndefined();
    });

    it('should redact sensitive keys in error details', () => {
      const details = {
        message: 'Auth failed',
        token: 'secret123',
      };
      const result = sanitizeErrorDetails(details);
      expect(result?.message).toBe('Auth failed');
      expect(result?.token).toBe('[REDACTED]');
    });

    it('should cap object depth in error details', () => {
      const details = {
        nested: {
          deep: {
            deeper: {
              value: 'too deep',
            },
          },
        },
      };
      const result = sanitizeErrorDetails(details);
      expect(result?.nested).toEqual({ deep: '[Object]' });
    });
  });
});
