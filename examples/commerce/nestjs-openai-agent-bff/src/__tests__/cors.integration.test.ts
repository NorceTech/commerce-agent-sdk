import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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
    cors: {
      origins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    },
  },
}));

import { chatRoutes, ChatRouteOptions } from '../routes/chat.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { AgentRunner } from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient } from '../openai/OpenAiClient.js';
import { config } from '../config.js';

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

describe('CORS integration tests', () => {
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

    // Register CORS with the same configuration as server.ts
    await fastify.register(cors, {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.cors.origins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'), false);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      credentials: false,
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

  describe('OPTIONS preflight for /v1/chat/stream', () => {
    it('should return 204 with CORS headers for allowed origin', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/v1/chat/stream',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
      expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain('content-type');
    });

    it('should return 204 with CORS headers for 127.0.0.1:5173 origin', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/v1/chat/stream',
        headers: {
          'Origin': 'http://127.0.0.1:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    });

    it('should reject preflight for disallowed origin', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/v1/chat/stream',
        headers: {
          'Origin': 'http://evil.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });

      // Fastify CORS plugin returns 500 for rejected origins
      expect(response.statusCode).toBe(500);
    });
  });

  describe('OPTIONS preflight for /v1/chat', () => {
    it('should return 204 with CORS headers for allowed origin', async () => {
      const response = await fastify.inject({
        method: 'OPTIONS',
        url: '/v1/chat',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });
  });

  describe('POST /v1/chat/stream with Origin header', () => {
    it('should include CORS headers in SSE response for allowed origin', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          'Origin': 'http://localhost:5173',
          'Content-Type': 'application/json',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'cors-test-session',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-headers']).toContain('Authorization');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });

    it('should include CORS headers for requests without origin (curl/server-to-server)', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'cors-no-origin-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      // For requests without origin, we allow all
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('POST /v1/chat with Origin header', () => {
    it('should include CORS headers in JSON response for allowed origin', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello!',
        toolCalls: [],
        finishReason: 'stop',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          'Origin': 'http://localhost:5173',
          'Content-Type': 'application/json',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'cors-chat-test',
          message: 'Hello',
          context: { cultureCode: 'sv-SE' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });
  });
});
