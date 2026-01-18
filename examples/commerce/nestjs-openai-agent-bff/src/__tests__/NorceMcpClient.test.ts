import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';

vi.mock('../config.js', () => ({
  config: {
    port: 3000,
    openai: {
      apiKey: 'test-api-key',
      model: 'gpt-4o-mini',
    },
    norce: {
      mcp: {
        baseUrl: 'https://test.api.norce.tech/mcp/commerce',
        defaultApplicationId: 'test-app-id',
        allowedApplicationIds: [],
      },
      oauth: {
        tokenUrl: 'https://test.auth.norce.tech/token',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
      },
    },
    session: {
      ttlSeconds: 1800,
    },
    agent: {
      maxRounds: 6,
      maxToolCallsPerRound: 3,
    },
    timeouts: {
      oauthMs: 5000,
      mcpCallMs: 10000,
      openaiMs: 20000,
    },
    retry: {
      maxAttempts: 2,
      baseDelayMs: 500,
      jitterMs: 200,
    },
    debug: false,
    limits: {
      bodyLimitBytes: 131072,
      maxMessageChars: 4000,
      maxMessageTokensEst: 1200,
    },
  },
}));

import { NorceMcpClient } from '../norce/NorceMcpClient.js';
import type { McpState } from '../session/sessionTypes.js';

const TEST_BASE_URL = 'https://test.norce.tech/mcp/commerce';
const TEST_APPLICATION_ID = 'test-app-id';
const TEST_ACCESS_TOKEN = 'test-access-token';

function createMcpClient(): NorceMcpClient {
  return new NorceMcpClient({
    baseUrl: TEST_BASE_URL,
  });
}

function createMcpState(): McpState {
  return {
    sessionId: undefined,
    nextRpcId: 1,
  };
}

