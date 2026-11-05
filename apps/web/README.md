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

## Live API integration

Copy `.env.example` to `.env.local` to override the backend URL. The web app calls the Render API through `/api/fliq/*` so browser requests stay on the same origin. Access and refresh tokens are stored in HTTP-only cookies; the proxy rotates the refresh token when the access token expires.

The connected screens cover passkey and email-link sign-in, name availability and claiming, workspace creation, profile editing, masked API keys, onboarding progress, and paginated payout listing. The sandbox key is shown once after workspace creation. Quote, account verification, payout submission, payout detail, and webhook replay remain disabled until their backend handlers are available.

Passkeys on a deployed `fliq.cash` site require the backend `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` to match that site. The current Render deployment returns `rpId: localhost`, which only supports local browser testing. The backend name-claim handler currently uses a mock NEAR provisioner, so it does not create an on-chain vault yet.
