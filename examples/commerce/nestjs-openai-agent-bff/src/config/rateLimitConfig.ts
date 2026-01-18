import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const DEFAULT_CHAT_PER_MIN = 20;
const DEFAULT_TOKEN_PER_MIN = 10;
const DEFAULT_BURST = 5;
const DEFAULT_MAX_KEYS = 5000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

function parseRateLimitConfig() {
  const chatPerMin = parseInt(process.env.DEMO_RL_CHAT_PER_MIN ?? String(DEFAULT_CHAT_PER_MIN), 10);
  const tokenPerMin = parseInt(process.env.DEMO_RL_TOKEN_PER_MIN ?? String(DEFAULT_TOKEN_PER_MIN), 10);
  const burst = parseInt(process.env.DEMO_RL_BURST ?? String(DEFAULT_BURST), 10);
  const maxKeys = parseInt(process.env.DEMO_RL_MAX_KEYS ?? String(DEFAULT_MAX_KEYS), 10);
  const pruneIntervalMs = parseInt(process.env.DEMO_RL_PRUNE_INTERVAL_MS ?? String(DEFAULT_PRUNE_INTERVAL_MS), 10);

  return {
    chatPerMin: isNaN(chatPerMin) ? DEFAULT_CHAT_PER_MIN : chatPerMin,
    tokenPerMin: isNaN(tokenPerMin) ? DEFAULT_TOKEN_PER_MIN : tokenPerMin,
    burst: isNaN(burst) ? DEFAULT_BURST : burst,
    maxKeys: isNaN(maxKeys) ? DEFAULT_MAX_KEYS : maxKeys,
    pruneIntervalMs: isNaN(pruneIntervalMs) ? DEFAULT_PRUNE_INTERVAL_MS : pruneIntervalMs,
    windowMs: 60_000, // Fixed 1-minute window
  };
}

export const rateLimitConfig = parseRateLimitConfig();

export type RateLimitConfig = typeof rateLimitConfig;
