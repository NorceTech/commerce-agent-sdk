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

import { chatRoutes } from '../routes/chat.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { AgentRunner } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';
import type { SessionState, ToolContext } from '../session/sessionTypes.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

function createMockCartAddTool(): Tool & { execute: ReturnType<typeof vi.fn> } {
  return {
    name: 'cart_add_item',
    description: 'Add an item to the cart',
    parameters: z.object({
      partNo: z.string(),
      quantity: z.number().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ success: true, cartId: 'cart-123' }),
  };
}

function createMockCartGetTool(): Tool {
  return {
    name: 'cart_get',
    description: 'Get the current cart',
    parameters: z.object({
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
}

describe('Client IP Propagation', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;
  let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
  let mockCartAddTool: Tool & { execute: ReturnType<typeof vi.fn> };
  let mockCartGetTool: Tool;
  let agentRunner: AgentRunner;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    mockOpenAiClient = createMockOpenAiClient();
    mockCartAddTool = createMockCartAddTool();
    mockCartGetTool = createMockCartGetTool();

    agentRunner = new AgentRunner({
      tools: [mockCartAddTool, mockCartGetTool],
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

  describe('/v1/chat endpoint', () => {
    it('should extract clientIp from X-Forwarded-For header and pass to context', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // First call: model requests cart_add_item
      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_with_ip',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-123', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '192.168.1.100, 10.0.0.1, 172.16.0.1',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-test-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Verify the session context includes clientIp (first IP from X-Forwarded-For)
      const session = await sessionStore.get('demo:clientip-test-1') as SessionState;
      expect(session).toBeDefined();
      // The context should have been passed with clientIp
      expect(session.context?.clientIp).toBe('192.168.1.100');
    });

    it('should use first IP from X-Forwarded-For list (proxy chain)', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_proxy',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-456', quantity: 2 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '1.1.1.1, 2.2.2.2',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-test-2',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:clientip-test-2') as SessionState;
      expect(session?.context?.clientIp).toBe('1.1.1.1');
    });

    it('should use X-Real-IP when X-Forwarded-For is not present', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_real_ip',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-789', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-real-ip': '203.0.113.50',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-test-3',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:clientip-test-3') as SessionState;
      expect(session?.context?.clientIp).toBe('203.0.113.50');
    });

    it('should normalize IPv6-mapped IPv4 addresses', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_ipv6',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-IPV6', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '::ffff:127.0.0.1',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-test-4',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:clientip-test-4') as SessionState;
      // IPv6-mapped IPv4 should be normalized to plain IPv4
      expect(session?.context?.clientIp).toBe('127.0.0.1');
    });
  });

  describe('/v1/chat/stream endpoint', () => {
    it('should extract clientIp from X-Forwarded-For header in streaming endpoint', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_stream_ip',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-STREAM', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          'x-forwarded-for': '10.20.30.40, 50.60.70.80',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-stream-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:clientip-stream-1') as SessionState;
      expect(session?.context?.clientIp).toBe('10.20.30.40');
    });

    it('should handle streaming endpoint with X-Real-IP header', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_stream_real_ip',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-STREAM-2', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          'x-real-ip': '198.51.100.178',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-stream-2',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      const session = await sessionStore.get('demo:clientip-stream-2') as SessionState;
      expect(session?.context?.clientIp).toBe('198.51.100.178');
    });
  });

  describe('cart_add_item tool receives clientIp', () => {
    it('should pass clientIp to cart_add_item tool execution context', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // First call: model requests cart_add_item, creates pending action
      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_verify_ip',
            name: 'cart_add_item',
            arguments: JSON.stringify({ partNo: 'PART-VERIFY', quantity: 1 }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '8.8.8.8',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-verify-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Confirm the pending action
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '8.8.8.8',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-verify-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Verify the tool was called with clientIp in the context
      expect(mockCartAddTool.execute).toHaveBeenCalled();
      const executeCall = mockCartAddTool.execute.mock.calls[0];
      // The execute function receives (args, mcpState, httpContext, applicationId)
      // httpContext should contain clientIp
      const httpContext = executeCall[2] as ToolContext | undefined;
      expect(httpContext?.clientIp).toBe('8.8.8.8');
    });

    it('should NOT allow model to spoof clientIp via tool arguments', async () => {
      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Model tries to provide clientIp in tool arguments (should be ignored)
      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_add_spoof',
            name: 'cart_add_item',
            arguments: JSON.stringify({ 
              partNo: 'PART-SPOOF', 
              quantity: 1,
              clientIp: '1.2.3.4', // Model trying to spoof IP
            }),
          },
        ],
        finishReason: 'tool_calls',
      });

      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '9.9.9.9', // Real client IP
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-spoof-1',
          message: 'add product to cart',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Confirm the pending action
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'x-forwarded-for': '9.9.9.9',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'clientip-spoof-1',
          message: 'yes',
          context: { cultureCode: 'sv-SE' },
        },
      });

      // Verify the tool was called with the REAL clientIp from headers, not the spoofed one
      expect(mockCartAddTool.execute).toHaveBeenCalled();
      const executeCall = mockCartAddTool.execute.mock.calls[0];
      const httpContext = executeCall[2] as ToolContext | undefined;
      // Should use the real IP from X-Forwarded-For, not the model-provided one
      expect(httpContext?.clientIp).toBe('9.9.9.9');
    });
  });
});
