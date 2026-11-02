# apps/web

One Next.js app serving the public site (landing, rate index, corridor pages, receipts, docs, status, pricing) and the developer dashboard (payouts, payout detail, webhooks, API keys, go live). Owner: Emmanuel.

Two domains, one Vercel project: the public site on `fliq.cash`, the dashboard on `app.fliq.cash`, routed by host in middleware.

## Scaffold (day 1)

```
pnpm create next-app@latest apps/web --ts --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

Then add `"@fliq/spec": "workspace:*"` to its dependencies, and `lint`, `typecheck` and `build` scripts so `make test-web` runs them.

Types: `import type { Quote, Payout } from "@fliq/spec"`. Fixtures for tests and empty states: `@fliq/spec/fixtures/*.json`.

The `/.well-known/apple-app-site-association` route must be live on the public domain from day 1; the iOS passkey flow depends on it.

Design source of truth: fliq Web Design v4 (Claude Design canvas).

## Libraries

| Library | Why |
| --- | --- |
| `@tanstack/react-query` | Submit waitlist requests and expose loading, success, and error states. |
| `zustand` | Keep the waitlist email draft in a small route-specific store. |
