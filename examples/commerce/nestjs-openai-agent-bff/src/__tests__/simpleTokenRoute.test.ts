import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

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
  },
}));

import { simpleTokenRoutes } from '../routes/simpleTokenRoute.js';
import { verifyJwt } from '../config/jwt.js';

describe('POST /v1/auth/simple/token', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify({ logger: false });
    await fastify.register(simpleTokenRoutes);
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  describe('when enabled and secret set', () => {
    it('should return 200 with token, expiresInSeconds, and sid for valid applicationId', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
      expect(body.expiresInSeconds).toBe(600);
      expect(body.sid).toBeDefined();
      expect(typeof body.sid).toBe('string');
    });

    it('should return 403 for invalid applicationId', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'invalid-app',
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('authz');
      expect(body.error.code).toBe('AUTHZ_FORBIDDEN');
      expect(body.error.message).toContain('invalid-app');
    });

    it('should return 400 when applicationId is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
    });

    it('should return 400 when applicationId is empty string', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: '',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.category).toBe('validation');
      expect(body.error.code).toBe('VALIDATION_REQUEST_INVALID');
    });
  });

  describe('token content verification', () => {
    it('should generate a valid JWT that can be verified with the secret', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const result = verifyJwt(body.token, 'test-secret-that-is-at-least-32-characters-long');

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
    });

    it('should include correct claims in the JWT payload', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const result = verifyJwt(body.token, 'test-secret-that-is-at-least-32-characters-long');

      expect(result.valid).toBe(true);
      expect(result.payload?.iss).toBe('norce-agent-bff');
      expect(result.payload?.aud).toBe('norce-agent-widget');
      expect(result.payload?.applicationId).toBe('demo');
      expect(result.payload?.sid).toBe(body.sid);
      expect(result.payload?.scope).toEqual(['chat']);
    });

    it('should set exp within the ttl window', async () => {
      const beforeRequest = Math.floor(Date.now() / 1000);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      const afterRequest = Math.floor(Date.now() / 1000);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const result = verifyJwt(body.token, 'test-secret-that-is-at-least-32-characters-long');

      expect(result.valid).toBe(true);
      expect(result.payload?.exp).toBeGreaterThanOrEqual(beforeRequest + 600);
      expect(result.payload?.exp).toBeLessThanOrEqual(afterRequest + 600 + 1);
    });

    it('should set iat to current timestamp', async () => {
      const beforeRequest = Math.floor(Date.now() / 1000);

      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      const afterRequest = Math.floor(Date.now() / 1000);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const result = verifyJwt(body.token, 'test-secret-that-is-at-least-32-characters-long');

      expect(result.valid).toBe(true);
      expect(result.payload?.iat).toBeGreaterThanOrEqual(beforeRequest);
      expect(result.payload?.iat).toBeLessThanOrEqual(afterRequest);
    });

    it('should fail verification with wrong secret', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const result = verifyJwt(body.token, 'wrong-secret-that-is-at-least-32-chars');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('should generate unique sid for each request', async () => {
      const response1 = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      const response2 = await fastify.inject({
        method: 'POST',
        url: '/v1/auth/simple/token',
        payload: {
          applicationId: 'demo',
        },
      });

      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);

      expect(body1.sid).not.toBe(body2.sid);
    });
  });
});

describe('POST /v1/auth/simple/token when disabled', () => {
  let fastify: FastifyInstance;

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

    fastify = Fastify({ logger: false });
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  it('should return 404 when route is not registered (disabled)', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      payload: {
        applicationId: 'demo',
      },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /v1/auth/simple/token with permissive allowlist', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../config/simpleAuthConfig.js', () => ({
      simpleAuthConfig: {
        enabled: true,
        jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
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

    const { simpleTokenRoutes: routes } = await import('../routes/simpleTokenRoute.js');
    fastify = Fastify({ logger: false });
    await fastify.register(routes);
  });

  afterEach(async () => {
    await fastify.close();
    vi.clearAllMocks();
  });

  it('should allow any applicationId when allowlist is empty', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/auth/simple/token',
      payload: {
        applicationId: 'any-app-id',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.token).toBeDefined();
    expect(body.sid).toBeDefined();
  });
});
