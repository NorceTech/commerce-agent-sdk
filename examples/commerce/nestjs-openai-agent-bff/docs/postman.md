# Postman & cURL Examples

This document provides examples for testing the NC Commerce Agent API using Postman and cURL.

## Base URL

By default, the server runs on `http://localhost:3000`. Adjust the base URL according to your environment.

## Endpoints

### Health Check

Verify the server is running.

**cURL:**

```bash
curl -X GET http://localhost:3000/v1/health
```

**Expected Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-02T10:00:00.000Z"
}
```

### Chat Endpoint

The main conversational endpoint for interacting with the commerce agent.

**Endpoint:** `POST /v1/chat`

**Headers:**
- `Content-Type: application/json`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | string | Yes | Tenant identifier |
| `sessionId` | string | Yes | Session identifier for conversation continuity |
| `message` | string | Yes | User message/query |
| `context` | object | Yes | Commerce context for the request |
| `context.cultureCode` | string | No | Culture/locale code (e.g., "sv-SE") |
| `context.currencyCode` | string | No | Currency code (e.g., "SEK") |
| `context.priceListIds` | number[] | No | Array of price list IDs |
| `context.salesAreaId` | number | No | Sales area identifier |
| `context.customerId` | number | No | Customer identifier |
| `context.companyId` | number | No | Company identifier |

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `debug` | string | Set to "1" to include tool trace in response |

## Example: Product Search

Search for products using natural language.

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "demo",
    "sessionId": "session-001",
    "message": "Show me black sneakers",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK",
      "priceListIds": [1],
      "salesAreaId": 10
    }
  }'
```

**Postman Body (raw JSON):**

```json
{
  "applicationId": "demo",
  "sessionId": "session-001",
  "message": "Show me black sneakers",
  "context": {
    "cultureCode": "sv-SE",
    "currencyCode": "SEK",
    "priceListIds": [1],
    "salesAreaId": 10
  }
}
```

**Expected Response:**

```json
{
  "sessionId": "session-001",
  "text": "I found several black sneakers for you..."
}
```

## Example: Follow-up Query (Session Memory)

Continue a conversation using the same session ID. The agent remembers previous context.

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "demo",
    "sessionId": "session-001",
    "message": "the black one",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK",
      "priceListIds": [1],
      "salesAreaId": 10
    }
  }'
```

**Postman Body (raw JSON):**

```json
{
  "applicationId": "demo",
  "sessionId": "session-001",
  "message": "the black one",
  "context": {
    "cultureCode": "sv-SE",
    "currencyCode": "SEK",
    "priceListIds": [1],
    "salesAreaId": 10
  }
}
```

The agent will understand "the black one" refers to products from the previous query.

## Example: Debug Mode

Enable debug mode to see tool execution trace.

**cURL:**

```bash
curl -X POST "http://localhost:3000/v1/chat?debug=1" \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "demo",
    "sessionId": "session-002",
    "message": "Find me a dining table",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK",
      "priceListIds": [1],
      "salesAreaId": 10
    }
  }'
```

**Expected Response with Debug:**

```json
{
  "sessionId": "session-002",
  "text": "I found some dining tables for you...",
  "debug": {
    "toolTrace": [
      {
        "tool": "product_search",
        "args": {
          "query": "dining table"
        }
      }
    ]
  }
}
```

## Example: Get Product Details

Ask for details about a specific product.

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "demo",
    "sessionId": "session-003",
    "message": "Tell me more about product 12345",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK",
      "priceListIds": [1],
      "salesAreaId": 10
    }
  }'
```

## Streaming Endpoint (SSE)

The streaming endpoint provides real-time visibility into tool calls and partial assistant text using Server-Sent Events (SSE).

**Endpoint:** `POST /v1/chat/stream`

**Headers:**
- `Content-Type: application/json`

**Request Body:** Same as `/v1/chat`

**Response Headers:**
- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

### SSE Event Types

| Event | Description |
|-------|-------------|
| `status` | Processing status updates (e.g., "Processing round 1...") |
| `tool_start` | Emitted when a tool begins execution |
| `tool_end` | Emitted when a tool completes (success or failure) |
| `delta` | Partial assistant text (streamed tokens/segments) |
| `final` | Complete ChatResponse (same structure as `/v1/chat`) |
| `error` | Error event with category, code, and message |

### Example: Streaming Product Search

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/chat/stream \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "applicationId": "demo",
    "sessionId": "stream-session-001",
    "message": "Show me black sneakers",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK",
      "priceListIds": [1],
      "salesAreaId": 10
    }
  }'
```

Note: The `-N` flag disables buffering to see events in real-time.

**Expected SSE Response:**

```
event: status
data: {"message":"Starting conversation..."}

