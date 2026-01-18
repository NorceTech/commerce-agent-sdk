# AGENTS.md - Widget Agent Execution Guidelines

This document provides guidelines for autonomous agents modifying the Commerce Shop Agent React Widget. The widget is an embeddable conversational UI component for e-commerce applications that communicates with an Agent Backend-for-Frontend (BFF) service via Server-Sent Events (SSE).

## Quick Start for Agents

### Install and Run

```bash
npm install
npm run dev      # Start Vite dev server on port 5173
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | TypeScript compile + Vite build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run preview` | Preview production build |

### Connecting to Agent BFF

The widget connects to the Agent BFF via the `endpoint` prop passed to `AgentWidget`. There is no `.env` file; all configuration is done through component props.

To point to a local BFF during development, configure the endpoint in the demo page (http://localhost:5173) or pass it directly to the widget:

```tsx
<AgentWidget
  endpoint="http://localhost:3000"  // Local BFF
  applicationId="your-app-id"
  getContext={() => ({ /* context */ })}
  getAuthToken={async () => "your-token"}
/>
```

The BFF must expose:
- `POST /v1/chat/stream` - SSE streaming endpoint for chat
- `POST /v1/auth/simple/token` - Token endpoint (used by demo page)

## Integration Contract Assumptions

### Required Props

| Prop | Type | Description |
|------|------|-------------|
| `endpoint` | `string` | Base URL of the Agent BFF |
| `applicationId` | `string` | Application identifier |
| `getContext` | `() => Promise<Record<string, unknown>> \| Record<string, unknown>` | Returns context data sent with each request |
| `getAuthToken` | `() => Promise<string>` | Returns bearer token for authentication |

### Optional Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `defaultOpen` | `boolean` | `false` | Initial visibility state |
| `title` | `string` | `"Assistant"` (localized) | Widget header title |
| `imageBaseUrl` | `string` | - | Base URL for resolving relative image URLs |
| `resolveImageUrl` | `(imageKey: string) => string` | - | Custom image URL resolver for thumbnails |
| `cultureCode` | `string` | - | Culture code (e.g., "sv-SE") for language derivation |
| `uiLanguage` | `string` | - | Direct language override ("sv" or "en") |

### ChatRequest Structure

```typescript
interface ChatRequest {
  applicationId: string;
  sessionId: string;
  message: string;
  context: Record<string, unknown>;
}
```

### ChatResponse Structure

```typescript
interface ChatResponse {
  turnId: string;      // Always present
  sessionId: string;   // Always present
  text: string;        // Always present
  cards?: ProductCard[];
  choices?: ChoiceSet;
  refinements?: RefinementAction[];
  comparison?: ComparisonBlock;
  cart?: CartSummary;
  error?: ErrorEnvelope;
  debug?: DebugBlock;
}
```

### Handling Optional Fields

When rendering structured blocks, always check for presence before rendering:
- `cards`: Render only if array exists and has length > 0
- `choices`: Render only if object exists
- `refinements`: Render only if array exists and has length > 0
- `comparison`: Render only if object exists
- `cart`: Render only if object exists
- `error`: Render ErrorBanner only if object exists

## Streaming Handling

The widget uses `@microsoft/fetch-event-source` for SSE communication. The stream client (`src/widget/streamClient.ts`) handles these event types:

| Event | Payload | Handler |
|-------|---------|---------|
| `delta` | `{ text: string }` | Append text incrementally to message |
| `final` | `ChatResponse` | Complete response with structured data |
| `error` | `{ error: ErrorEnvelope }` | Display error with optional retry |
| `status` | `{ message: string }` | Update status bar text |
| `tool_start` | `{ tool: string, displayName?: string }` | Show tool execution indicator |
| `tool_end` | `{ tool: string, ok: boolean, displayName?: string }` | Clear tool indicator, show result |

### Error Categories

```typescript
type ErrorCategory = 'validation' | 'auth' | 'upstream' | 'policy' | 'internal';
```

Errors with `retryable: true` should display a retry button.

## UI Invariants

### Product Card Layout

The cards grid uses CSS Grid with auto-fit to stretch across available width:

```css
.agent-widget-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
```

**Critical constraints:**
- Maximum 6 cards displayed at once (see `Cards.tsx` line 77: `cards.slice(0, 6)`)
- Card size must not change when adding thumbnails
- Grid should stretch to fill container width

### Thumbnail Images

Thumbnails are displayed at fixed 48x48px with cropping via `object-fit: cover`:

```css
.agent-widget-card-thumbnail {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
}

.agent-widget-card-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
```

**Image resolution priority:**
1. Custom `resolveImageUrl` prop callback
2. If URL starts with `http://` or `https://`, use as-is
3. Otherwise, join with `imageBaseUrl`

### Main Card Images

Main images use 100px fixed height with cover cropping:

```css
.agent-widget-card-image {
  height: 100px;
}

.agent-widget-card-image img {
  object-fit: cover;
}
```

### variantName Display

The variant name is displayed as a subtitle with sufficient contrast:

```css
.agent-widget-card-variant-name {
  font-size: 11px;
  color: #a0a0b0;  /* Light gray for dark theme contrast */
}
```

**Display rules (from `productLabel.ts`):**
- Show variantName only when:
  - It is not null/undefined
  - It is not empty or whitespace-only
  - It is not identical to the title

### Drawer Sizes

| Mode | Dimensions |
|------|------------|
| Compact | 400px x 600px (max: calc(100vw - 48px) x calc(100vh - 120px)) |
| Maximized | min(900px, 70vw) x min(900px, 85vh) |

### Theming

The widget uses a dark theme by default:
- Background: `#1a1a2e`
- Message bubbles: `#2a2a3e`
- Text: `#e0e0e0`
- Accent: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`

When modifying colors, ensure sufficient contrast ratios for accessibility.

## Internationalization (i18n)

### Setup

The widget uses `react-i18next` with the following configuration:
- Supported languages: `en` (English), `sv` (Swedish)
- Fallback language: `en`
- Namespace: `common`
- Translation files: `src/i18n/locales/{lang}/common.json`

### Language Resolution

Language is resolved in this order (see `resolveLanguage.ts`):
1. `uiLanguage` prop (if provided and supported)
2. First 2 characters of `cultureCode` prop (if supported)
3. Default: `en`

### Adding Translations

Never hardcode user-facing strings. Always use the `t()` function:

```tsx
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
// Use: t('widget.emptyState')
// Not: "How can I help you today?"
```

### Translation File Structure

```json
{
  "widget": { /* Widget UI strings */ },
  "actions": { /* Button labels */ },
  "messages": { /* Message templates with interpolation */ },
  "cart": { /* Cart-related strings */ },
  "comparison": { /* Comparison table strings */ },
  "error": { /* Error display strings */ },
  "availability": { /* Availability status strings */ }
}
```

When adding new strings:
1. Add to `src/i18n/locales/en/common.json`
2. Add corresponding translation to `src/i18n/locales/sv/common.json`
3. Use interpolation for dynamic values: `{{variable}}`

## Modifying Cards Rendering Safely

When modifying the Cards component (`src/widget/renderers/Cards.tsx`):

1. **Preserve grid layout**: Do not change `grid-template-columns` without testing responsive behavior
2. **Maintain thumbnail dimensions**: Keep 48x48px with `object-fit: cover`
3. **Keep max card limit**: The `slice(0, 6)` limit prevents UI overflow
4. **Use formatProductLabel**: For consistent title/variantName display
5. **Use availability utilities**: `getAvailabilityLabel`, `getAvailabilitySubtext`, `getAvailabilityTone`
6. **Preserve accessibility**: Maintain `aria-label` and `title` attributes

### Safe Modification Checklist

- [ ] Does the change preserve card dimensions?
- [ ] Is `object-fit: cover` maintained for images?
- [ ] Are new strings added to both en and sv translation files?
- [ ] Does the grid still stretch properly at different widths?
- [ ] Is variantName still readable (sufficient contrast)?

## Definition of Done Checklist

Before submitting changes, verify:

### Build and Lint
- [ ] `npm run build` passes without errors
- [ ] `npm run lint` passes without errors
- [ ] `npm run test` passes (if tests exist for modified code)

### Manual Smoke Test
1. Start the widget dev server (`npm run dev`)
2. Configure endpoint and applicationId in demo page
3. Send a test message and verify streaming works
4. Verify structured blocks render correctly (cards, choices, etc.)
5. Test retry functionality on errors

### Visual Checks
- [ ] Widget renders correctly in compact mode
- [ ] Widget renders correctly in maximized mode
- [ ] Cards display properly with and without images
- [ ] Thumbnail images are cropped correctly (not stretched)
- [ ] variantName is readable against dark background
- [ ] Availability badges show correct colors

### Responsive Layout
- [ ] Widget adapts to narrow viewports
- [ ] Cards grid reflows correctly at different widths
- [ ] No horizontal overflow in any component

### i18n Verification
- [ ] Test with `uiLanguage="en"` - all strings in English
- [ ] Test with `uiLanguage="sv"` - all strings in Swedish
- [ ] No hardcoded strings visible in UI
- [ ] Interpolated values display correctly

## File Structure Reference

```
src/
├── widget/                    # Core widget module
│   ├── AgentWidget.tsx        # Main component
│   ├── AgentWidget.css        # All widget styles
│   ├── streamClient.ts        # SSE communication
│   ├── types.ts               # TypeScript interfaces
│   ├── imageUrl.ts            # Image URL resolution
│   └── renderers/             # Structured content renderers
│       ├── Cards.tsx          # Product card grid
│       ├── Choices.tsx        # Choice buttons
│       ├── Refinements.tsx    # Refinement chips
│       ├── Comparison.tsx     # Comparison table
│       ├── Cart.tsx           # Cart summary
│       └── ErrorBanner.tsx    # Error display
├── i18n/                      # Internationalization
│   ├── index.ts               # i18n setup
│   ├── resolveLanguage.ts     # Language resolution
│   └── locales/
│       ├── en/common.json     # English translations
│       └── sv/common.json     # Swedish translations
├── utils/                     # Shared utilities
│   ├── availability.ts        # Availability formatting
│   └── productLabel.ts        # Product label formatting
└── demo/                      # Demo application
    ├── DemoPage.tsx           # Demo UI
    ├── config.ts              # Config persistence
    └── tokenClient.ts         # Demo token management
```
