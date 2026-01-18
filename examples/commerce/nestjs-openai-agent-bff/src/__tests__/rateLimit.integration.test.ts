import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

vi.mock('../config/simpleAuthConfig.js', () => ({
  simpleAuthConfig: {
    enabled: true,
    jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
    ttlSeconds: 600,
    issuer: 'norce-agent-bff',
    audience: 'norce-agent-widget',
  },
}));

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
        allowedApplicationIds: ['demo', 'test-app'],
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
    debugRuns: {
      enabled: false,
      maxRuns: 200,
      ttlSeconds: 86400,
    },
  },
}));

vi.mock('../config/rateLimitConfig.js', () => ({
  rateLimitConfig: {
    chatPerMin: 3,
    tokenPerMin: 2,
    burst: 5,
    maxKeys: 5000,
    pruneIntervalMs: 60000,
    windowMs: 60000,
  },
}));

import { chatRoutes } from '../routes/chat.js';
import { simpleTokenRoutes } from '../routes/simpleTokenRoute.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { signJwt, JwtPayload } from '../config/jwt.js';
import { resetRateLimiters } from '../policy/index.js';

function createValidToken(applicationId: string, sid?: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: 'norce-agent-bff',
    aud: 'norce-agent-widget',
    sid: sid ?? crypto.randomUUID(),
    applicationId,
    iat: now,
    exp: now + 600,
    scope: ['chat'],
  };
  return signJwt(payload, TEST_JWT_SECRET);
}

describe('Rate Limiting Integration - Token Route', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    resetRateLimiters();
    fastify = Fastify({ logger: false });
    await fastify.register(simpleTokenRoutes);
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  it('should allow requests up to the limit', async () => {
    // Limit is 2 per minute
    for (let i = 0; i < 2; i++) {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: { applicationId: 'demo' },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('should return 429 when rate limit is exceeded', async () => {
    // Use up the limit (2 requests)
    for (let i = 0; i < 2; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: { applicationId: 'demo' },
      });
    }

    // Third request should be rate limited
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      payload: { applicationId: 'demo' },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body);
    expect(body.error.category).toBe('policy');
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
    expect(body.error.details?.retryAfterMs).toBeDefined();
  });

  it('should include Retry-After header in 429 response', async () => {
    // Use up the limit
    for (let i = 0; i < 2; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: { applicationId: 'demo' },
      });
    }

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      payload: { applicationId: 'demo' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(parseInt(response.headers['retry-after'] as string)).toBeGreaterThan(0);
  });

  it('should include rate limit headers in successful responses', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      payload: { applicationId: 'demo' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('should track different IPs independently', async () => {
    // First IP uses up its limit
    for (let i = 0; i < 2; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        headers: { 'x-forwarded-for': '1.2.3.4' },
        payload: { applicationId: 'demo' },
      });
    }

    // First IP should be rate limited
    const response1 = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      headers: { 'x-forwarded-for': '1.2.3.4' },
      payload: { applicationId: 'demo' },
    });
    expect(response1.statusCode).toBe(429);

    // Second IP should still be allowed
    const response2 = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      headers: { 'x-forwarded-for': '5.6.7.8' },
      payload: { applicationId: 'demo' },
    });
    expect(response2.statusCode).toBe(200);
  });
});

