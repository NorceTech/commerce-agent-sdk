# Widget Embedding Guide

This document explains how to embed the Norce Commerce Agent widget into an existing webshop/storefront UI.

The SDK includes a reference **React widget example app** (`examples/commerce/react-widget-ui`). Partners typically **copy the widget component and supporting code** into their own storefront and wire it to their own styling, auth, and runtime configuration.

---

## What you embed

At minimum, you embed:
- the widget UI component (chat UI + cards)
- a small client for calling the Agent BFF (`/v1/chat` and/or `/v1/chat/stream`)
- optional helpers:
  - i18n language resolver (sv/en fallback)
  - image URL resolver for `thumbnailImageKey`
  - auth token provider (production mechanism or “Simple auth” in demos)

---

## Integration architecture

**Storefront (browser) → Agent BFF → (LLM + Norce MCP)**

- The widget runs in the customer’s browser.
- The widget calls the **Agent BFF**, not the Norce MCP directly.
- The Agent BFF holds Norce OAuth credentials and calls the MCP.

---

## Required configuration

Your storefront must provide:

### 1) Agent BFF URL
The base URL of the Agent BFF that will handle chat requests.

Examples:
- Local dev: `http://localhost:3000`
- Production: `https://agent.yourdomain.com`

### 2) Session identity
A stable `sessionId` is required for multi-turn conversations and reference resolution.

Recommendations:
- Use your existing anonymous session ID / cookie ID
- Or generate a UUID and store it in localStorage
- Keep it stable across page loads for a better UX

### 3) Commerce context
The widget should pass commerce context to the Agent BFF so the MCP returns correct prices, language, assortments, etc.

Typical context fields:
- `cultureCode` (e.g., `sv-SE`)
- `currencyCode` (e.g., `SEK`)
- optional: price list IDs, sales area, customer/company identifiers

> The BFF should tolerate missing context (pass through if present, do not guess).

### 4) UI language (optional override)
The widget can derive language from `cultureCode` (e.g., `sv-SE` → `sv`) or accept an explicit override like `uiLanguage: "sv"`.

Fallback must be English (`en`) for unsupported languages.

---

## Authentication: widget → BFF

### Production recommendation
Use your storefront’s existing auth model, e.g.:
- storefront backend issues a short-lived JWT for the widget
- session cookie + CSRF protection
- API gateway policies

### Demo option: “Simple auth”
If the Agent BFF exposes a demo JWT endpoint, the widget can request a short-lived token and send it to the BFF.

This is intended for:
- local dev
- partner demos

It is not recommended as a production approach.

---

## Request/response basics

### Non-streaming
`POST /v1/chat`

The widget sends:
- `sessionId`
- `message`
- `context` (optional but recommended)

The widget receives (typical):
- `text` (assistant message)
- `cards[]` (product cards, optional)
- optional: `variantChoices[]`, `comparison`, `cart`, etc.

### Streaming
`POST /v1/chat/stream`

The widget should:
- render incremental text
- show “status” events (“Searching products…”, “Comparing…”, etc.)
- handle tool-related progress messages
- handle a final event containing the same shape as `/v1/chat` (parity)

---

## Rendering product cards

The Agent BFF returns widget-friendly product cards (a small, stable subset of product fields). Common optional fields include:
- `variantName` (to clarify variant labeling)
- `thumbnailImageKey` (for showing a thumbnail image)
- availability summary (`onHand`, `availability.status`, etc.)

### Recommended label layout
- Primary: `title`
- Secondary (optional): `variantName` (if present and not duplicative)

### Thumbnail images (`thumbnailImageKey`)
`thumbnailImageKey` is a key, not necessarily a full URL.

Best practice is to provide a **resolver** function in your storefront:
- maps an image key to a full URL
- centralizes image/CDN rules

Example (pseudo):
```ts
resolveImageUrl(imageKey) => `${cdnBaseUrl}/${imageKey}`
````

The widget should:

* render the image in a fixed-size container
* use `object-fit: cover` to crop without changing card size
* fall back gracefully when missing/broken

---

## Variant selection

Some products require choosing a variant (size/color/etc.). Variant dimensions can be dynamic and are not limited to “Size” and “Color”.

The widget should:

* treat variant choices as a list of options with:

  * a display label
  * optional dimension map
* avoid hardcoding dimension names
* support simple selection UX (“Option 1”, “Option 2”, etc.)
* send the user’s selection back as a normal message (or as a structured action if your widget supports it)

---

## Compare mode (optional)

If enabled by the BFF, the widget may receive a compare block for 2–3 products.

Best practice:

* render a simple table (key → values per product)
* keep it read-only
* include a short summary text above or below

---

## Styling and layout guidance

### Layout

A common pattern is:

* assistant text in a “bubble” container (max width)
* cards rendered below in a full-width grid (not constrained to the bubble)

This allows 3–4 cards per row when space allows.

### Theme

If your widget supports light/dark mode:

* ensure secondary text (like `variantName`) has sufficient contrast in light mode
* use theme tokens or CSS variables (preferred) rather than hard-coded colors

---

## Minimal embed checklist

To embed successfully, you need:

* [ ] Agent BFF URL configured
* [ ] sessionId generation/storage
* [ ] context provider (culture/currency, optional extras)
* [ ] auth strategy (prod) or Simple auth (demo)
* [ ] image URL resolver for thumbnails
* [ ] i18n language selection (sv/en + fallback)


