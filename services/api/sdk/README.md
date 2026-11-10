# @fliq/sdk

TypeScript client for the fliq payouts API. No runtime dependencies: it uses `fetch` and Web Crypto, so it runs on Node 20+, Bun, Deno and edge runtimes.

```
npm install @fliq/sdk
```

## Pay out and wait for the bank

```ts
import { FliqClient, FliqError } from "@fliq/sdk";

const fliq = new FliqClient({ apiKey: process.env.FLIQ_API_KEY!, baseUrl: process.env.FLIQ_API_URL });
const quote = await fliq.quote({ token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" });
const account = await fliq.verifyAccount({ bank: "058", number: "0123456789" });
console.log(`Paying ${account.account_name} ${quote.receive} NGN through ${quote.provider}`);
const payout = await fliq.createPayout({
  quote_id: quote.quote_id,
  account: { bank: "058", number: "0123456789" },
  account_name: account.account_name,
  // Your own address on the quote's source chain: a failed payout is refunded there.
  refund_address: "0xYourBaseAddress",
});
console.log(`Send ${payout.deposit.amount} USDC on ${payout.deposit.chain} to ${payout.deposit.address}`);
const done = await fliq.waitForPayout(payout.payout_id, { timeoutMs: 15 * 60_000 });
console.log(done.state, done.bank_reference);
```

`baseUrl` defaults to `https://api.fliq.cash/v1`; pass another one (for example a staging API) to override it.

`source_chain` is the chain your user sends the stablecoin from: `base`, `polygon` or `solana`. Leaving it out means `near`, which only a fliq vault can fund. `refund_address` is required for a payout funded on base, polygon or solana, and must be an address on that chain.

`createPayout` sends an `Idempotency-Key` header. It makes one up when you don't pass `{ idempotencyKey }`; pass your own (for example your order id) so a retry after a crash can't pay twice.

## Methods

| Method                                                               | API                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `quote(request)`                                                     | `POST /quotes`, every provider ranked; `routes[0]` is what a payout uses |
| `createPayout(request, { idempotencyKey? })`                         | `POST /payouts`                                                          |
| `getPayout(id)`                                                      | `GET /payouts/{id}`                                                      |
| `waitForPayout(id, { timeoutMs?, intervalMs?, signal?, onUpdate? })` | Polls `GET /payouts/{id}` until a final state                            |
| `listPayouts(filters?)`                                              | `GET /payouts`, one page; pass `next_cursor` as `cursor` for the next    |
| `getPayoutStats(timezone?)`                                          | `GET /payouts/stats`                                                     |
| `verifyAccount({ bank, number, country? })`                          | `POST /accounts/verify`                                                  |
| `institutions(country)`                                              | `GET /institutions?country=`                                             |
| `getRate(token, currency)`                                           | `GET /rates/{token}/{currency}`                                          |

Every failed call throws a `FliqError` with `status`, `code` and `message` from the API's error body. `error.quote` holds the fresh quote of a `quote_changed` error. `error.retryable` is true for network errors, 429 and 5xx.

Final payout states are `settled`, `refunded`, `expired`, `failed`, `refused` and `not_received` (`isFinalState`).

## Webhooks

Pass the raw request body, exactly as received, before any JSON parsing.

```ts
import { verifyWebhook } from "@fliq/sdk";

const event = await verifyWebhook(rawBody, request.headers, process.env.FLIQ_WEBHOOK_SECRET!);
```

It checks the `fliq-signature` header (HMAC-SHA256 over `<t>.<raw body>`), refuses a timestamp more than 300 seconds from your clock (`{ toleranceSeconds }` changes it) and throws `WebhookVerificationError` with a `reason`. During a secret rotation the API signs with both secrets, and you can pass an array of secrets too. Deliveries can arrive out of order and more than once: deduplicate by `event.id` and keep the highest `data.version` per payout.

A test sent to your endpoint from the dashboard arrives as a `test.webhook` event. It is signed and retried like any other event but names no payout, so answer it with a 2xx and do nothing else.

## Building

`pnpm build` (from `services/api/sdk`) compiles to `dist/` and copies the generated OpenAPI types from `spec/ts/openapi.ts` into `dist/openapi.d.ts`, so the published types don't depend on the private `@fliq/spec` package.

## Publishing

Publish by hand from `services/api/sdk` after `pnpm build`: `npm publish --access public`. npm provenance is not attached, because it can only be generated from a CI run, so the package page shows no provenance badge.
