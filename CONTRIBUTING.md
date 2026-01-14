# Contributing

Thanks for your interest in contributing to the **Norce Commerce Agent SDK**!  
This repository is intended to be a practical, partner-friendly set of reference implementations that are easy to copy, adapt, and deploy.

## Scope and goals

We welcome contributions that:
- improve the example implementations (Agent BFF, widget UI)
- improve docs and onboarding
- add new examples under `examples/<domain>/...` (commerce / management / checkout)
- improve reliability, test coverage, and developer experience
- keep APIs and widget contracts stable and well-documented

We generally avoid contributions that:
- introduce heavy/complex dependencies without clear benefit
- break the widget-facing API contract without versioning/migration notes
- add provider/framework “opinions” that reduce reuse by partners

---

## Repository structure

- `examples/commerce/...` — Commerce agent examples (today)
- `examples/management/...` — planned
- `examples/checkout/...` — planned
- `docs/` — documentation

Each example should be runnable and self-contained:
- `README.md`
- `.env.example`
- `npm scripts` for dev/test/build (or equivalent)

---

## Development guidelines

### 1) Prefer additive changes
Partners often copy these examples. Avoid breaking changes when possible.
- Add new optional fields instead of renaming/removing fields.
- If a breaking change is necessary, document it clearly and (ideally) version the contract.

### 2) Keep secrets out of the repo
- Never commit real API keys, OAuth secrets, or tokens.
- Use `.env.example` and document new environment variables.

### 3) Maintain streaming/non-stream parity (Agent BFF)
If you change the response model:
- `/v1/chat` and the final payload of `/v1/chat/stream` should match in shape.
- If you add a new structured block (cards, compare, cart), add it consistently.

### 4) Avoid UI assumptions
Catalogs differ between merchants. UI logic should:
- not hardcode variant dimension names (e.g., not only “Size/Color”)
- tolerate missing optional fields (`variantName`, `thumbnailImageKey`, onHand/availability)
- keep accessibility and contrast in mind (light/dark mode)

### 5) Keep changes focused
Prefer small PRs that do one thing well:
- one feature or bug fix per PR
- include tests or a clear manual QA checklist

---

## Local setup

See:
- `docs/getting-started.md`

In short:
- run the Agent BFF in one terminal/VS Code window
- run the widget example app in another
- widget → local BFF → public Norce MCP

---

## Testing

Each example may have its own test commands. In general:
- Add/maintain unit tests for normalization, filtering, and resolver logic
- Add integration tests for `/v1/chat` and `/v1/chat/stream` behavior

Before opening a PR, please:
- run unit/integration tests for the example you changed
- verify the example still runs locally (if applicable)

---

## Making changes

### Branching
- Create a branch per change:
  - `feat/...`, `fix/...`, `docs/...`, `chore/...`

### Commit messages
Use clear, descriptive commits, e.g.:
- `feat(widget): add i18n (sv/en) with fallback`
- `fix(bff): broaden search once on empty results`
- `docs: add widget embedding guide`

---

## Pull Requests

### PR checklist
Include in your PR description:
- What changed and why
- Which example(s) are affected
- How to test (commands or steps)
- Any new env vars (and updates to `.env.example`)
- Any API contract changes (and whether they’re additive or breaking)

### Review expectations
We aim to keep examples:
- easy to understand
- safe by default (no accidental open proxy, no secrets in logs)
- stable for partners to copy/adapt

---

## Reporting issues

If you find a bug or have a feature request, please open an issue and include:
- which example(s) you’re using
- expected vs actual behavior
- minimal reproduction steps
- logs/tool traces (sanitize secrets)

---

## Security

If you believe you’ve found a security issue:
- do not open a public issue with sensitive details
- instead, contact Norce through your usual partner channel

---

## License

By contributing, you agree that your contributions will be licensed under the **MIT License** (see `LICENSE`).
