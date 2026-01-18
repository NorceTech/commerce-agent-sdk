# AGENTS.md — Agent BFF Execution Guidelines

This document provides execution guidelines for autonomous coding agents (like Devin) working in the Agent BFF repository. The Agent BFF is a conversational shopping assistant backend built with Node.js + TypeScript that integrates OpenAI (tool/function calling), Norce Commerce MCP Server, and session storage.

---

## Quick Start for Agents

### Commands

```bash
# Install dependencies
npm install

# Run dev server (hot reload)
npm run dev

# Run tests
npm test

# Run linting
npm run lint

# Build for production
npm run build

# Start production server
node dist/server.js

# Health check (after starting server)
curl http://localhost:3000/v1/health
```

### Key Entry Points

| File | Purpose |
|------|---------|
| `src/server.ts` | Fastify server initialization |
| `src/routes/chat.ts` | Main chat endpoints (`/v1/chat`, `/v1/chat/stream`) |
| `src/routes/chatHandler.ts` | Core request orchestration logic |
| `src/agent/agentRunner.ts` | Agent loop orchestrator (OpenAI + tools) |
| `src/agent/tools.ts` | Tool registry and definitions |
| `src/agent/toolHandlers.ts` | Product search/get tool handlers |
| `src/agent/cart/cartHandlers.ts` | Cart operation handlers |
| `src/session/sessionTypes.ts` | SessionState, WorkingMemory, CartState types |
| `src/session/ISessionStore.ts` | Session storage interface |
| `src/config.ts` | Environment configuration with Zod validation |
| `src/http/sse.ts` | Server-Sent Events writer for streaming |

### Request Contract

```typescript
// POST /v1/chat or /v1/chat/stream
{
  applicationId: string;  // Required: identifies the application
  sessionId: string;      // Required: identifies the conversation session
  message: string;        // Required: user's message
  context?: {             // Optional: caller-owned context
    cultureCode?: string;
    currencyCode?: string;
    priceListIds?: number[];
    salesAreaId?: number;
    customerId?: number;
    companyId?: number;
  }
}
```

### Response Contract

```typescript
interface ChatResponse {
  turnId: string;              // Required: unique identifier for this turn
  sessionId: string;           // Required: session identifier
  text: string;                // Required: always present, even if empty
  cards?: ProductCard[];       // Optional: product cards for display
  refinements?: Refinement[];  // Optional: structured refinement suggestions
  comparison?: ComparisonBlock;// Optional: product comparison data
  cart?: CartSummary;          // Optional: cart state after cart operations
  pendingAction?: PendingActionInfo; // Optional: awaiting user confirmation
  debug?: DebugInfo;           // Optional: only when debug mode enabled
  error?: ErrorEnvelope;       // Optional: error details if request failed
}
```

---

## Danger Zone / Foot-guns

### Tool Schemas

- OpenAI tool schemas MUST NOT include context fields. Context is caller-owned and injected server-side via `buildMcpArgs()`.
- If the model provides context in tool arguments, it MUST be ignored (defense in depth).
- Tool parameter schemas MUST be valid JSON Schema objects (`type: "object"`).

### Streaming SSE Parsing

- `/v1/chat/stream` final event MUST match `/v1/chat` response shape exactly (streaming parity).
- Stream MUST always terminate with either `final` or `error` event.
- SSE events use format: `event: <type>\ndata: <json>\n\n`
- Event types: `status`, `dev_status`, `tool_start`, `tool_end`, `delta`, `final`, `error`

### Session Key Rules

- Session keys MUST include applicationId: `${applicationId}:${sessionId}`
- Session storage MUST be behind `ISessionStore` interface (memory default, Redis optional)
- Do NOT refactor core agent logic in a way that blocks a later Redis store

### applicationId Usage

- `applicationId` comes from request body OR from Simple Auth JWT token (if enabled)
- If `ALLOWED_APPLICATION_IDS` is set, requests with unlisted applicationId are rejected (403)
- Never hardcode applicationId; always derive from request or auth context

### Never Log Secrets

- MUST NOT log: OAuth client secrets, access tokens, `Authorization` headers, `application-id` headers
- Redact any fields matching: `token`, `secret`, `password`, `apikey`, `authorization`
- Debug output MUST NOT include raw MCP payloads

### Cart Mutations Require Confirmation

