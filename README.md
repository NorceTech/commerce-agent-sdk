# Norce Commerce Agent SDK

Open-source reference implementations for building **conversational shopping assistants** on top of **Norce Commerce** via the **Norce MCP Server**.

This repo is designed for solution partners who want to **copy an example, adapt it to a storefront**, and deploy a backend that connects an LLM-powered agent to Norce Commerce product discovery (and, over time, cart/checkout/management flows).

---

## What’s in this repo

### Examples (copy/adapt)
- `examples/commerce/nestjs-openai-agent-bff/`  
  A reference **Agent BFF** (Backend-for-Frontend) that exposes:
  - `POST /v1/chat` (non-streaming)
  - `POST /v1/chat/stream` (streaming)
  
  The BFF orchestrates:
  - an LLM (OpenAI by default)
  - the Norce Commerce MCP Server (product tools, cart tools, etc.)
  - session state (in-memory in early steps)

- `examples/commerce/react-widget-ui/`  
  A reference **Widget UI** implemented in React. Partners typically copy the widget component and supporting code into their storefront and wire it to their own auth, styling, and runtime config.

### Docs
- `docs/getting-started.md` — run locally (BFF + widget)
- `docs/architecture.md` — how the agent loop works
- `docs/widget-embedding.md` — how to embed the widget in a webshop

---

## Who this is for

- **Norce solution partners** building storefronts for merchants
- teams who want a working baseline for **agentic product discovery**
- developers who prefer a practical reference they can deploy and extend

---

## Architecture (high level)

**Widget UI → Agent BFF → (LLM + Norce MCP)**

- The widget runs in the browser and calls the Agent BFF.
- The Agent BFF holds Norce OAuth credentials and calls the MCP server.
- The agent loop is iterative (multiple tool calls per user turn) with guardrails.

See `docs/architecture.md` for details.

---

## Getting started

Run the examples locally:

- `docs/getting-started.md`

Quick overview:
1) Start the Agent BFF (one terminal / VS Code window)
2) Start the widget example app (second terminal / VS Code window)
3) The widget calls the local BFF, which calls the Norce MCP server over the internet

---

## Key concepts

### Agent BFF
The backend-for-frontend is responsible for:
- calling the LLM with tool definitions
- calling Norce MCP tools using server-side OAuth
- session state (conversation + working memory)
- enforcing guardrails (tool caps, confirmation gating for cart actions, etc.)

### Widget UI
The widget is responsible for:
- UX (chat, streaming status, cards, variant selection, compare mode)
- localization (sv/en + fallback)
- mapping thumbnail keys to real image URLs via a resolver hook (storefront-specific)

---

## Configuration notes

Each example includes its own `.env.example`. Do not commit real secrets.

Typical config includes:
- OpenAI API key + model
- Norce MCP base URL + application ID
- Norce OAuth token URL + client credentials
- CORS allowlist for local dev
- timeouts and retry behavior

See `docs/getting-started.md`.

---

## Extensibility roadmap

This repo is organized by domain under `examples/`:

- `examples/commerce/` (today)
- `examples/management/` (planned)
- `examples/checkout/` (planned)

Over time we’ll add:
- additional Agent BFF variants (frameworks/providers)
- more MCP tool coverage
- deeper widget UX features
- OTLP observability (later)

---

## License

MIT — see `LICENSE`.

---

## Contributing

See `CONTRIBUTING.md`.

If you’re a Norce solution partner and want to share an example or improvement, PRs are welcome.
