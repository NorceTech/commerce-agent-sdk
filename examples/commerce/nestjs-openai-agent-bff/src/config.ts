import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenvConfig();

/**
 * Schema for validating environment variables.
 * All required variables must be present or a ZodError will be thrown.
 */
const configSchema = z.object({
  // Server
  PORT: z.string().default('3000'),
  
  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  
  // Norce MCP
  NORCE_MCP_BASE_URL: z.string().url('NORCE_MCP_BASE_URL must be a valid URL'),
  // DEFAULT_APPLICATION_ID is optional - only for dev/tests, not used in production request paths
  DEFAULT_APPLICATION_ID: z.string().optional(),
  // NORCE_STATUS_SEED is optional - comma-separated availability statuses passed to product.search
  // When empty/whitespace, statusSeed is omitted from MCP calls (no filtering)
  NORCE_STATUS_SEED: z.string().optional().default(''),
  // ALLOWED_APPLICATION_IDS is optional - comma-separated list of allowed applicationIds
  // If set, requests with applicationId not in this list will be rejected (403)
  // If not set or empty in development, all applicationIds are allowed
  ALLOWED_APPLICATION_IDS: z.string().optional(),
  
  // Norce OAuth
  NORCE_OAUTH_TOKEN_URL: z.string().url('NORCE_OAUTH_TOKEN_URL must be a valid URL'),
  NORCE_OAUTH_CLIENT_ID: z.string().min(1, 'NORCE_OAUTH_CLIENT_ID is required'),
  NORCE_OAUTH_CLIENT_SECRET: z.string().min(1, 'NORCE_OAUTH_CLIENT_SECRET is required'),
  NORCE_OAUTH_SCOPE: z.string().min(1, 'NORCE_OAUTH_SCOPE is required'),
  
  // Session storage configuration
  SESSION_STORE: z.enum(['memory', 'redis']).default('memory'),
  SESSION_TTL_SECONDS: z.string().default('3600'),
  // Redis configuration (required when SESSION_STORE=redis)
  REDIS_URL: z.string().optional(),
  REDIS_PREFIX: z.string().default('agent:sess:'),
  
  // Agent configuration
  AGENT_MAX_ROUNDS: z.string().default('6'),
  AGENT_MAX_TOOL_CALLS_PER_ROUND: z.string().default('3'),
  DEBUG: z.string().default('0'),
  
  // Timeout configuration (in milliseconds)
  OAUTH_TIMEOUT_MS: z.string().default('5000'),
  MCP_CALL_TIMEOUT_MS: z.string().default('10000'),
  // OpenAI timeout for non-streaming calls (2 minutes default)
  OPENAI_TIMEOUT_MS: z.string().default('120000'),
  // OpenAI timeout for streaming calls (5 minutes default - streams can be longer)
  OPENAI_STREAM_TIMEOUT_MS: z.string().default('300000'),
  
  // Retry configuration
  RETRY_MAX_ATTEMPTS: z.string().default('2'),
  RETRY_BASE_DELAY_MS: z.string().default('500'),
  RETRY_JITTER_MS: z.string().default('200'),
  // OpenAI retries for non-streaming calls (default 2)
  OPENAI_MAX_RETRIES: z.string().default('2'),
  // OpenAI retries for streaming calls (default 0 - retries on streams are bad UX)
  OPENAI_STREAM_MAX_RETRIES: z.string().default('0'),
  
  // OpenAI SDK debug logging (dev-only, may log request/response bodies)
  OPENAI_SDK_DEBUG: z.string().default('0'),
  
  // Debug runs configuration (dev-only)
  DEBUG_RUNS_ENABLED: z.string().default('0'),
  DEBUG_RUNS_MAX: z.string().default('200'),
  DEBUG_RUNS_TTL_SECONDS: z.string().default('86400'),
  
  // CORS configuration
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  
  // Request/body limits (abuse prevention)
  BODY_LIMIT_BYTES: z.string().default('131072'),
  MAX_MESSAGE_CHARS: z.string().default('4000'),
  MAX_MESSAGE_TOKENS_EST: z.string().default('1200'),
});

/**
 * Parse and validate environment variables.
 * Throws a descriptive error if validation fails.
 */