- Cart mutation tools (`cart.addItem`, `cart.setItemQuantity`, `cart.removeItem`) MUST NOT execute immediately
- MUST create a `pendingAction` and wait for user confirmation
- `cart.get` is read-only and executes immediately without confirmation
- `cart.addItem` MUST use `partNo` (not `productId`) as the item identifier
- `clientIp` is required for `cart.addItem` and MUST be derived from HTTP request, never from model

### Variant Disambiguation

- If a product has multiple buyable variants, MUST ask user to choose before creating `pendingAction`
- Variant dimensions are generic (0..N); do NOT assume Size/Color
- Use `variant.isBuyable` and `stock.onHand` to determine buyability, not parent product flags

### Bounded Execution

- Agent loop MUST be bounded: max 6 rounds, max 3 tool calls per round (configurable)
- If bounds are hit, return a safe fallback response

### Image URLs

- Image URLs MUST be returned as relative URLs in the same format as returned from the Norce API
- Do NOT transform or make them absolute URLs

---

## Definition of Done (PR Checklist)

Before creating a PR, ensure:

1. **Tests pass**: `npm test` runs without failures
2. **Lint passes**: `npm run lint` runs without errors
3. **Build succeeds**: `npm run build` compiles without errors
4. **Streaming parity**: If modifying response shape, verify `/v1/chat` and `/v1/chat/stream` final event match
5. **No secrets logged**: Verify no tokens/secrets appear in logs or debug output
6. **Session abstraction preserved**: Changes don't bypass `ISessionStore` interface
7. **Tool scope preserved**: Only allowed tools: `product.search`, `product.get`, `cart.get`, `cart.addItem`, `cart.setItemQuantity`, `cart.removeItem`
8. **Cart confirmation flow**: Cart mutations still require user confirmation
9. **Context injection**: Context still comes from caller, never from model
10. **Docs updated**: Update `docs/postman.md` and example JSON if request/response shapes change

---

## When to Update AGENTS.md

Update this document when:

- API contract changes (request/response schemas)
- New MCP tools are added
- New environment variables are introduced
- Changes to response model or streaming events
- New constraints or invariants are established
- Architecture changes that affect agent execution

---

## Architecture Overview

### Agent Loop

The `AgentRunner` orchestrates the conversation loop with OpenAI:

1. Appends user message to conversation
2. Injects PRODUCT_MEMORY context if available
3. Injects resolver hint if deterministic resolution succeeds
4. Loops up to maxRounds times
5. Calls OpenAI with tool definitions
6. Executes any tool calls (up to maxToolCallsPerRound)
7. Appends tool outputs to conversation
8. Returns when no tool calls or bounds are hit

### Session Storage

- **Interface**: `ISessionStore` (get, set, touch, delete)
- **Implementations**: `InMemorySessionStore` (default), `RedisSessionStore` (optional)
- **Selection**: `SESSION_STORE` env var (`memory` or `redis`)
- **TTL**: Default 1 hour, configurable via `SESSION_TTL_SECONDS`
- **Key format**: `${applicationId}:${sessionId}`

### MCP Client Usage

- OAuth token fetched via client credentials and cached (refresh when < 60s remaining)
- MCP calls include: `Authorization: Bearer <token>`, `application-id: <ApplicationId>`
- MCP session ID stored in `SessionState.mcp.sessionId` and reused
- Initialize once per session: `initialize` then `notifications/initialized`

### Auth Model

- **Simple Auth** (partner demos only): When `SIMPLE_AUTH_ENABLED=1`, POST `/v1/auth/simple/token` issues short-lived JWTs
- JWT contains `applicationId` which overrides request body `applicationId`
- Simple Auth is disabled by default; use for partner demos only

---

## Adding New MCP Tools

1. Add tool name to `src/norce/mcpToolNames.ts`
2. Create handler in `src/agent/toolHandlers.ts` or appropriate subdirectory
3. Add tool definition in `src/agent/tools.ts` with Zod schema
4. If cart mutation, add to `isCartMutationTool()` in `src/agent/confirmation.ts`
5. Add display name in `src/agent/toolDisplayNames.ts`
6. Add tests for the new tool
7. Update this document if tool changes constraints

### Tool Schema Requirements

- Parameters MUST be Zod schemas
- Context fields MUST NOT be in the schema (injected server-side)
- Use `buildMcpArgs()` to inject context from `ToolContext`

---

## Streaming Parity

