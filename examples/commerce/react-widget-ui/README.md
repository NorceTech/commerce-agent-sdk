# Commerce Shop Agent React Widget

A React-based widget for commerce shop agent interactions, built with Vite + TypeScript.

## Features

- **AgentWidget**: Placeholder component for shop agent interactions
- **DemoPage**: Interactive demonstration page
- Modern React 19 + TypeScript setup
- Fast development with Vite
- ESLint for code quality

## Dependencies

- `@microsoft/fetch-event-source`: For server-sent events handling
- `uuid`: For generating unique identifiers
- React 19 + TypeScript

## Getting Started

### Install dependencies

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

### Build

Build for production:

```bash
npm run build
```

### Lint

Run ESLint:

```bash
npm run lint
```

### Preview

Preview the production build:

```bash
npm run preview
```

## Project Structure

```
src/
├── widget/          # AgentWidget component
│   ├── AgentWidget.tsx
│   └── index.ts
├── demo/            # Demo page
│   ├── DemoPage.tsx
│   └── index.ts
├── i18n/            # Internationalization
│   ├── index.ts     # i18n setup and initialization
│   ├── resolveLanguage.ts  # Language resolution logic
│   └── locales/     # Translation files
│       ├── en/common.json
│       └── sv/common.json
├── App.tsx          # Main App component
├── main.tsx         # Application entry point
└── App.css          # Styles
```

## Localization (i18n)

The widget supports internationalization with Swedish (sv) and English (en) languages. English is the default fallback language.

### Setting the Language

There are two ways to set the widget language:

1. **Via cultureCode** (preferred): Pass a culture code when initializing the widget. The first two characters are used to determine the language.

```tsx
<AgentWidget
  endpoint="https://api.example.com"
  applicationId="your-app-id"
  cultureCode="sv-SE"  // Will use Swedish
  // ... other props
/>
```

2. **Via uiLanguage** (override): Directly specify the UI language. This takes precedence over cultureCode.

```tsx
<AgentWidget
  endpoint="https://api.example.com"
  applicationId="your-app-id"
  cultureCode="en-US"
  uiLanguage="sv"  // Will use Swedish, overriding cultureCode
  // ... other props
/>
```

### Supported Languages

- `en` - English (default/fallback)
- `sv` - Swedish

If an unsupported language is requested, the widget falls back to English.

### Adding a New Language

To add support for a new language:

1. Create a new translation file at `src/i18n/locales/{lang}/common.json`
2. Copy the structure from `src/i18n/locales/en/common.json`
3. Translate all values to the new language
4. Add the language code to `SUPPORTED_LANGUAGES` in `src/i18n/index.ts`

## License

MIT

