# Debug Run Persistence and Replay

This document describes the debug run persistence feature, which allows developers to inspect and replay chat requests during local development.

## Overview

The debug run persistence feature provides local-only, in-memory storage of chat request "runs" including request details, tool traces, timings, and final responses. This makes debugging and replay easy without requiring Redis or a database.

## Enabling Debug Runs

Debug runs are disabled by default. To enable them, set the following environment variable:

```bash
DEBUG_RUNS_ENABLED=1
```

Additional configuration options:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_RUNS_ENABLED` | `0` | Set to `1` to enable debug runs |
| `DEBUG_RUNS_MAX` | `200` | Maximum number of runs to store in the ring buffer |
| `DEBUG_RUNS_TTL_SECONDS` | `86400` | Time-to-live for runs in seconds (default: 24 hours) |

## Debug Endpoints

When debug runs are enabled, the following endpoints become available:

### List Runs

```
GET /v1/debug/runs?limit=50&applicationId=...&sessionId=...
```

Returns a list of run summaries in reverse chronological order.

Query parameters:
- `limit` (optional): Maximum number of runs to return (default: 50)
- `applicationId` (optional): Filter by applicationId
- `sessionId` (optional): Filter by session ID

Response:
```json
{
  "runs": [
    {
      "runId": "uuid",
      "createdAt": 1704312000000,
      "durationMs": 1234,
      "applicationId": "example-app",
      "sessionId": "session-123",
      "status": "ok",
      "toolCalls": 3,
      "textSnippet": "Here are some products..."
    }
  ],
  "total": 1
}
```

### Get Run Details

```
GET /v1/debug/runs/:runId
```

Returns the full run record including tool trace and OpenAI trace.

Response:
```json
{
  "runId": "uuid",
  "createdAt": 1704312000000,
  "durationMs": 1234,
  "route": "POST /v1/chat",
  "applicationId": "example-app",
  "sessionId": "session-123",
  "request": {
    "message": "Show me red shoes",
    "contextPresent": true,
    "contextSummary": {
      "cultureCode": "en-US",
      "currencyCode": "USD"
    }
  },
  "result": {
    "status": "ok",
    "httpStatus": 200,
    "textSnippet": "Here are some red shoes...",
    "responseShape": {
      "hasCards": true,
      "hasComparison": false,
      "toolCalls": 2
    }
  },
  "toolTrace": [
    {
      "t": 100,
      "tool": "product_search",
      "args": { "query": "red shoes" },
      "outcome": "ok",
      "durationMs": 500
    }
  ],
  "openaiTrace": {
    "rounds": 2,
    "model": "gpt-4o-mini"
  }
}
```

### Replay a Run

```
POST /v1/debug/replay/:runId
```

Replays a stored run by re-executing the same inputs through the existing chat handler. The output may differ slightly from the original run, but the tool trace and schema will still be valid.

Request body (optional overrides):
```json
{
  "message": "Optional override message",
  "context": {
    "cultureCode": "en-US"
  }
}
```

Response:
```json
{
  "originalRunId": "original-uuid",
  "newRunId": "new-uuid",
  "result": {
    "sessionId": "session-123",
    "text": "Response text...",
    "cards": []
  }
}
```

## What is Stored

The run record stores sanitized information only:

**Stored:**
- Run ID (UUID)
- Timestamps and duration
- Route (POST /v1/chat or POST /v1/chat/stream)
- ApplicationId and session ID
- User message (first 500 characters)
- Context summary (flags and counts, not full context)
- Result status and HTTP status
- Response text snippet (first 500 characters)
- Response shape (hasCards, hasComparison, toolCalls count)
- Tool trace with sanitized arguments
- OpenAI trace (rounds, model, finish reason)
- Errors (if any)

**NOT Stored:**
- OAuth tokens or access tokens
- Client secrets
- Request headers
- Full raw MCP payloads
- Full context objects
- Full conversation history
- Full OpenAI prompts

## Sanitization

All stored data is sanitized to prevent secret leakage:

- Sensitive keys are redacted: `authorization`, `client_secret`, `access_token`, `token`, `application-id`
- Strings are capped at 500 characters
- Object depth is limited to 3 levels
- Array length is limited to 20 items
- Context is summarized (counts and flags only)

## Security Note

This feature is intended for local development only and should NOT be enabled in production environments. The debug endpoints expose internal request details that could be sensitive.

When `DEBUG_RUNS_ENABLED` is not set or set to `0`, the debug routes are not registered and will return 404.

## Architecture

The implementation consists of:

1. **RunStore** (`src/debug/RunStore.ts`): In-memory ring buffer with TTL-based expiration
2. **Sanitization helpers** (`src/debug/sanitize.ts`): Functions to redact secrets and cap data sizes
3. **Run types** (`src/debug/runTypes.ts`): TypeScript types for run records
4. **Debug routes** (`src/routes/debugRoutes.ts`): Fastify routes for the debug endpoints
5. **Chat handler** (`src/routes/chatHandler.ts`): Extracted chat handling logic for reuse by replay

The trace persistence is orthogonal to session memory - stored traces are not attached to the agent conversation or prompt context.
