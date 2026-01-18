import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Helper function to simulate config parsing with given env vars
function simulateConfigParse(envVars: Record<string, string | undefined>) {
  const configSchema = z.object({
    PORT: z.string().default('3000'),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    NORCE_MCP_BASE_URL: z.string().url('NORCE_MCP_BASE_URL must be a valid URL'),
    NORCE_APPLICATION_ID: z.string().min(1, 'NORCE_APPLICATION_ID is required'),
    NORCE_OAUTH_TOKEN_URL: z.string().url('NORCE_OAUTH_TOKEN_URL must be a valid URL'),
    NORCE_OAUTH_CLIENT_ID: z.string().min(1, 'NORCE_OAUTH_CLIENT_ID is required'),
    NORCE_OAUTH_CLIENT_SECRET: z.string().min(1, 'NORCE_OAUTH_CLIENT_SECRET is required'),
    NORCE_OAUTH_SCOPE: z.string().min(1, 'NORCE_OAUTH_SCOPE is required'),
    SESSION_TTL_SECONDS: z.string().default('1800'),
    AGENT_MAX_ROUNDS: z.string().default('6'),
    AGENT_MAX_TOOL_CALLS_PER_ROUND: z.string().default('3'),
    DEBUG: z.string().default('0'),
  });

  try {
    const env = configSchema.parse(envVars);
    return {
      port: parseInt(env.PORT, 10),
      openai: {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
      },
      norce: {
        mcp: {
          baseUrl: env.NORCE_MCP_BASE_URL,
          applicationId: env.NORCE_APPLICATION_ID,
        },
        oauth: {
          tokenUrl: env.NORCE_OAUTH_TOKEN_URL,
          clientId: env.NORCE_OAUTH_CLIENT_ID,
          clientSecret: env.NORCE_OAUTH_CLIENT_SECRET,
          scope: env.NORCE_OAUTH_SCOPE,
        },
      },
      session: {
        ttlSeconds: parseInt(env.SESSION_TTL_SECONDS, 10),
      },
      agent: {
        maxRounds: parseInt(env.AGENT_MAX_ROUNDS, 10),
        maxToolCallsPerRound: parseInt(env.AGENT_MAX_TOOL_CALLS_PER_ROUND, 10),
      },
      debug: env.DEBUG === '1' || env.DEBUG === 'true',
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues?.map((err) => `  - ${err.path.join('.')}: ${err.message}`) || [];
      throw new Error(`Configuration validation failed:\n${messages.join('\n')}`);
    }
    throw error;
  }
}

describe('config validation', () => {
  const validEnv = {
    PORT: '3000',
    OPENAI_API_KEY: 'sk-test-key',
    OPENAI_MODEL: 'gpt-4o-mini',
    NORCE_MCP_BASE_URL: 'https://test.api-se.norce.tech/mcp/commerce',
    NORCE_APPLICATION_ID: 'test-app-id',
    NORCE_OAUTH_TOKEN_URL: 'https://test.api-se.stage.norce.tech/identity/1.0/connect/token',
    NORCE_OAUTH_CLIENT_ID: 'test-client-id',
    NORCE_OAUTH_CLIENT_SECRET: 'test-client-secret',
    NORCE_OAUTH_SCOPE: 'stage',
  };

  it('should throw helpful error when OPENAI_API_KEY is missing', () => {
    const env: Record<string, string | undefined> = { ...validEnv };
    delete env.OPENAI_API_KEY;

    expect(() => simulateConfigParse(env)).toThrow(/OPENAI_API_KEY/);
  });

  it('should throw helpful error when NORCE_MCP_BASE_URL is missing', () => {
    const env: Record<string, string | undefined> = { ...validEnv };
    delete env.NORCE_MCP_BASE_URL;

    expect(() => simulateConfigParse(env)).toThrow(/NORCE_MCP_BASE_URL/);
  });

  it('should throw helpful error when NORCE_OAUTH_CLIENT_ID is missing', () => {
    const env: Record<string, string | undefined> = { ...validEnv };
    delete env.NORCE_OAUTH_CLIENT_ID;

    expect(() => simulateConfigParse(env)).toThrow(/NORCE_OAUTH_CLIENT_ID/);
  });

  it('should throw helpful error when NORCE_OAUTH_CLIENT_SECRET is missing', () => {
    const env: Record<string, string | undefined> = { ...validEnv };
    delete env.NORCE_OAUTH_CLIENT_SECRET;

    expect(() => simulateConfigParse(env)).toThrow(/NORCE_OAUTH_CLIENT_SECRET/);
  });

  it('should throw helpful error when URL format is invalid', () => {
    const env = { ...validEnv, NORCE_MCP_BASE_URL: 'not-a-valid-url' };

    expect(() => simulateConfigParse(env)).toThrow(/valid URL/);
  });

  it('should successfully parse valid environment variables', () => {
    const config = simulateConfigParse(validEnv);

    expect(config.port).toBe(3000);
    expect(config.openai.apiKey).toBe('sk-test-key');
    expect(config.openai.model).toBe('gpt-4o-mini');
    expect(config.norce.mcp.baseUrl).toBe('https://test.api-se.norce.tech/mcp/commerce');
    expect(config.norce.mcp.applicationId).toBe('test-app-id');
    expect(config.norce.oauth.tokenUrl).toBe('https://test.api-se.stage.norce.tech/identity/1.0/connect/token');
    expect(config.norce.oauth.clientId).toBe('test-client-id');
    expect(config.norce.oauth.clientSecret).toBe('test-client-secret');
    expect(config.norce.oauth.scope).toBe('stage');
  });

  it('should use default values for optional configuration', () => {
    const config = simulateConfigParse(validEnv);

    expect(config.session.ttlSeconds).toBe(1800);
    expect(config.agent.maxRounds).toBe(6);
    expect(config.agent.maxToolCallsPerRound).toBe(3);
    expect(config.debug).toBe(false);
  });

  it('should parse optional configuration when provided', () => {
    const env = {
      ...validEnv,
      PORT: '8080',
      SESSION_TTL_SECONDS: '3600',
      AGENT_MAX_ROUNDS: '10',
      AGENT_MAX_TOOL_CALLS_PER_ROUND: '5',
      DEBUG: '1',
    };

    const config = simulateConfigParse(env);

    expect(config.port).toBe(8080);
    expect(config.session.ttlSeconds).toBe(3600);
    expect(config.agent.maxRounds).toBe(10);
    expect(config.agent.maxToolCallsPerRound).toBe(5);
    expect(config.debug).toBe(true);
  });

  it('should handle DEBUG=true as boolean', () => {
    const env = {
      ...validEnv,
      DEBUG: 'true',
    };

    const config = simulateConfigParse(env);
    expect(config.debug).toBe(true);
  });
});
