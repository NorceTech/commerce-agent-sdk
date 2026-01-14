# Architecture

This SDK demonstrates how to build an embeddable conversational shopping assistant on top of **Norce Commerce** using:

- **Widget UI** (frontend): embedded in a webshop/storefront
- **Agent BFF** (backend-for-frontend): orchestrates the agent loop and exposes `/v1/chat` + `/v1/chat/stream`
- **LLM provider** (e.g., OpenAI): tool-calling + reasoning
- **Norce Commerce MCP Server**: commerce tools like `product.search`, `product.get`, `cart.*`, etc.

The goal is to give solution partners a practical, production-minded reference implementation that is easy to copy, adapt, and extend.

---

## Components and responsibilities

### Widget UI (frontend)
**Responsibilities**
- Collect user messages and render responses
- Show structured UI elements: product cards, variant choices, compare tables, cart summaries
- Choose UI language (i18n) based on culture code / UI language
- Handle streaming UX (status events, progressive output)

**Does not**
- Call Norce MCP directly
- Store secrets or OAuth credentials
- Make authorization decisions

### Agent BFF (backend)
**Responsibilities**
- Provide a stable widget-facing API (`/v1/chat`, `/v1/chat/stream`)
- Maintain session state (conversation + working memory)
- Run the agent loop (multi-round tool-calling)
- Manage Norce OAuth tokens (server-side only)
- Call Norce MCP tools and normalize results into widget-ready structures
- Enforce guardrails (tool allowlists, confirmation gates, call limits)

**Does not**
- Render UI
- Depend on storefront implementation details beyond context parameters

### LLM provider (OpenAI or equivalent)
**Responsibilities**
- Generate assistant messages
- Decide when to call tools (tool-calling)
- Filter/refine product lists based on user intent

**Important**
- The model is not trusted to enforce policy; the Agent BFF must.

### Norce Commerce MCP Server
**Responsibilities**
- Expose commerce capabilities as tools (search, product details, cart operations, etc.)
- Apply Norce Commerce context (culture, currency, price lists, sales area, customer/company) when provided
- Enforce Norce-side authorization via OAuth token

---

## Data flow (high level)

1) **User → Widget UI**  
   User enters a message in the widget.

2) **Widget UI → Agent BFF**  
   Widget sends a request to `/v1/chat` or `/v1/chat/stream` with:
   - `sessionId`
   - `message`
   - `context` (culture/currency/price lists/sales area/customer/company, etc.)
   - (optional) widget auth token (Simple auth / production auth)

3) **Agent BFF → LLM**  
   Agent BFF sends:
   - conversation history (bounded)
   - working memory (shortlist, last presented products, pending actions, etc.)
   - tool definitions (`product.search`, `product.get`, `cart.*`, …)
   - policies (limits, confirmation rules)

4) **LLM → Agent BFF (tool calls)**  
   The model requests tool calls. The BFF validates and executes them.

5) **Agent BFF → Norce MCP Server**  
   The BFF:
   - fetches/refreshes Norce OAuth token (server-side)
   - calls MCP tool endpoints
   - normalizes results (cards, choices, cart summary) into a stable response schema

6) **Agent BFF → Widget UI**  
   Response returns:
   - assistant text
   - product cards / choices
   - optional compare table
   - cart summary (if enabled)
   - optional debug info (dev-only)

---

## The Agent Loop

The agent is iterative by design. A single user request often becomes multiple tool calls and refinement steps.

Typical loop per user turn:
1) Decide whether a tool call is needed
2) If yes:
   - call `product.search` with a **simple** query
   - filter results with the LLM and/or request enrichment via `product.get` (bounded)
3) Present a small set of options (3–6 cards)
4) Ask a clarifying question if needed (variant selection, constraints, etc.)
5) If user confirms an action (e.g., add to cart), execute it

### Guardrails
The Agent BFF enforces:
- **max rounds** per user turn (e.g., `AGENT_MAX_ROUNDS`)
- **max tool calls per round** (e.g., `AGENT_MAX_TOOL_CALLS_PER_ROUND`)
- tool allowlists (per “step” maturity)
- confirmation gating for mutations (`cart.addItem`, etc.)
- idempotency for confirms (avoid double-add on retries)

---

## Session and state model

Sessions exist to support multi-turn conversations and reference resolution (“the black one”, “option 2”).

A session typically stores:
- conversation turns (bounded history)
- MCP state (if MCP uses session-like state)
- working memory, such as:
  - `lastResults` (normalized products from last search)
  - `lastPresentedCards` (what the user saw)
  - `shortlist` (user-saved items)
  - `variantChoices` (active disambiguation set)
  - `pendingAction` (awaiting confirmation)

**Storage**
- In early steps, session storage can be in-memory with TTL.
- Redis can be added later behind the same session interface.

**Keys**
- Sessions are keyed by a stable identifier (commonly `applicationId + sessionId`, or `tenant + sessionId` depending on the repo’s current contract).

---

## Normalized response model (widget contract)

The BFF should return stable, widget-friendly structures rather than raw MCP payloads.

Examples of normalized output:
- `text`: assistant response
- `cards[]`: product cards for selection (may include `variantName`, `thumbnailImageKey`, availability, price)
- `variantChoices[]`: when multiple buyable variants exist (generic dimension labels)
- `comparison`: compare table for 2–3 products (read-only)
- `cart`: summary after cart actions (if enabled)
- `debug.toolTrace`: dev-only tool execution trace

A core rule: **streaming final payload should match non-stream payload** (parity).

---

## Search strategy (important)

Product search backends can be “naïve”. The agent should:
- use **simple keyword queries** (1–3 tokens) for `product.search`
- avoid “Google-style” queries with many constraints
- refine/filter after results are returned
- broaden once on empty results (bounded fallback)

---

## Authentication boundaries

### Norce OAuth (MCP access)
The Agent BFF holds Norce OAuth credentials and fetches tokens server-side. The widget never sees these secrets.

### Widget → BFF auth
For dev/demo, a lightweight JWT-based **Simple auth** may be available.
For production, use your storefront’s existing auth model (BFF-issued JWT, cookies, gateway policies, etc.).

---

## Extensibility

This SDK is designed to evolve:
- add more MCP tools over time (Management MCP, Checkout MCP)
- improve UI polish (widget as the “crowning jewel”)
- add new examples under `examples/<domain>/...`