function parseConfig() {
  try {
    return configSchema.parse({
      PORT: process.env.PORT,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      NORCE_MCP_BASE_URL: process.env.NORCE_MCP_BASE_URL,
      DEFAULT_APPLICATION_ID: process.env.DEFAULT_APPLICATION_ID,
      NORCE_STATUS_SEED: process.env.NORCE_STATUS_SEED,
      ALLOWED_APPLICATION_IDS: process.env.ALLOWED_APPLICATION_IDS,
      NORCE_OAUTH_TOKEN_URL: process.env.NORCE_OAUTH_TOKEN_URL,
      NORCE_OAUTH_CLIENT_ID: process.env.NORCE_OAUTH_CLIENT_ID,
      NORCE_OAUTH_CLIENT_SECRET: process.env.NORCE_OAUTH_CLIENT_SECRET,
      NORCE_OAUTH_SCOPE: process.env.NORCE_OAUTH_SCOPE,
      SESSION_STORE: process.env.SESSION_STORE,
      SESSION_TTL_SECONDS: process.env.SESSION_TTL_SECONDS,
      REDIS_URL: process.env.REDIS_URL,
      REDIS_PREFIX: process.env.REDIS_PREFIX,
      AGENT_MAX_ROUNDS: process.env.AGENT_MAX_ROUNDS,
      AGENT_MAX_TOOL_CALLS_PER_ROUND: process.env.AGENT_MAX_TOOL_CALLS_PER_ROUND,
      DEBUG: process.env.DEBUG,
      OAUTH_TIMEOUT_MS: process.env.OAUTH_TIMEOUT_MS,
      MCP_CALL_TIMEOUT_MS: process.env.MCP_CALL_TIMEOUT_MS,
      OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
      OPENAI_STREAM_TIMEOUT_MS: process.env.OPENAI_STREAM_TIMEOUT_MS,
      RETRY_MAX_ATTEMPTS: process.env.RETRY_MAX_ATTEMPTS,
      RETRY_BASE_DELAY_MS: process.env.RETRY_BASE_DELAY_MS,
      RETRY_JITTER_MS: process.env.RETRY_JITTER_MS,
      OPENAI_MAX_RETRIES: process.env.OPENAI_MAX_RETRIES,
      OPENAI_STREAM_MAX_RETRIES: process.env.OPENAI_STREAM_MAX_RETRIES,
      OPENAI_SDK_DEBUG: process.env.OPENAI_SDK_DEBUG,
      DEBUG_RUNS_ENABLED: process.env.DEBUG_RUNS_ENABLED,
      DEBUG_RUNS_MAX: process.env.DEBUG_RUNS_MAX,
      DEBUG_RUNS_TTL_SECONDS: process.env.DEBUG_RUNS_TTL_SECONDS,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
      BODY_LIMIT_BYTES: process.env.BODY_LIMIT_BYTES,
      MAX_MESSAGE_CHARS: process.env.MAX_MESSAGE_CHARS,
      MAX_MESSAGE_TOKENS_EST: process.env.MAX_MESSAGE_TOKENS_EST,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((err) => `  - ${err.path.join('.')}: ${err.message}`);
      throw new Error(`Configuration validation failed:\n${messages.join('\n')}`);
    }
    throw error;
  }
}

const env = parseConfig();

/**
 * Typed configuration object exported for use throughout the application.
 */
export const config = {
  port: parseInt(env.PORT, 10),
  
  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  },
  
  norce: {
    mcp: {
      baseUrl: env.NORCE_MCP_BASE_URL,
      // defaultApplicationId is optional - only for dev/tests, not used in production request paths
      defaultApplicationId: env.DEFAULT_APPLICATION_ID,
      // statusSeed is trimmed; empty/whitespace means no filtering
      statusSeed: (env.NORCE_STATUS_SEED ?? '').trim(),
      // allowedApplicationIds is parsed from comma-separated string, empty array if not set
      allowedApplicationIds: env.ALLOWED_APPLICATION_IDS
        ? env.ALLOWED_APPLICATION_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0)
        : [],
    },
    oauth: {
      tokenUrl: env.NORCE_OAUTH_TOKEN_URL,
      clientId: env.NORCE_OAUTH_CLIENT_ID,
      clientSecret: env.NORCE_OAUTH_CLIENT_SECRET,
      scope: env.NORCE_OAUTH_SCOPE,
    },
  },
  
  session: {
    store: env.SESSION_STORE,
    ttlSeconds: parseInt(env.SESSION_TTL_SECONDS, 10),
    redis: {
      url: env.REDIS_URL,
      prefix: env.REDIS_PREFIX,
    },
  },
  
  agent: {
    maxRounds: parseInt(env.AGENT_MAX_ROUNDS, 10),
    maxToolCallsPerRound: parseInt(env.AGENT_MAX_TOOL_CALLS_PER_ROUND, 10),
  },
  
  timeouts: {
    oauthMs: parseInt(env.OAUTH_TIMEOUT_MS, 10),
    mcpCallMs: parseInt(env.MCP_CALL_TIMEOUT_MS, 10),
    openaiMs: parseInt(env.OPENAI_TIMEOUT_MS, 10),
    openaiStreamMs: parseInt(env.OPENAI_STREAM_TIMEOUT_MS, 10),
  },
  
  retry: {
    maxAttempts: parseInt(env.RETRY_MAX_ATTEMPTS, 10),
    baseDelayMs: parseInt(env.RETRY_BASE_DELAY_MS, 10),
    jitterMs: parseInt(env.RETRY_JITTER_MS, 10),
  },
  
  openaiRetry: {
    maxRetries: parseInt(env.OPENAI_MAX_RETRIES, 10),
    streamMaxRetries: parseInt(env.OPENAI_STREAM_MAX_RETRIES, 10),
  },
  
  openaiSdkDebug: env.OPENAI_SDK_DEBUG === '1' || env.OPENAI_SDK_DEBUG === 'true',
  
  debug: env.DEBUG === '1' || env.DEBUG === 'true',
  
  debugRuns: {
    enabled: env.DEBUG_RUNS_ENABLED === '1' || env.DEBUG_RUNS_ENABLED === 'true',
    maxRuns: parseInt(env.DEBUG_RUNS_MAX, 10),
    ttlSeconds: parseInt(env.DEBUG_RUNS_TTL_SECONDS, 10),
  },
  
  cors: {
    origins: env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(origin => origin.length > 0)
      : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  },
  
  limits: {
    bodyLimitBytes: parseInt(env.BODY_LIMIT_BYTES, 10),
    maxMessageChars: parseInt(env.MAX_MESSAGE_CHARS, 10),
    maxMessageTokensEst: parseInt(env.MAX_MESSAGE_TOKENS_EST, 10),
  },
} as const;

export type Config = typeof config;
