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

import { chatRoutes } from '../routes/chat.js';
import { InMemorySessionStore } from '../session/InMemorySessionStore.js';
import { signJwt, JwtPayload } from '../config/jwt.js';

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

function createExpiredToken(applicationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: 'norce-agent-bff',
    aud: 'norce-agent-widget',
    sid: crypto.randomUUID(),
    applicationId,
    iat: now - 1000,
    exp: now - 100,
    scope: ['chat'],
  };
  return signJwt(payload, TEST_JWT_SECRET);
}

function createTokenWithWrongIssuer(applicationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: 'wrong-issuer',
    aud: 'norce-agent-widget',
    sid: crypto.randomUUID(),
    applicationId,
    iat: now,
    exp: now + 600,
    scope: ['chat'],
  };
  return signJwt(payload, TEST_JWT_SECRET);
}

function createTokenWithWrongAudience(applicationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: 'norce-agent-bff',
    aud: 'wrong-audience',
    sid: crypto.randomUUID(),
    applicationId,
    iat: now,
    exp: now + 600,
    scope: ['chat'],
  };
  return signJwt(payload, TEST_JWT_SECRET);
}

function createTokenWithWrongSignature(applicationId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    iss: 'norce-agent-bff',
    aud: 'norce-agent-widget',
    sid: crypto.randomUUID(),
    applicationId,
    iat: now,
    exp: now + 600,
    scope: ['chat'],
  };
  return signJwt(payload, 'wrong-secret-that-is-at-least-32-chars');
}

describe('Simple Auth Middleware - POST /v1/chat', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;

  beforeEach(async () => {
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

  describe('when Simple Auth is enabled', () => {
    it('should return 401 when Authorization header is missing', async () => {
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

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
      expect(body.error.retryable).toBe(false);
    });

    it('should return 401 when Authorization header has wrong format', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: 'Basic sometoken',
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
    });

    it('should return 401 when token has invalid signature', async () => {
      const token = createTokenWithWrongSignature('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
      expect(body.error.retryable).toBe(false);
    });

    it('should return 401 when token is expired', async () => {
      const token = createExpiredToken('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
    });

    it('should return 401 when token has wrong issuer', async () => {
      const token = createTokenWithWrongIssuer('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
    });

    it('should return 401 when token has wrong audience', async () => {
      const token = createTokenWithWrongAudience('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
    });

    it('should allow request with valid token', async () => {
      const token = createValidToken('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.text).toContain('AI agent is not configured');
    });

    it('should use applicationId from token, ignoring body applicationId', async () => {
      const token = createValidToken('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'different-app-id',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.text).toContain('AI agent is not configured');
    });

    it('should return 403 when token applicationId is not in allowed list', async () => {
      const token = createValidToken('not-allowed-app');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_FORBIDDEN');
    });
  });
});

describe('Simple Auth Middleware - POST /v1/chat/stream', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;

  beforeEach(async () => {
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

  describe('when Simple Auth is enabled', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
      expect(body.error.retryable).toBe(false);
    });

    it('should return 401 when token has invalid signature', async () => {
      const token = createTokenWithWrongSignature('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
    });

    it('should return 401 when token is expired', async () => {
      const token = createExpiredToken('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('auth');
      expect(body.error.code).toBe('AUTHZ_UNAUTHORIZED');
    });

    it('should allow request with valid token', async () => {
      const token = createValidToken('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'demo',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('event: error');
      expect(response.body).toContain('AI agent is not configured');
    });

    it('should use applicationId from token, ignoring body applicationId', async () => {
      const token = createValidToken('demo');
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          applicationId: 'different-app-id',
          sessionId: 'test-session',
          message: 'Hello',
          context: {},
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('event: error');
      expect(response.body).toContain('AI agent is not configured');
    });
  });
});

describe('Simple Auth Middleware - when disabled', () => {
  let fastify: FastifyInstance;
  let sessionStore: InMemorySessionStore;

  beforeEach(async () => {
    vi.resetModules();

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

  it('should allow POST /v1/chat without Authorization header when disabled', async () => {
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

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.text).toContain('AI agent is not configured');
  });

  it('should allow POST /v1/chat/stream without Authorization header when disabled', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: {
        applicationId: 'demo',
        sessionId: 'test-session',
        message: 'Hello',
        context: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: error');
    expect(response.body).toContain('AI agent is not configured');
  });
});
