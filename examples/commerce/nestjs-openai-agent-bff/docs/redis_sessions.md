# Redis Session Storage

This document describes how to enable Redis-backed session storage for running multiple BFF instances behind a load balancer.

## Overview

By default, the Agent BFF uses in-memory session storage, which is suitable for local development and single-instance deployments. For production deployments with multiple instances behind a load balancer, Redis session storage ensures session data is shared across all instances.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_STORE` | `memory` | Session storage backend: `memory` or `redis` |
| `SESSION_TTL_SECONDS` | `3600` | Session time-to-live in seconds (1 hour default) |
| `REDIS_URL` | - | Redis connection URL (required when `SESSION_STORE=redis`) |
| `REDIS_PREFIX` | `agent:sess:` | Key prefix for session data in Redis |

### Enable Redis Sessions

1. Set the session store to Redis:
   ```bash
   SESSION_STORE=redis
   ```

2. Configure the Redis connection URL:
   ```bash
   REDIS_URL=redis://localhost:6379
   ```

3. Optionally customize the key prefix:
   ```bash
   REDIS_PREFIX=myapp:sess:
   ```

### Example Configuration

```bash
# .env file for Redis sessions
SESSION_STORE=redis
SESSION_TTL_SECONDS=3600
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=agent:sess:
```

## Session Key Format

Session keys in Redis follow the format: `{prefix}{applicationId}:{sessionId}`

For example, with the default prefix `agent:sess:` and an application ID of `demo` with session ID `abc123`, the Redis key would be:
```
agent:sess:demo:abc123
```

## TTL Behavior

Sessions automatically expire after the configured TTL. The TTL is refreshed on every session update (touch semantics), so active sessions remain valid as long as they are being used.

## Redis Connection

The Redis client is configured with:
- Automatic reconnection with exponential backoff
- Maximum 3 retries per request
- Connection validation at startup (fail-fast if Redis is unavailable)

## Graceful Shutdown

When the server shuts down, the Redis connection is properly closed to avoid connection leaks.

## Local Development

For local development, you can run Redis using Docker:

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

Then configure your `.env`:
```bash
SESSION_STORE=redis
REDIS_URL=redis://localhost:6379
```

## Troubleshooting

### Connection Errors

If you see connection errors at startup:
1. Verify Redis is running and accessible
2. Check the `REDIS_URL` is correct
3. Ensure no firewall is blocking the connection

### Session Not Persisting

If sessions are not persisting across instances:
1. Verify all instances are using `SESSION_STORE=redis`
2. Ensure all instances are connecting to the same Redis instance
3. Check the `REDIS_PREFIX` is consistent across instances
