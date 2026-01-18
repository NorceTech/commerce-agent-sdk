/**
 * Rate limiting middleware for Simple Auth endpoints.
 * 
 * - For /v1/simple/token: key = `ip:${clientIp}` (caller may not have sid yet)
 * - For /v1/chat and /v1/chat/stream: key = `sid:${req.auth.sid}` (when Simple Auth enabled)
 * 
 * Returns 429 with error envelope when rate limit is exceeded.
 */

import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { FixedWindowRateLimiter, RateLimitResult } from './rateLimiter.js';
import { rateLimitConfig } from '../config/rateLimitConfig.js';
import { simpleAuthConfig } from '../config/simpleAuthConfig.js';
import { getClientIp } from '../http/clientIp.js';
import { createErrorEnvelope } from '../http/errorEnvelope.js';

// Create rate limiters for different endpoints
const chatRateLimiter = new FixedWindowRateLimiter({
  windowMs: rateLimitConfig.windowMs,
  limit: rateLimitConfig.chatPerMin,
  maxKeys: rateLimitConfig.maxKeys,
  pruneIntervalMs: rateLimitConfig.pruneIntervalMs,
});

const tokenRateLimiter = new FixedWindowRateLimiter({
  windowMs: rateLimitConfig.windowMs,
  limit: rateLimitConfig.tokenPerMin,
  maxKeys: rateLimitConfig.maxKeys,
  pruneIntervalMs: rateLimitConfig.pruneIntervalMs,
});

/**
 * Build the rate limit key for a request.
 * For chat endpoints: uses sid from auth context
 * For token endpoint: uses client IP
 */
function buildRateLimitKey(
  request: FastifyRequest,
  useIp: boolean
): string | null {
  if (useIp) {
    const ip = getClientIp(request.raw);
    return ip ? `ip:${ip}` : null;
  }

  // Use sid from auth context for chat endpoints
  const auth = request.auth;
  if (auth?.sid) {
    return `sid:${auth.sid}`;
  }

  // Fallback to IP if no auth context (shouldn't happen for chat routes when auth is enabled)
  const ip = getClientIp(request.raw);
  return ip ? `ip:${ip}` : null;
}

/**
 * Send a 429 rate limit response with proper error envelope.
 */
function sendRateLimitResponse(
  reply: FastifyReply,
  result: RateLimitResult,
  requestId: string
): void {
  const retryAfterMs = result.retryAfterMs ?? (result.resetAt - Date.now());
  const retryAfterSeconds = Math.ceil(Math.max(0, retryAfterMs) / 1000);

  const envelope = createErrorEnvelope(
    'policy',
    'RATE_LIMITED',
    'Too many requests. Please try again later.',
    true,
    requestId,
    { retryAfterMs: Math.max(0, retryAfterMs) }
  );

  reply
    .status(429)
    .header('Retry-After', String(retryAfterSeconds))
    .header('X-RateLimit-Remaining', '0')
    .header('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)))
    .send({ error: envelope });
}

/**
 * Rate limit middleware for token minting endpoint.
 * Uses IP-based rate limiting since caller may not have a sid yet.
 */
export const tokenRateLimitMiddleware: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  // Skip rate limiting if Simple Auth is not enabled
  if (!simpleAuthConfig.enabled) {
    return;
  }

  const key = buildRateLimitKey(request, true);
  if (!key) {
    // If we can't determine the key, allow the request (fail open)
    request.log.warn({ msg: 'Rate limit: could not determine key for token endpoint' });
    return;
  }

  const result = tokenRateLimiter.hit(key);

  if (!result.allowed) {
    request.log.warn({
      msg: 'Rate limit exceeded for token endpoint',
      key,
      resetAt: result.resetAt,
    });
    sendRateLimitResponse(reply, result, request.id);
    return reply;
  }

  // Add rate limit headers for successful requests
  reply.header('X-RateLimit-Remaining', String(result.remaining));
  reply.header('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
};

/**
 * Rate limit middleware for chat endpoints.
 * Uses sid-based rate limiting when Simple Auth is enabled.
 */
export const chatRateLimitMiddleware: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  // Skip rate limiting if Simple Auth is not enabled
  if (!simpleAuthConfig.enabled) {
    return;
  }

  const key = buildRateLimitKey(request, false);
  if (!key) {
    // If we can't determine the key, allow the request (fail open)
    request.log.warn({ msg: 'Rate limit: could not determine key for chat endpoint' });
    return;
  }

  const result = chatRateLimiter.hit(key);

  if (!result.allowed) {
    request.log.warn({
      msg: 'Rate limit exceeded for chat endpoint',
      key,
      resetAt: result.resetAt,
    });
    sendRateLimitResponse(reply, result, request.id);
    return reply;
  }

  // Add rate limit headers for successful requests
  reply.header('X-RateLimit-Remaining', String(result.remaining));
  reply.header('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
};

/**
 * Get the chat rate limiter instance for testing.
 */
export function getChatRateLimiter(): FixedWindowRateLimiter {
  return chatRateLimiter;
}

/**
 * Get the token rate limiter instance for testing.
 */
export function getTokenRateLimiter(): FixedWindowRateLimiter {
  return tokenRateLimiter;
}

/**
 * Reset all rate limiters. Useful for testing.
 */
export function resetRateLimiters(): void {
  chatRateLimiter.reset();
  tokenRateLimiter.reset();
}
