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

The connected screens cover passkey and email-link sign-in, name availability and claiming, workspace creation, profile editing, masked API keys and usage, onboarding progress, payout stats and listing, CSV export, payout receipts, and webhook endpoints and deliveries. The sandbox key and webhook signing secret are shown once when created. The test payout drawer requests a quote, verifies the destination, and submits payouts only when the selected provider is the mock provider.

Passkeys on a deployed `fliq.cash` site require the backend `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` to match that site.

## NEAR key onboarding

The web claim flow creates a browser Ed25519 key pair and shows a recovery code before claiming a name. The private signing key is saved as a non-extractable `CryptoKey` in IndexedDB; the recovery code is shown once and never sent to the API. `POST /me/name` receives `{ name, public_key }` with a stable `Idempotency-Key`. A `202` response is retried with the same request and key. The full account name displayed by the page comes from `GET /names/{name}` so it follows the backend's configured NEAR root account.

Users can restore the signing key on a new browser with their recovery code. The web app checks that the recovered public key is a full-access key of their claimed account through a read-only NEAR RPC query before saving it. The backend contract should mark `public_key` required for production account creation; the current OpenAPI schema marks it optional.