event: status
data: {"message":"Processing round 1..."}

event: tool_start
data: {"tool":"product_search","args":{"query":"black sneakers"}}

event: tool_end
data: {"tool":"product_search","ok":true,"resultSummary":{"itemCount":5,"totalCount":25}}

event: delta
data: {"text":"I found several black sneakers for you..."}

event: final
data: {"sessionId":"stream-session-001","text":"I found several black sneakers for you...","cards":[...]}
```

### Example: Streaming with Debug Mode

**cURL:**

```bash
curl -X POST "http://localhost:3000/v1/chat/stream?debug=1" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "applicationId": "demo",
    "sessionId": "stream-debug-001",
    "message": "Find me a dining table",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK",
      "priceListIds": [1],
      "salesAreaId": 10
    }
  }'
```

When debug mode is enabled, the `final` event includes `debug.toolTrace` with detailed tool execution information.

### Error Handling

The stream always terminates with either a `final` or `error` event.

**Error Event Example:**

```
event: error
data: {"category":"VALIDATION","code":"VALIDATION_REQUEST_INVALID","message":"Invalid request body"}
```

Note: If validation fails before the SSE stream is initialized, a standard JSON error response is returned instead (same as `/v1/chat`).

## Postman Collection

A Postman collection is available at `postman_collection.json` in the repository root. Import it into Postman and set the `baseUrl` variable to your server address.

### Importing the Collection

1. Open Postman
2. Click "Import" in the top left
3. Select the `postman_collection.json` file
4. The collection "NC Commerce Agent POC" will be added

### Setting Variables

After importing, configure the `baseUrl` variable:

1. Click on the collection name
2. Go to the "Variables" tab
3. Set `baseUrl` to your server address (default: `http://localhost:3000`)

## Error Responses

### Invalid Request (400)

```json
{
  "error": "Invalid request",
  "message": "applicationId: applicationId is required",
  "details": [...]
}
```

### Service Unavailable (503)

```json
{
  "error": "Service unavailable",
  "message": "AI agent is not configured. Please set OPENAI_API_KEY."
}
```

### Internal Server Error (500)

```json
{
  "error": "Internal server error"
}
```

## Simple Auth Token Endpoint (Partner Demos Only)

The Simple Auth token endpoint issues short-lived JWTs for widget authentication during partner demos. This endpoint is only available when `SIMPLE_AUTH_ENABLED=1` is set.

**Endpoint:** `POST /v1/auth/simple/token`

**Headers:**
- `Content-Type: application/json`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `applicationId` | string | Yes | Application identifier (must be in ALLOWED_APPLICATION_IDS) |

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | JWT token for authenticating with /v1/chat and /v1/chat/stream |
| `expiresInSeconds` | number | Token TTL in seconds (default: 600) |
| `sid` | string | Session identifier (UUID) for rate limiting |

### Example: Get Simple Auth Token

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/auth/simple/token \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "demo"
  }'
```

**Expected Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresInSeconds": 600,
  "sid": "550e8400-e29b-41d4-a716-446655440000"
}
```

### JWT Claims

The issued JWT contains the following claims:

| Claim | Description |
|-------|-------------|
| `iss` | Issuer: "norce-agent-bff" |
| `aud` | Audience: "norce-agent-widget" |
| `sid` | Session identifier (UUID) |
| `applicationId` | The application ID from the request |
| `iat` | Issued at timestamp |
| `exp` | Expiration timestamp |
| `scope` | Array of scopes: ["chat"] |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SIMPLE_AUTH_ENABLED` | No | "0" | Set to "1" to enable the Simple Auth token endpoint |
| `SIMPLE_AUTH_JWT_SECRET` | Yes (if enabled) | - | Secret for signing JWTs (min 32 characters) |
| `SIMPLE_AUTH_JWT_TTL_SECONDS` | No | 600 | Token TTL in seconds |

Note: The old `DEMO_AUTH_*` env vars are deprecated but still work as fallbacks. If both are set, `SIMPLE_AUTH_*` takes precedence.

### Error Responses

**403 Forbidden (Invalid applicationId):**

```json
{
  "error": {
    "category": "authz",
    "code": "AUTHZ_FORBIDDEN",
    "message": "applicationId 'invalid-app' is not in the allowed list",
    "requestId": "req-123"
  }
}
```

**400 Bad Request (Missing applicationId):**

```json
{
  "error": {
    "category": "validation",
    "code": "VALIDATION_REQUEST_INVALID",
    "message": "applicationId: applicationId is required",
    "requestId": "req-123"
  }
}
```

**404 Not Found (Endpoint disabled):**

When `SIMPLE_AUTH_ENABLED` is not set to "1", the endpoint returns 404.
