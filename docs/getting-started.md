# Getting Started

This repository contains the **Norce Commerce Agent SDK**: a reference **Agent BFF** (backend-for-frontend) that orchestrates an LLM + the Norce Commerce MCP Server, and a **React widget example** showing how to embed a conversational shopping assistant in a webshop UI.

Typical partner workflow:
- Run the examples locally to understand the integration
- Copy/adapt the widget into your storefront
- Deploy the Agent BFF as a container image

---

## Repository layout

- `examples/commerce/nestjs-openai-agent-bff/`  
  Reference Agent BFF (REST + streaming) that talks to OpenAI and the Norce Commerce MCP Server.

- `examples/commerce/react-widget-ui/`  
  Example React app hosting an embeddable widget UI.

- `docs/`  
  Additional documentation.

---

## Prerequisites

### Required
- Node.js (LTS recommended)
- npm (or pnpm/yarn if the repo uses it)
- OpenAI API key
- Norce MCP endpoint URL
- Norce OAuth credentials (owned by the Agent BFF)

### Helpful
- Two VS Code windows (one for the BFF, one for the widget app)
- Docker (for building/running the Agent BFF container image)

---

## 1) Run locally

You will run two processes:
1) the **Agent BFF** locally
2) the **Widget example app** locally

The widget calls the local Agent BFF, which in turn calls the **Norce MCP Server** over the internet.

---

## 1.1 Start the Agent BFF

Open a terminal in:

`examples/commerce/nestjs-openai-agent-bff/`

Install dependencies:

```bash
npm install
````

Create your `.env`:

```bash
cp .env.example .env
```

Fill in the required values in `.env`.

### Agent BFF configuration (`.env`)

Here is what the current `.env.example` contains (summarized by category):

#### Server

* `PORT=3000`

#### OpenAI

* `OPENAI_API_KEY=...`
* `OPENAI_MODEL=gpt-4o-mini`

#### Norce MCP

* `NORCE_MCP_BASE_URL=https://customer-slug.api-se.norce.tech/mcp/commerce`

#### Norce OAuth

* `NORCE_OAUTH_TOKEN_URL=https://customer-slug.api-se.norce.tech/identity/1.0/connect/token`
* `NORCE_OAUTH_CLIENT_ID=...`
* `NORCE_OAUTH_CLIENT_SECRET=...`
* `NORCE_OAUTH_SCOPE=prod`

#### Optional agent/runtime limits

* `SESSION_TTL_SECONDS=1800`
* `AGENT_MAX_ROUNDS=6`
* `AGENT_MAX_TOOL_CALLS_PER_ROUND=3`
* `DEBUG=0`

#### OpenAI timeouts & retries

* `OPENAI_TIMEOUT_MS=120000`
* `OPENAI_STREAM_TIMEOUT_MS=300000`
* `OPENAI_MAX_RETRIES=2`
* `OPENAI_STREAM_MAX_RETRIES=0`
* `OPENAI_SDK_DEBUG=0`

#### Debug runs (local-only)

* `DEBUG_RUNS_ENABLED=0`
* `DEBUG_RUNS_MAX=200`
* `DEBUG_RUNS_TTL_SECONDS=86400`

#### Demo auth 

* `DEMO_AUTH_ENABLED=0`
* `DEMO_JWT_SECRET=...` (min 32 chars)
* `DEMO_JWT_TTL_SECONDS=600`

#### CORS

* `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`

Start the server:

```bash
npm run dev
```

You should see logs indicating the server is listening on `http://localhost:3000` (or your configured port).

### Sanity test (REST)

Try a chat call using curl (adjust host/port if needed):

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "1234",
    "sessionId": "local-dev",
    "message": "Show me slippers",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK"
    }
  }'
```

### Sanity test (streaming)

If your BFF exposes streaming:

```bash
curl -N -X POST http://localhost:3000/v1/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId": "1234",
    "sessionId": "local-dev",
    "message": "Show me slippers",
    "context": {
      "cultureCode": "sv-SE",
      "currencyCode": "SEK"
    }
  }'
```

---

## 1.2 Start the widget example app

Open a second terminal in:

`examples/commerce/react-widget-ui/`

Install dependencies:

```bash
npm install
```

Create `.env` if the example provides one:

```bash
cp .env.example .env
```

Configure the widget app to call your local Agent BFF. Common patterns:

* `VITE_AGENT_BFF_URL=http://localhost:3000`
* or a config file / constant in the example app

Start the widget:

```bash
npm run dev
```

Open the printed URL (often `http://localhost:5173`).

---

## 2) How the pieces connect

At runtime:

1. **Widget UI** sends user messages to the **Agent BFF** (`/v1/chat` or `/v1/chat/stream`)
2. **Agent BFF** calls:

   * **OpenAI** (tool-calling loop)
   * **Norce MCP** (`NORCE_MCP_BASE_URL`) using OAuth2 token from `NORCE_OAUTH_*`
3. **Agent BFF** returns:

   * assistant text
   * product cards (e.g., `thumbnailImageKey`, `variantName`, availability, etc. depending on your current BFF version)
   * optional structured UI hints (choices/refinements)

---

## 3) Docker: build & run the Agent BFF container

Once the Agent BFF has a `Dockerfile`, you can build and run it as a container image.

From `examples/commerce/nestjs-openai-agent-bff/`:

### Build

```bash
docker build -t norce-agent-bff:local .
```

### Run

```bash
docker run --rm -p 3000:3000 --env-file .env norce-agent-bff:local
```

---

## 4) Simple auth (optional)

The Agent BFF includes a lightweight JWT-based auth mechanism intended for **local development and simple demos**. It allows a frontend (or demo host app) to request a short-lived token and use it when calling the chat endpoints.

This is **not** a recommended production setup. In production, you should integrate the agent behind your webshop’s existing authentication/authorization model (BFF-issued JWT, session cookies, API gateway, etc.). Still, Simple auth is better than running the agent fully open.

### Enable

Set the following in the Agent BFF `.env`:

- `SIMPLE_AUTH_ENABLED=1`
- `SIMPLE_JWT_SECRET=...` (at least 32 characters)
- (optional) `SIMPLE_JWT_TTL_SECONDS=600`

### Use

1) Request a token:

- `POST /v1/demo/token`

2) Call the agent endpoints using the token (exact header depends on the example implementation; typically `Authorization: Bearer <token>`):

- `POST /v1/chat`
- `POST /v1/chat/stream`

> Tip: keep Simple auth enabled only for demo environments, and make sure the BFF is not publicly exposed without additional protections (origin allowlist, rate limiting, gateway rules, etc.).


---

## 5) Troubleshooting

### CORS errors in the browser

Add the widget dev server origin to `CORS_ORIGINS` in the BFF `.env`, e.g.:

* `http://localhost:5173`
* `http://127.0.0.1:5173`

Then restart the BFF.

### MCP auth errors (401/403)

* Verify `NORCE_OAUTH_TOKEN_URL`, `NORCE_OAUTH_CLIENT_ID`, `NORCE_OAUTH_CLIENT_SECRET`, `NORCE_OAUTH_SCOPE`
* Verify the OAuth client is permitted to access the configured `NORCE_APPLICATION_ID`

### Search returns “no results”

The underlying product search may be simple. The agent may need to issue short keyword queries and then refine/filter with the LLM. (See `docs/architecture.md` / agent policies if present.)

---

## Next steps

* `docs/architecture.md` — agent loop and data flow
* `docs/api-contract.md` — `/v1/chat` and `/v1/chat/stream` schemas/events
* `docs/widget-embedding.md` — how partners copy/adapt the widget into their storefront