describe('Rate Limiting Integration - Chat Route', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;

  beforeEach(async () => {
    resetRateLimiters();
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    fastify = Fastify({ logger: false });
    await fastify.register(chatRoutes, {
      sessionStore,
      agentRunner: null,
    });
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  it('should allow requests up to the limit with valid token', async () => {
    const sid = crypto.randomUUID();
    const token = createValidToken('demo', sid);

    // Limit is 3 per minute
    for (let i = 0; i < 3; i++) {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
      // Should get 503 (agent not configured) not 429
      expect(response.statusCode).toBe(503);
    }
  });

  it('should return 429 when rate limit is exceeded', async () => {
    const sid = crypto.randomUUID();
    const token = createValidToken('demo', sid);

    // Use up the limit (3 requests)
    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
    }

    // Fourth request should be rate limited
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body);
    expect(body.error.category).toBe('policy');
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
  });

  it('should track different sids independently', async () => {
    const sid1 = crypto.randomUUID();
    const sid2 = crypto.randomUUID();
    const token1 = createValidToken('demo', sid1);
    const token2 = createValidToken('demo', sid2);

    // First sid uses up its limit
    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: { authorization: `Bearer ${token1}` },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
    }

    // First sid should be rate limited
    const response1 = await fastify.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${token1}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });
    expect(response1.statusCode).toBe(429);

    // Second sid should still be allowed
    const response2 = await fastify.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${token2}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });
    expect(response2.statusCode).toBe(503); // Agent not configured, but not rate limited
  });
});

describe('Rate Limiting Integration - Stream Route', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;

  beforeEach(async () => {
    resetRateLimiters();
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    fastify = Fastify({ logger: false });
    await fastify.register(chatRoutes, {
      sessionStore,
      agentRunner: null,
    });
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  it('should reject before establishing stream when rate limited', async () => {
    const sid = crypto.randomUUID();
    const token = createValidToken('demo', sid);

    // Use up the limit (3 requests)
    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
    }

    // Fourth request should be rate limited before stream starts
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });

    expect(response.statusCode).toBe(429);
    // Should NOT be text/event-stream since we rejected before streaming
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    
    const body = JSON.parse(response.body);
    expect(body.error.category).toBe('policy');
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
  });

  it('should include Retry-After header in 429 response', async () => {
    const sid = crypto.randomUUID();
    const token = createValidToken('demo', sid);

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
    }

    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(parseInt(response.headers['retry-after'] as string)).toBeGreaterThan(0);
  });

  it('should share rate limit between chat and stream routes for same sid', async () => {
    const sid = crypto.randomUUID();
    const token = createValidToken('demo', sid);

    // Use 2 requests on /v1/chat
    for (let i = 0; i < 2; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
    }

    // Use 1 request on /v1/chat/stream (should be the 3rd)
    const streamResponse = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });
    expect(streamResponse.statusCode).toBe(200); // SSE response

    // Fourth request should be rate limited
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });

    expect(response.statusCode).toBe(429);
  });
});

describe('Rate Limiting Integration - When Auth Disabled', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;

  beforeEach(async () => {
    vi.resetModules();
    resetRateLimiters();

    vi.doMock('../config/simpleAuthConfig.js', () => ({
      simpleAuthConfig: {
        enabled: false,
        jwtSecret: '',
        ttlSeconds: 600,
        issuer: 'norce-agent-bff',
        audience: 'norce-agent-widget',
      },
    }));

    vi.doMock('../config.js', () => ({
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
            allowedApplicationIds: ['demo', 'test-app'],
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
        debugRuns: {
          enabled: false,
          maxRuns: 200,
          ttlSeconds: 86400,
        },
      },
    }));

    vi.doMock('../config/rateLimitConfig.js', () => ({
      rateLimitConfig: {
        chatPerMin: 3,
        tokenPerMin: 2,
        burst: 5,
        maxKeys: 5000,
        pruneIntervalMs: 60000,
        windowMs: 60000,
      },
    }));

    const { chatRoutes: routes } = await import('../routes/chat.js');
    sessionStore = new InMemorySessionStore({ ttlSeconds: 1800 });
    fastify = Fastify({ logger: false });
    await fastify.register(routes, {
      sessionStore,
      agentRunner: null,
    });
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  it('should skip rate limiting when Simple Auth is disabled', async () => {
    // Make many requests - should not be rate limited since auth is disabled
    for (let i = 0; i < 10; i++) {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });
      // Should get 503 (agent not configured) not 429
      expect(response.statusCode).toBe(503);
    }
  });
});