The `/v1/chat/stream` endpoint MUST maintain parity with `/v1/chat`:

| Aspect | /v1/chat | /v1/chat/stream |
|--------|----------|-----------------|
| Response type | JSON body | SSE events |
| Final response | Direct JSON | `final` event with same shape |
| Error response | JSON with error envelope | `error` event + `final` event with error |
| turnId | Required | Required in final event |
| cart | Included when available | Included in final event |

### SSE Event Types

- `status`: User-facing status messages
- `dev_status`: Developer-oriented status (only when `?debug=1`)
- `tool_start`: Tool begins execution
- `tool_end`: Tool completes execution
- `delta`: Partial assistant text
- `final`: Complete ChatResponse (terminal event)
- `error`: Error information

---

## Debugging / Troubleshooting

### Enable Debug Mode

- Set `DEBUG=1` in environment or pass `?debug=1` query parameter
- Debug mode enables: detailed tool traces, dev_status events, error details

### Debug Endpoints (dev-only)

When `DEBUG_RUNS_ENABLED=1`:

- `GET /v1/debug/runs` - List stored run summaries
- `GET /v1/debug/runs/:runId` - Get full run details
- `POST /v1/debug/replay/:runId` - Re-execute a stored run

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Cart add is silent no-op | Missing `clientIp` | Ensure `clientIp` is extracted from request headers |
| Variant not found | Using `productId` instead of `partNo` | Use `partNo` from variant for cart operations |
| Session not found | Wrong session key format | Ensure key is `${applicationId}:${sessionId}` |
| MCP init fails | Token expired or invalid | Check OAuth credentials and token caching |
| Tool schema error | Invalid JSON Schema | Ensure Zod schema converts to valid JSON Schema |

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `NORCE_MCP_BASE_URL` | Norce MCP API endpoint |
| `NORCE_OAUTH_TOKEN_URL` | OAuth token endpoint |
| `NORCE_OAUTH_CLIENT_ID` | OAuth client ID |
| `NORCE_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `NORCE_OAUTH_SCOPE` | OAuth scope |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `OPENAI_MODEL` | gpt-4o-mini | OpenAI model |
| `SESSION_STORE` | memory | Session store type (memory/redis) |
| `SESSION_TTL_SECONDS` | 3600 | Session TTL |
| `AGENT_MAX_ROUNDS` | 6 | Max agent loop rounds |
| `AGENT_MAX_TOOL_CALLS_PER_ROUND` | 3 | Max tool calls per round |
| `DEBUG` | 0 | Enable debug mode |
| `DEBUG_RUNS_ENABLED` | 0 | Enable debug run persistence |
| `SIMPLE_AUTH_ENABLED` | 0 | Enable Simple Auth for partner demos |
| `CORS_ORIGINS` | localhost:5173 | Allowed CORS origins |
| `NORCE_STATUS_SEED` | (empty) | Comma-separated availability statuses for product.search filtering |

---

## Commit/PR Conventions

### Branch Naming

- Feature: `devin/<timestamp>-<descriptive-slug>`
- Jira ticket: `<TICKET-ID>-<descriptive-slug>` (e.g., `PROD-1234-fix-cart-bug`)

### Commit Messages

- Use conventional commits: `type: description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Example: `docs: add/update AGENTS.md with agent execution guidelines`

### PR Requirements

- Run `npm test` and `npm run lint` before creating PR
- Include description of changes
- Reference any related Jira tickets
- Wait for CI checks to pass

---

## Execution Checklist for Autonomous Agents

When implementing or changing code:

1. Preserve tool scope (`product.search`, `product.get`, `cart.get`, `cart.addItem`, `cart.setItemQuantity`, `cart.removeItem`)
2. Do not bypass session abstraction (`ISessionStore`)
3. Ensure OAuth token caching with in-flight lock
4. Ensure MCP init occurs once per session and stores `mcp-session-id`
5. Context is expected from caller; never guess defaults; omit context if missing
6. Enforce bounded agent loop (rounds/tool calls)
7. Maintain structured response contract for `/v1/chat` and `final` SSE event
8. Enforce cart mutation confirmation policy (two-step pendingAction flow)
9. Mark `blockedByPolicy`, `pendingActionCreated`, `pendingActionExecuted` in toolTrace as appropriate
10. Add/adjust tests for every behavioral change
11. Run tests: `npm test`
12. Run lint: `npm run lint`
13. Update docs if request/response shapes change
