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

import { NorceTokenProvider } from '../norce/NorceTokenProvider.js';

const TEST_TOKEN_URL = 'https://test.norce.tech/oauth/token';
const TEST_CLIENT_ID = 'test-client-id';
const TEST_CLIENT_SECRET = 'test-client-secret';
const TEST_SCOPE = 'test-scope';
const TEST_APPLICATION_ID = 'test-app-id';

function createTokenProvider(): NorceTokenProvider {
  return new NorceTokenProvider({
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    tokenUrl: TEST_TOKEN_URL,
    scope: TEST_SCOPE,
  });
}

function createMockTokenResponse(expiresIn: number = 3600) {
  return {
    access_token: 'test-access-token-' + Math.random().toString(36).substring(7),
    expires_in: expiresIn,
    token_type: 'Bearer',
  };
}

describe('NorceTokenProvider', () => {
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

  it('should fetch token from token URL on first call', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    const tokenResponse = createMockTokenResponse();
    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      .reply(200, tokenResponse, {
        headers: { 'Content-Type': 'application/json' },
      });

    const token = await tokenProvider.getAccessToken(TEST_APPLICATION_ID);

    expect(token).toBe(tokenResponse.access_token);
  });

  it('should return cached token on second call without additional HTTP request', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    const tokenResponse = createMockTokenResponse(3600); // 1 hour expiry
    let requestCount = 0;

    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
      })
      .reply(() => {
        requestCount++;
        return {
          statusCode: 200,
          data: JSON.stringify(tokenResponse),
          headers: { 'Content-Type': 'application/json' },
        };
      });

    // First call - should make HTTP request
    const token1 = await tokenProvider.getAccessToken(TEST_APPLICATION_ID);
    expect(token1).toBe(tokenResponse.access_token);
    expect(requestCount).toBe(1);

    // Second call - should return cached token
    const token2 = await tokenProvider.getAccessToken(TEST_APPLICATION_ID);
    expect(token2).toBe(tokenResponse.access_token);
    expect(requestCount).toBe(1); // No additional HTTP request
  });

  it('should refresh token when near expiry (less than 60 seconds remaining)', async () => {
    vi.useFakeTimers();
    try {
      const tokenProvider = createTokenProvider();
      const mockPool = mockAgent.get('https://test.norce.tech');

      const firstTokenResponse = {
        access_token: 'first-token',
        expires_in: 120, // 2 minutes
        token_type: 'Bearer',
      };

      const secondTokenResponse = {
        access_token: 'second-token',
        expires_in: 3600,
        token_type: 'Bearer',
      };

      let requestCount = 0;
      mockPool
        .intercept({
          path: '/oauth/token',
          method: 'POST',
        })
        .reply(() => {
          requestCount++;
          const response = requestCount === 1 ? firstTokenResponse : secondTokenResponse;
          return {
            statusCode: 200,
            data: JSON.stringify(response),
            headers: { 'Content-Type': 'application/json' },
          };
        })
        .persist();

      // First call - get initial token
      const token1 = await tokenProvider.getAccessToken(TEST_APPLICATION_ID);
      expect(token1).toBe('first-token');
      expect(requestCount).toBe(1);

      // Advance time to 61 seconds before expiry (59 seconds remaining)
      // Token expires at now + 120s, so advance 61 seconds
      vi.advanceTimersByTime(61 * 1000);

      // Second call - should refresh because < 60s remaining
      const token2 = await tokenProvider.getAccessToken(TEST_APPLICATION_ID);
      expect(token2).toBe('second-token');
      expect(requestCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should only make one HTTP request when multiple callers request token simultaneously (concurrency lock)', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    let requestCount = 0;
    const tokenResponse = {
      access_token: 'concurrent-test-token',
      expires_in: 3600,
      token_type: 'Bearer',
    };

    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
      })
      .reply(() => {
        requestCount++;
        return {
          statusCode: 200,
          data: JSON.stringify(tokenResponse),
          headers: { 'Content-Type': 'application/json' },
        };
      });

    // Simulate 10 concurrent callers requesting token simultaneously
    // All calls are made before any can complete, testing the in-flight promise lock
    const promises = Array.from({ length: 10 }, () => tokenProvider.getAccessToken(TEST_APPLICATION_ID));

    const tokens = await Promise.all(promises);

    // All callers should receive the same token
    tokens.forEach((token) => {
      expect(token).toBe(tokenResponse.access_token);
    });

    // Only one HTTP request should have been made due to the in-flight promise lock
    expect(requestCount).toBe(1);
  });

  it('should throw error with proper message for non-200 response', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
      })
      .reply(401, { error: 'invalid_client', error_description: 'Invalid credentials' }, {
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(tokenProvider.getAccessToken(TEST_APPLICATION_ID)).rejects.toThrow(
      /Failed to fetch OAuth token: 401/
    );
  });

  it('should throw error for invalid JSON response', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
      })
      .reply(200, 'not valid json', {
        headers: { 'Content-Type': 'text/plain' },
      });

    await expect(tokenProvider.getAccessToken(TEST_APPLICATION_ID)).rejects.toThrow(
      /Failed to parse OAuth token response as JSON/
    );
  });

  it('should throw error for response missing required fields', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
      })
      .reply(200, { token_type: 'Bearer' }, {
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(tokenProvider.getAccessToken(TEST_APPLICATION_ID)).rejects.toThrow(
      /Invalid OAuth token response: missing access_token or expires_in/
    );
  });

  it('should clear cache when clearCache is called', async () => {
    const tokenProvider = createTokenProvider();
    const mockPool = mockAgent.get('https://test.norce.tech');

    let requestCount = 0;
    mockPool
      .intercept({
        path: '/oauth/token',
        method: 'POST',
      })
      .reply(() => {
        requestCount++;
        return {
          statusCode: 200,
          data: JSON.stringify(createMockTokenResponse()),
          headers: { 'Content-Type': 'application/json' },
        };
      })
      .persist();

    // First call
    await tokenProvider.getAccessToken(TEST_APPLICATION_ID);
    expect(requestCount).toBe(1);

    // Clear cache
    tokenProvider.clearCache();

    // Second call should make new request
    await tokenProvider.getAccessToken(TEST_APPLICATION_ID);
    expect(requestCount).toBe(2);
  });
});
