import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
    debug: false,
    limits: {
      bodyLimitBytes: 131072,
      maxMessageChars: 4000,
      maxMessageTokensEst: 1200,
    },
  },
}));

import { chatRoutes, ChatRouteOptions } from '../routes/chat.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { AgentRunner } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

function createMockTool(name: string, executeResult: unknown = { success: true }): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: z.object({
      query: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue(executeResult),
  };
}

describe('POST /v1/chat/stream (SSE streaming endpoint)', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockTool = createMockTool('product_search', { items: [], totalCount: 0 });

    agentRunner = new AgentRunner({
      tools: [mockTool],
      openaiClient: mockOpenAiClient,
      maxRounds: 6,
      maxToolCallsPerRound: 3,
    });

    await fastify.register(chatRoutes, {
      sessionStore,
      agentRunner,
    });
  });

  afterEach(async () => {
    sessionStore.destroy();
    await fastify.close();
    vi.clearAllMocks();
  });

  describe('SSE response format', () => {
    it('should return 200 and content-type text/event-stream for valid request', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello! How can I help you today?',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session-123',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('should include at least one "event: final" line in response body', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello! How can I help you today?',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session-123',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: final');
    });

    it('should include status events in response body', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-status-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
    });

    it('should include delta event with assistant text', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Here are some products for you!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-delta-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: delta');
      expect(response.body).toContain('Here are some products for you!');
    });

    it('should include tool_start and tool_end events when tools are called', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'laptops' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some laptops!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-tool-test',
          message: 'Find laptops',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: tool_start');
      expect(response.body).toContain('event: tool_end');
      expect(response.body).toContain('product_search');
    });

    it('should include final event with ChatResponse structure', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-final-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      const finalEventMatch = response.body.match(/event: final\ndata: (.+)\n/);
      expect(finalEventMatch).not.toBeNull();
      
      const finalData = JSON.parse(finalEventMatch![1]);
      expect(finalData.sessionId).toBe('stream-final-test');
      expect(finalData.text).toBe('Hello!');
    });
  });

  describe('error handling', () => {
    it('should return 400 with JSON error for validation failures (before SSE init)', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          sessionId: 'test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(400);
      
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
    });

    it('should emit error event when agent is not configured', async () => {
      const noAgentFastify = Fastify({ logger: false });
      const noAgentSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await noAgentFastify.register(chatRoutes, {
        sessionStore: noAgentSessionStore,
        agentRunner: null,
      });

      const response = await noAgentFastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('event: error');
      expect(response.body).toContain('AI agent is not configured');

      noAgentSessionStore.destroy();
      await noAgentFastify.close();
    });

    it('should terminate with either final or error event', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'termination-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      const hasFinal = response.body.includes('event: final');
      const hasError = response.body.includes('event: error');
      expect(hasFinal || hasError).toBe(true);
    });
  });

  describe('session handling', () => {
    it('should store session data after streaming response', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-session-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const sessionKey = 'demo:stream-session-test';
      const session = await sessionStore.get(sessionKey);

      expect(session).not.toBeNull();
      expect(session!.conversation.length).toBeGreaterThan(0);
    });
  });

  describe('user-friendly status messages', () => {
    it('should emit user-friendly status messages without "Processing round" when debug=0', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'tables' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some tables!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'user-status-test',
          message: 'Find tables',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Should NOT contain "Processing round" text in status events
      expect(response.body).not.toMatch(/Processing round \d/);
      
      // Should contain user-friendly status messages
      expect(response.body).toContain('event: status');
    });

    it('should emit dev_status events with round info when debug=1', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'chairs' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some chairs!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'dev-status-test',
          message: 'Find chairs',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Should contain dev_status events with round info when debug=1
      expect(response.body).toContain('event: dev_status');
      expect(response.body).toMatch(/Processing round \d/);
    });

    it('should NOT emit dev_status events when debug=0', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-dev-status-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Should NOT contain dev_status events when debug=0
      expect(response.body).not.toContain('event: dev_status');
    });

    it('should emit "Starting..." as initial status message', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'starting-status-test',
          message: 'Hello',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Should contain "Starting..." as initial status (localized English)
      expect(response.body).toContain('Starting...');
    });

    it('should emit "Searching the catalog..." status when product_search is called', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'sofas' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some sofas!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'searching-status-test',
          message: 'Find sofas',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Should contain "Searching the catalog..." status (localized English)
      expect(response.body).toContain('Searching the catalog...');
    });

    it('should emit "Found some options." status after product_search completes', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'desks' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some desks!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'found-options-test',
          message: 'Find desks',
          context: { cultureCode: 'en-US' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Should contain "Found some options." status after product_search (localized English)
      expect(response.body).toContain('Found some options.');
    });

    it('should NOT include internal tool names with underscores in status messages when debug=0', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'beds' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some beds!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'no-underscore-test',
          message: 'Find beds',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Extract all status event data
      const statusEvents = response.body.match(/event: status\ndata: (.+)\n/g) || [];
      
      // Status messages should NOT contain internal tool names with underscores
      for (const event of statusEvents) {
        const dataMatch = event.match(/data: (.+)\n/);
        if (dataMatch) {
          const data = JSON.parse(dataMatch[1]);
          expect(data.message).not.toMatch(/product_search|product_get|cart_/);
        }
      }
    });

    it('should include displayName in tool_start and tool_end events', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'lamps' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some lamps!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'displayname-test',
          message: 'Find lamps',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      // Extract tool_start event
      const toolStartMatch = response.body.match(/event: tool_start\ndata: (.+)\n/);
      expect(toolStartMatch).not.toBeNull();
      const toolStartData = JSON.parse(toolStartMatch![1]);
      expect(toolStartData.tool).toBe('product_search');
      expect(toolStartData.displayName).toBeDefined();
      expect(toolStartData.displayName).not.toBe('product_search'); // Should be user-friendly
      
      // Extract tool_end event
      const toolEndMatch = response.body.match(/event: tool_end\ndata: (.+)\n/);
      expect(toolEndMatch).not.toBeNull();
      const toolEndData = JSON.parse(toolEndMatch![1]);
      expect(toolEndData.tool).toBe('product_search');
      expect(toolEndData.displayName).toBeDefined();
      expect(toolEndData.displayName).not.toBe('product_search'); // Should be user-friendly
    });
  });

  describe('debug mode', () => {
    it('should include debug.toolTrace in final event when ?debug=1', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_123',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'laptops' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found laptops!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-debug-test',
          message: 'Find laptops',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      const finalEventMatch = response.body.match(/event: final\ndata: (.+)\n/);
      expect(finalEventMatch).not.toBeNull();
      
      const finalData = JSON.parse(finalEventMatch![1]);
      expect(finalData.debug).toBeDefined();
      expect(finalData.debug.toolTrace).toBeDefined();
      expect(Array.isArray(finalData.debug.toolTrace)).toBe(true);
    });
  });

  describe('thumbnailImageKey streaming parity', () => {
    it('should include thumbnailImageKey in final event cards when present in product_search results', async () => {
      const searchResultWithThumbnails = {
        items: [
          { 
            productId: '4001', 
            name: 'Product With Thumbnail', 
            price: 100, 
            currency: 'SEK',
            thumbnailImageKey: 'stream-thumb-key-xyz',
            onHand: { value: 10, isActive: true }
          },
          { 
            productId: '4002', 
            name: 'Product Without Thumbnail', 
            price: 200, 
            currency: 'SEK',
            onHand: { value: 5, isActive: true }
          },
        ],
        cards: [
          { 
            productId: '4001', 
            title: 'Product With Thumbnail', 
            price: '100', 
            currency: 'SEK',
            thumbnailImageKey: 'stream-thumb-key-xyz'
          },
          { 
            productId: '4002', 
            title: 'Product Without Thumbnail', 
            price: '200', 
            currency: 'SEK'
          },
        ],
        totalCount: 2,
      };

      const mockSearchToolWithThumbnails = {
        name: 'product_search',
        description: 'Mock search tool with thumbnails',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResultWithThumbnails),
      };

      const streamThumbnailAgentRunner = new AgentRunner({
        tools: [mockSearchToolWithThumbnails],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const streamThumbnailFastify = Fastify({ logger: false });
      const streamThumbnailSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await streamThumbnailFastify.register(chatRoutes, {
        sessionStore: streamThumbnailSessionStore,
        agentRunner: streamThumbnailAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_stream_thumb_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found some products!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await streamThumbnailFastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-thumbnail-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      
      const finalEventMatch = response.body.match(/event: final\ndata: (.+)\n/);
      expect(finalEventMatch).not.toBeNull();
      
      const finalData = JSON.parse(finalEventMatch![1]);
      expect(finalData.cards).toBeDefined();
      expect(finalData.cards.length).toBe(2);
      
      // First card should have thumbnailImageKey
      expect(finalData.cards[0].thumbnailImageKey).toBe('stream-thumb-key-xyz');
      
      // Second card should not have thumbnailImageKey (undefined)
      expect(finalData.cards[1].thumbnailImageKey).toBeUndefined();

      streamThumbnailSessionStore.destroy();
      await streamThumbnailFastify.close();
    });

    it('should include thumbnailsPresentCount in final event debug.toolTrace when debug=1', async () => {
      const searchResultWithThumbnails = {
        items: [
          { 
            productId: '5001', 
            name: 'Product A', 
            thumbnailImageKey: 'thumb-stream-a',
            onHand: { value: 10, isActive: true }
          },
          { 
            productId: '5002', 
            name: 'Product B', 
            onHand: { value: 5, isActive: true }
          },
        ],
        totalCount: 2,
      };

      const mockSearchToolWithThumbnails = {
        name: 'product_search',
        description: 'Mock search tool with thumbnails',
        parameters: z.object({
          query: z.string().optional(),
          context: z.object({}).passthrough().optional(),
        }),
        execute: vi.fn().mockResolvedValue(searchResultWithThumbnails),
      };

      const streamDebugAgentRunner = new AgentRunner({
        tools: [mockSearchToolWithThumbnails],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const streamDebugFastify = Fastify({ logger: false });
      const streamDebugSessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });

      await streamDebugFastify.register(chatRoutes, {
        sessionStore: streamDebugSessionStore,
        agentRunner: streamDebugAgentRunner,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_stream_debug_1',
              name: 'product_search',
              arguments: JSON.stringify({ query: 'products' }),
            },
          ],
          finishReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          content: 'Found products!',
          toolCalls: [],
          finishReason: 'stop',
        });

      const response = await streamDebugFastify.inject({
        method: 'POST',
        url: '/v1/chat/stream?debug=1',
        payload: {
          applicationId: 'demo',
          sessionId: 'stream-debug-thumbnail-test',
          message: 'Find products',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      
      const finalEventMatch = response.body.match(/event: final\ndata: (.+)\n/);
      expect(finalEventMatch).not.toBeNull();
      
      const finalData = JSON.parse(finalEventMatch![1]);
      expect(finalData.debug).toBeDefined();
      expect(finalData.debug.toolTrace).toBeDefined();
      
      // Find the product_search trace entry
      const searchTrace = finalData.debug.toolTrace.find(
        (entry: { tool: string }) => entry.tool === 'product_search'
      );
      expect(searchTrace).toBeDefined();
      expect(searchTrace.thumbnailsPresentCount).toBe(1);

      streamDebugSessionStore.destroy();
      await streamDebugFastify.close();
    });
  });
});