describe('NorceMcpClient', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
    mockAgent.close();
  });

  describe('callTool triggers initialize+initialized first time and stores mcp-session-id', () => {
    it('should send initialize and notifications/initialized on first callTool and store session ID', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      const requests: Array<{ method: string; id?: number }> = [];
      const testSessionId = 'test-mcp-session-123';

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply((opts) => {
          const body = JSON.parse(opts.body as string);
          requests.push({ method: body.method, id: body.id });

          if (body.method === 'initialize') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: {},
                  serverInfo: { name: 'norce-mcp', version: '1.0.0' },
                },
              }),
              responseOptions: {
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': testSessionId,
                },
              },
            };
          }

          if (body.method === 'notifications/initialized') {
            return {
              statusCode: 200,
              data: JSON.stringify({ jsonrpc: '2.0' }),
              responseOptions: {
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': testSessionId,
                },
              },
            };
          }

          if (body.method === 'tools/call') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { products: [{ id: '1', name: 'Test Product' }] },
              }),
              responseOptions: {
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': testSessionId,
                },
              },
            };
          }

          return { statusCode: 400, data: 'Unknown method' };
        })
        .persist();

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(requests).toHaveLength(3);
      expect(requests[0].method).toBe('initialize');
      expect(requests[0].id).toBe(1);
      expect(requests[1].method).toBe('notifications/initialized');
      expect(requests[1].id).toBeUndefined();
      expect(requests[2].method).toBe('tools/call');
      expect(requests[2].id).toBe(2);

      expect(state.sessionId).toBe(testSessionId);
      expect(state.nextRpcId).toBe(3);

      expect(result).toEqual({ products: [{ id: '1', name: 'Test Product' }] });
    });
  });

  describe('second callTool does not re-initialize and sends mcp-session-id header', () => {
    it('should skip initialization on second call and include mcp-session-id header', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      const requests: Array<{ method: string; headers: Record<string, string> }> = [];
      const testSessionId = 'test-mcp-session-456';

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply((opts) => {
          const body = JSON.parse(opts.body as string);
          const headers: Record<string, string> = {};
          if (opts.headers) {
            const headerObj = opts.headers as Record<string, string>;
            if (headerObj['mcp-session-id']) {
              headers['mcp-session-id'] = headerObj['mcp-session-id'];
            }
          }
          requests.push({ method: body.method, headers });

          if (body.method === 'initialize') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { protocolVersion: '2024-11-05', capabilities: {} },
              }),
              responseOptions: {
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': testSessionId,
                },
              },
            };
          }

          if (body.method === 'notifications/initialized') {
            return {
              statusCode: 200,
              data: JSON.stringify({ jsonrpc: '2.0' }),
              responseOptions: {
                headers: { 'Content-Type': 'application/json' },
              },
            };
          }

          if (body.method === 'tools/call') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { data: 'result' },
              }),
              responseOptions: {
                headers: { 'Content-Type': 'application/json' },
              },
            };
          }

          return { statusCode: 400, data: 'Unknown method' };
        })
        .persist();

      await client.callTool(state, 'product.search', { query: 'first' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(state.sessionId).toBe(testSessionId);
      const firstCallRequestCount = requests.length;
      expect(firstCallRequestCount).toBe(3);

      requests.length = 0;

      await client.callTool(state, 'product.get', { id: '123' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('tools/call');
      expect(requests[0].headers['mcp-session-id']).toBe(testSessionId);
    });
  });

  describe('includes authorization + application-id headers in tool calls', () => {
    it('should include Authorization and application-id headers in all requests', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      const capturedHeaders: Array<{
        authorization?: string;
        applicationId?: string;
        method: string;
      }> = [];

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply((opts) => {
          const body = JSON.parse(opts.body as string);
          const headerObj = opts.headers as Record<string, string>;

          capturedHeaders.push({
            authorization: headerObj['Authorization'],
            applicationId: headerObj['application-id'],
            method: body.method,
          });

          if (body.method === 'initialize') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { protocolVersion: '2024-11-05', capabilities: {} },
              }),
              responseOptions: {
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': 'session-789',
                },
              },
            };
          }

          if (body.method === 'notifications/initialized') {
            return {
              statusCode: 200,
              data: JSON.stringify({ jsonrpc: '2.0' }),
              responseOptions: {
                headers: { 'Content-Type': 'application/json' },
              },
            };
          }

          if (body.method === 'tools/call') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { success: true },
              }),
              responseOptions: {
                headers: { 'Content-Type': 'application/json' },
              },
            };
          }

          return { statusCode: 400, data: 'Unknown method' };
        })
        .persist();

      await client.callTool(state, 'product.search', { query: 'test' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(capturedHeaders).toHaveLength(3);

      for (const captured of capturedHeaders) {
        expect(captured.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
        expect(captured.applicationId).toBe(TEST_APPLICATION_ID);
      }

      expect(capturedHeaders[0].method).toBe('initialize');
      expect(capturedHeaders[1].method).toBe('notifications/initialized');
      expect(capturedHeaders[2].method).toBe('tools/call');
    });
  });

  describe('error handling', () => {
    it('should throw error when initialize fails', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        }, {
          headers: { 'Content-Type': 'application/json' },
        });

      await expect(
        client.callTool(state, 'product.search', { query: 'test' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID)
      ).rejects.toThrow(/MCP initialize failed: Invalid Request/);
    });

    it('should throw error when HTTP request fails with status, content-type, and body snippet', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(500, 'Internal Server Error', {
          headers: { 'Content-Type': 'text/plain' },
        });

      await expect(
        client.callTool(state, 'product.search', { query: 'test' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID)
      ).rejects.toThrow(/status=500.*content-type=text\/plain.*body=Internal Server Error/);
    });

    it('should throw error when tool call returns error', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        }, {
          headers: { 'Content-Type': 'application/json' },
        });

      await expect(
        client.callTool(state, 'unknown.tool', {}, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID)
      ).rejects.toThrow(/MCP tool call failed: Method not found/);
    });
  });

  describe('nextRpcId incrementing', () => {
    it('should increment nextRpcId for each JSON-RPC request with id', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const capturedIds: number[] = [];

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply((opts) => {
          const body = JSON.parse(opts.body as string);
          if (body.id !== undefined) {
            capturedIds.push(body.id);
          }
          return {
            statusCode: 200,
            data: JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {},
            }),
            responseOptions: {
              headers: { 'Content-Type': 'application/json' },
            },
          };
        })
        .persist();

      expect(state.nextRpcId).toBe(1);

      await client.callTool(state, 'product.search', { query: 'a' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);
      expect(capturedIds).toContain(1);
      expect(state.nextRpcId).toBe(2);

      await client.callTool(state, 'product.search', { query: 'b' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);
      expect(capturedIds).toContain(2);
      expect(state.nextRpcId).toBe(3);

      await client.callTool(state, 'product.search', { query: 'c' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);
      expect(capturedIds).toContain(3);
      expect(state.nextRpcId).toBe(4);
    });
  });

  describe('response content-type handling', () => {
    it('should parse JSON response when content-type is application/json', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { products: [{ id: '1', name: 'Test Product' }] },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ products: [{ id: '1', name: 'Test Product' }] });
    });

    it('should parse JSON response when content-type includes charset', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { data: 'charset test' },
        }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ data: 'charset test' });
    });

    it('should parse SSE response when content-type is text/event-stream', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const sseBody = 'data: {"jsonrpc":"2.0","id":1,"result":{"items":[{"id":"1"}]}}\n\n';

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, sseBody, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ items: [{ id: '1' }] });
    });

    it('should parse SSE response with multiple data events and find matching id', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const sseBody = [
        'data: {"jsonrpc":"2.0","id":99,"result":{"wrong":"response"}}',
        '',
        'data: {"jsonrpc":"2.0","id":1,"result":{"correct":"response"}}',
        '',
        'data: {"jsonrpc":"2.0","id":100,"result":{"also":"wrong"}}',
        '',
      ].join('\n');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, sseBody, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ correct: 'response' });
    });

    it('should return last parsed object when no matching id in SSE', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const sseBody = [
        'data: {"jsonrpc":"2.0","id":99,"result":{"first":"response"}}',
        '',
        'data: {"jsonrpc":"2.0","id":100,"result":{"last":"response"}}',
        '',
      ].join('\n');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, sseBody, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      // Should return last response since id=1 doesn't match 99 or 100
      expect(result).toEqual({ last: 'response' });
    });

    it('should skip SSE comments and empty lines', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const sseBody = [
        ': this is a comment',
        '',
        'data: {"jsonrpc":"2.0","id":1,"result":{"success":true}}',
        '',
        ': another comment',
        '',
      ].join('\n');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, sseBody, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ success: true });
    });

    it('should skip [DONE] marker in SSE stream', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const sseBody = [
        'data: {"jsonrpc":"2.0","id":1,"result":{"data":"value"}}',
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, sseBody, {
          headers: { 'Content-Type': 'text/event-stream' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ data: 'value' });
    });

    it('should include status, content-type, and body snippet in non-OK error', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const errorBody = JSON.stringify({ error: 'Unauthorized', message: 'Invalid token' });

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(401, errorBody, {
          headers: { 'Content-Type': 'application/json' },
        });

      await expect(
        client.callTool(state, 'product.search', { query: 'test' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID)
      ).rejects.toThrow(/status=401.*content-type=application\/json.*Invalid token/);
    });

    it('should truncate long error body to 2000 chars', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const longBody = 'x'.repeat(3000);

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(500, longBody, {
          headers: { 'Content-Type': 'text/plain' },
        });

      try {
        await client.callTool(state, 'product.search', { query: 'test' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        // Body should be truncated to 2000 chars
        expect(message.length).toBeLessThan(2100);
        expect(message).toContain('status=500');
      }
    });
  });

  describe('HTTP 202 handling for notifications', () => {
    it('should handle 202 empty response for notifications/initialized without error', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      // First request: initialize (200 with JSON response)
      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'test-server', version: '1.0.0' },
          },
        }), {
          headers: { 
            'Content-Type': 'application/json',
            'mcp-session-id': 'test-session-123',
          },
        });

      // Second request: notifications/initialized (202 empty body)
      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(202, '', {
          headers: { 'mcp-session-id': 'test-session-123' },
        });

      // Third request: tools/call (200 with JSON response)
      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { products: [] },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });

      // This should not throw - 202 for notification is expected
      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ products: [] });
      expect(state.sessionId).toBe('test-session-123');
    });

    it('should parse tools/call with id as 200 JSON response', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { 
            content: [{ type: 'text', text: 'Product found' }],
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });

      const result = await client.callTool(
        state,
        'product.search',
        { query: 'test' },
        TEST_ACCESS_TOKEN,
        TEST_APPLICATION_ID
      );

      expect(result).toEqual({ 
        content: [{ type: 'text', text: 'Product found' }],
      });
    });

    it('should include method, id, and toolName in parse error messages', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      // Return invalid JSON that will fail to parse
      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, 'not valid json', {
          headers: { 'Content-Type': 'application/json' },
        });

      await expect(
        client.callTool(state, 'product.search', { query: 'test' }, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID)
      ).rejects.toThrow(/method=tools\/call.*id=1.*toolName=product\.search/);
    });
  });

  describe('listTools', () => {
    it('should send tools/list request with correct method and id', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const capturedRequests: Array<{ method: string; id?: number }> = [];

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply((opts) => {
          const body = JSON.parse(opts.body as string);
          capturedRequests.push({ method: body.method, id: body.id });

          return {
            statusCode: 200,
            data: JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                tools: [
                  { name: 'product.search', description: 'Search products' },
                  { name: 'product.get', description: 'Get product details' },
                ],
              },
            }),
            responseOptions: {
              headers: { 'Content-Type': 'application/json' },
            },
          };
        });

      await client.listTools(state, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].method).toBe('tools/list');
      expect(capturedRequests[0].id).toBe(1);
    });

    it('should return tools list from response', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      const expectedTools = [
        { name: 'product.search', description: 'Search products', inputSchema: { type: 'object' } },
        { name: 'product.get', description: 'Get product details' },
        { name: 'cart.get', description: 'Get cart contents' },
      ];

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { tools: expectedTools },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });

      const result = await client.listTools(state, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(result.tools).toEqual(expectedTools);
    });

    it('should initialize session before calling tools/list if not initialized', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      const mockPool = mockAgent.get('https://test.norce.tech');

      const capturedMethods: string[] = [];
      const testSessionId = 'test-session-for-list';

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply((opts) => {
          const body = JSON.parse(opts.body as string);
          capturedMethods.push(body.method);

          if (body.method === 'initialize') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { protocolVersion: '2024-11-05', capabilities: {} },
              }),
              responseOptions: {
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': testSessionId,
                },
              },
            };
          }

          if (body.method === 'notifications/initialized') {
            return {
              statusCode: 200,
              data: JSON.stringify({ jsonrpc: '2.0' }),
              responseOptions: {
                headers: { 'Content-Type': 'application/json' },
              },
            };
          }

          if (body.method === 'tools/list') {
            return {
              statusCode: 200,
              data: JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { tools: [] },
              }),
              responseOptions: {
                headers: { 'Content-Type': 'application/json' },
              },
            };
          }

          return { statusCode: 400, data: 'Unknown method' };
        })
        .persist();

      await client.listTools(state, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(capturedMethods).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
      expect(state.sessionId).toBe(testSessionId);
    });

    it('should throw error when tools/list returns error', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });

      await expect(
        client.listTools(state, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID)
      ).rejects.toThrow(/MCP tools\/list failed: Method not found/);
    });

    it('should increment nextRpcId after tools/list call', async () => {
      const client = createMcpClient();
      const state = createMcpState();
      state.sessionId = 'existing-session';
      const mockPool = mockAgent.get('https://test.norce.tech');

      mockPool
        .intercept({
          path: '/mcp/commerce',
          method: 'POST',
        })
        .reply(200, JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [] },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
        .persist();

      expect(state.nextRpcId).toBe(1);

      await client.listTools(state, TEST_ACCESS_TOKEN, TEST_APPLICATION_ID);

      expect(state.nextRpcId).toBe(2);
    });
  });
});
