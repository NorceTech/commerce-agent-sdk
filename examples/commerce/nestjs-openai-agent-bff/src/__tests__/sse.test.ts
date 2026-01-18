import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    cors: {
      origins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    },
  },
}));

import { formatSseEvent } from '../http/sse.js';
import type {
  StatusEventData,
  ToolStartEventData,
  ToolEndEventData,
  DeltaEventData,
  ErrorEventData,
} from '../http/sse.js';

describe('SSE formatSseEvent', () => {
  it('should format status event correctly', () => {
    const data: StatusEventData = { message: 'Processing...' };
    const result = formatSseEvent('status', data);
    
    expect(result).toBe('event: status\ndata: {"message":"Processing..."}\n\n');
  });

  it('should format tool_start event correctly with displayName', () => {
    const data: ToolStartEventData = {
      tool: 'product_search',
      displayName: 'Searching products',
      args: { query: 'laptops', pageSize: 10 },
    };
    const result = formatSseEvent('tool_start', data);
    
    expect(result).toBe('event: tool_start\ndata: {"tool":"product_search","displayName":"Searching products","args":{"query":"laptops","pageSize":10}}\n\n');
  });

  it('should format tool_end event with success correctly with displayName', () => {
    const data: ToolEndEventData = {
      tool: 'product_search',
      displayName: 'Searching products',
      ok: true,
      resultSummary: { itemCount: 5, totalCount: 100 },
    };
    const result = formatSseEvent('tool_end', data);
    
    expect(result).toBe('event: tool_end\ndata: {"tool":"product_search","displayName":"Searching products","ok":true,"resultSummary":{"itemCount":5,"totalCount":100}}\n\n');
  });

  it('should format tool_end event with error correctly with displayName', () => {
    const data: ToolEndEventData = {
      tool: 'product_get',
      displayName: 'Fetching product details',
      ok: false,
      error: 'Product not found',
    };
    const result = formatSseEvent('tool_end', data);
    
    expect(result).toBe('event: tool_end\ndata: {"tool":"product_get","displayName":"Fetching product details","ok":false,"error":"Product not found"}\n\n');
  });

  it('should format delta event correctly', () => {
    const data: DeltaEventData = { text: 'Here are some products...' };
    const result = formatSseEvent('delta', data);
    
    expect(result).toBe('event: delta\ndata: {"text":"Here are some products..."}\n\n');
  });

  it('should format final event correctly', () => {
    const data = {
      sessionId: 'test-session',
      text: 'I found 3 products for you.',
      cards: [
        { productId: '123', title: 'Product A' },
        { productId: '456', title: 'Product B' },
      ],
    };
    const result = formatSseEvent('final', data);
    
    expect(result).toContain('event: final\n');
    expect(result).toContain('data: ');
    expect(result.endsWith('\n\n')).toBe(true);
    
    const dataLine = result.split('\n')[1];
    const jsonData = JSON.parse(dataLine.replace('data: ', ''));
    expect(jsonData.sessionId).toBe('test-session');
    expect(jsonData.text).toBe('I found 3 products for you.');
    expect(jsonData.cards).toHaveLength(2);
  });

  it('should format error event correctly', () => {
    const data: ErrorEventData = {
      category: 'validation',
      code: 'VALIDATION_REQUEST_INVALID',
      message: 'Invalid request body',
      retryable: false,
      details: { field: 'applicationId' },
    };
    const result = formatSseEvent('error', data);
    
    expect(result).toContain('event: error\n');
    expect(result).toContain('data: ');
    expect(result.endsWith('\n\n')).toBe(true);
    
    const dataLine = result.split('\n')[1];
    const jsonData = JSON.parse(dataLine.replace('data: ', ''));
    expect(jsonData.category).toBe('validation');
    expect(jsonData.code).toBe('VALIDATION_REQUEST_INVALID');
    expect(jsonData.message).toBe('Invalid request body');
    expect(jsonData.retryable).toBe(false);
    expect(jsonData.details).toEqual({ field: 'applicationId' });
  });

  it('should handle special characters in data', () => {
    const data: StatusEventData = { message: 'Processing "special" chars & <tags>' };
    const result = formatSseEvent('status', data);
    
    expect(result).toBe('event: status\ndata: {"message":"Processing \\"special\\" chars & <tags>"}\n\n');
  });

  it('should handle empty objects in args with displayName', () => {
    const data: ToolStartEventData = {
      tool: 'product_get',
      displayName: 'Fetching product details',
      args: {},
    };
    const result = formatSseEvent('tool_start', data);
    
    expect(result).toBe('event: tool_start\ndata: {"tool":"product_get","displayName":"Fetching product details","args":{}}\n\n');
  });

  it('should handle null values in data with displayName', () => {
    const data: ToolEndEventData = {
      tool: 'product_search',
      displayName: 'Searching products',
      ok: true,
      resultSummary: null,
    };
    const result = formatSseEvent('tool_end', data);
    
    expect(result).toBe('event: tool_end\ndata: {"tool":"product_search","displayName":"Searching products","ok":true,"resultSummary":null}\n\n');
  });

  it('should follow SSE wire format: event: X\\ndata: JSON\\n\\n', () => {
    const data: StatusEventData = { message: 'test' };
    const result = formatSseEvent('status', data);
    
    const lines = result.split('\n');
    expect(lines[0]).toMatch(/^event: \w+$/);
    expect(lines[1]).toMatch(/^data: .+$/);
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('');
  });
});
