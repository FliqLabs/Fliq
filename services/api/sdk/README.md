# @fliqlabs/sdk

The official TypeScript client for the **fliq payouts API**: send stablecoins (USDC, USDT) and have local currency arrive in a bank or mobile-money account.

- **One API, every licensed provider.** fliq asks every off-ramp provider for a price at the same time, picks the best route by amount received, reliability and speed, and returns one quote.
- **Non-custodial.** fliq never holds your users' money and never sets the exchange rate. The sender pays the provider of record directly, or through NEAR Intents when the chains differ.
- **No runtime dependencies.** Only `fetch` and Web Crypto, so it runs on Node 20+, Bun, Deno, Cloudflare Workers and other edge runtimes.
- **Fully typed.** Every request and response type comes from the API's OpenAPI spec.

```
npm install @fliqlabs/sdk
```

## Contents

1. [How a payout works](#how-a-payout-works)
2. [Get an API key](#get-an-api-key)
3. [Quick start](#quick-start)
4. [Where money can go](#where-money-can-go)
5. [The client](#the-client)
6. [Quotes](#quotes)
7. [Checking an account](#checking-an-account)
8. [Creating a payout](#creating-a-payout)
9. [Following a payout](#following-a-payout)
10. [Payout states](#payout-states)
11. [Errors](#errors)
12. [Webhooks](#webhooks)
13. [Other methods](#other-methods)
14. [Runtimes and TypeScript](#runtimes-and-typescript)

## How a payout works

1. **Quote.** You say how much stablecoin is sent, or how much local currency must arrive, and from which chain. fliq prices every provider and returns the best route, with a `quote_id` that holds for a short time (`expires_in` seconds).
2. **Check the account.** You ask the bank for the name on the account and show it to your user before any money moves.
3. **Create the payout.** fliq places the order with the provider of record and returns a **deposit instruction**: an amount, a chain and an address.
4. **Fund it.** Your user (or your app) sends exactly that amount to that address.
5. **Settle.** The provider pays the bank or mobile-money account. You follow it with `waitForPayout` or webhooks, and you get the bank's own reference when it lands.

If anything fails after the deposit, the stablecoin goes back to the `refund_address` you gave.

## Get an API key

Sign in at [fliq.cash](https://fliq.cash), create a workspace and copy a key from the dashboard.

| Key           | What it is                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `rt_test_...` | A sandbox key. Use it to build and test your integration.                                          |
| `rt_live_...` | A live key for real payouts. Live keys are available once your business passes verification (KYB). |

Keep the key on your server. Never ship it in a browser or mobile app.

## Quick start

```ts
import { FliqClient, FliqError } from "@fliqlabs/sdk";

const fliq = new FliqClient({
  apiKey: process.env.FLIQ_API_KEY!,
  // Optional. The SDK calls https://api-production-54e10.up.railway.app/v1 by default; set FLIQ_API_URL to point it elsewhere.
  baseUrl: process.env.FLIQ_API_URL,
});

// 1. Price 50 USDC sent from Base, paid out in Nigerian naira.
const quote = await fliq.quote({ token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" });
console.log(`${quote.provider} pays ${quote.receive} NGN, valid for ${quote.expires_in}s`);

// 2. Ask the bank whose account this is, and show the name to your user.
const account = await fliq.verifyAccount({ bank: "058", number: "0123456789" });
console.log(`Paying ${account.account_name} at ${account.institution}`);

// 3. Create the payout. A failed payout is refunded to your own address on the quote's chain.
const payout = await fliq.createPayout(
  {
    quote_id: quote.quote_id,
    account: { bank: "058", number: "0123456789" },
    account_name: account.account_name,
    refund_address: "0xYourBaseAddress",
  },
  { idempotencyKey: "order-1042" },
);

// 4. Send the deposit. 5. Wait for the bank.
console.log(`Send ${payout.deposit.amount} USDC on ${payout.deposit.chain} to ${payout.deposit.address}`);
const done = await fliq.waitForPayout(payout.payout_id, { timeoutMs: 15 * 60_000 });
console.log(done.state, done.bank_reference);
```

## Where money can go

| Currency | Country     | Payout to              |
| -------- | ----------- | ---------------------- |
| `ngn`    | Nigeria     | Bank account           |
| `kes`    | Kenya       | Bank account, M-Pesa   |
| `ghs`    | Ghana       | Mobile money           |
| `idr`    | Indonesia   | Bank account, e-wallet |
| `php`    | Philippines | Bank account, e-wallet |

Which corridors answer at a given moment depends on which providers are live. A corridor with no live provider answers with a `no_route` error, so check it rather than assuming. Use [`institutions(country)`](#other-methods) for the banks and wallets you can pay in a country.

**Tokens:** `usdc`, `usdt`. **Source chains:** `base`, `polygon`, `solana`. (`near` is the fliq vault and is paid from the fliq app or an agent, not with an API key.)

## The client

```ts
new FliqClient({ apiKey, baseUrl?, fetch? });
```

| Option    | Default                                          | What it does                                                           |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `apiKey`  | required                                         | Your `rt_test_...` or `rt_live_...` key, sent as a bearer token.       |
| `baseUrl` | `https://api-production-54e10.up.railway.app/v1` | The API to call. Include `/v1`.                                        |
| `fetch`   | global `fetch`                                   | Your own `fetch`, for tests, proxies or runtimes without a global one. |

Every method also takes an optional `{ signal }` (an `AbortSignal`) to cancel the request.

## Quotes

```ts
const quote = await fliq.quote({
  token: "usdc", // "usdc" | "usdt"
  currency: "kes", // the local currency that arrives
  amount: "100.00", // a decimal string, never a float
  source_chain: "polygon",
  payout_type: "bank", // or "mobile_money"
  mode: "send", // "send": amount is what is sent. "receive": amount is what must arrive.
});
```

The answer holds the best route (`quote.provider`, `quote.receive`, `quote.rate`, `quote.fees`), how long it holds (`expires_in`) and `quote.routes`: every provider that was asked, ranked, with its price, fees, speed and on-time record. `routes[0]` is the route a payout uses.

Money is always a decimal string in requests. Amounts in responses are in the units the field names say (for example `fees` in minor units of the local currency).

## Checking an account

```ts
const account = await fliq.verifyAccount({ bank: "058", number: "0123456789", country: "ng" });
// { account_name: "DARA OKONKWO", institution: "GTBank", bank: "058", number: "...", name_verified: true }
```

- **Show `account_name` to your user and let them confirm it** before you pay.
- Some banks and wallets can't return a name (common in Ghana, Indonesia and the Philippines). Then the API answers `account_name_required`: ask your user for the exact name and call again with `account_name`. The answer then says `name_verified: false`.
- An account the bank doesn't know answers `account_not_found`.

Bank codes come from `institutions(country)`. Each bank has one fliq code, whichever provider pays it.

## Creating a payout

```ts
const payout = await fliq.createPayout(
  {
    quote_id: quote.quote_id,
    account: { bank: "058", number: "0123456789" },
    account_name: account.account_name, // the name the bank returned, or the one your user typed
    refund_address: "0xYourBaseAddress", // required for base, polygon and solana
    client_reference: "order-1042", // optional: your own id, unique per workspace
  },
  { idempotencyKey: "order-1042" },
);
```

- **`refund_address`** is where the stablecoin goes back if the payout fails. It must be an address on the quote's source chain.
- **Idempotency.** `createPayout` always sends an `Idempotency-Key`. Pass your own (your order id is ideal) so a retry after a crash or a timeout returns the same payout instead of paying twice. Reusing a key with a different body answers `idempotency_mismatch`.
- **One quote, one payout.** A quote can fund only one payout; ask for a new quote for the next one.
- **The rate moved.** If the price changed too much since the quote, the API answers `quote_changed` and nothing is sent. `error.quote` holds a fresh quote to show your user.

The answer is the payout, including `payout.deposit`: send exactly `deposit.amount` of the token on `deposit.chain` to `deposit.address`, before the quote's provider window closes.

## Following a payout

```ts
const done = await fliq.waitForPayout(payout.payout_id, {
  timeoutMs: 15 * 60_000, // default 10 minutes
  intervalMs: 2_000, // default 2 seconds
  onUpdate: (p) => console.log(p.state),
  signal: controller.signal,
});
```

`waitForPayout` polls `getPayout` until a final state and retries network errors, rate limits and server errors on its own. For production, prefer [webhooks](#webhooks) and use `getPayout(id)` to read the latest state.

A payout carries its full story: `history` (every state with its time), `provider`, `provider_order`, `bank_reference` once settled, `seconds` from deposit to bank, and `failure` / `refund` details when something went wrong.

## Payout states

| State              | Meaning                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `created`          | Recorded; the provider order is being placed.                                                   |
| `provider_timeout` | The provider didn't answer in time; fliq is checking whether it has the order.                  |
| `awaiting_recon`   | Being reconciled with the provider.                                                             |
| `awaiting_deposit` | Waiting for the deposit described in `deposit`.                                                 |
| `deposit_seen`     | The deposit arrived on chain.                                                                   |
| `routing`          | Moving through NEAR Intents to the provider's chain.                                            |
| `with_provider`    | The provider has the funds.                                                                     |
| `paying_out`       | The provider is paying the bank.                                                                |
| `settled`          | **Final.** The money reached the account; see `bank_reference`.                                 |
| `refunding`        | The payout can't complete; the stablecoin is on its way back.                                   |
| `refunded`         | **Final.** The stablecoin went back to the refund address.                                      |
| `expired`          | **Final.** No deposit arrived in time. Nothing moved.                                           |
| `failed`           | **Final.** It did not go through; see `failure`.                                                |
| `refused`          | **Final.** Refused before anything moved (for example a limit).                                 |
| `not_received`     | **Final for polling.** Settled, but the recipient says it didn't arrive; support follows it up. |

`isFinalState(state)` and `FINAL_PAYOUT_STATES` tell you whether to stop waiting.

## Errors

Every failed call throws a `FliqError`:

```ts
try {
  await fliq.createPayout(request);
} catch (error) {
  if (error instanceof FliqError) {
    console.log(error.status, error.code, error.message, error.traceId);
    if (error.code === "quote_changed") showNewQuote(error.quote);
    if (error.retryable) retryLater(error.retryAfterSeconds);
  }
}
```

| Property            | What it holds                                                           |
| ------------------- | ----------------------------------------------------------------------- |
| `status`            | The HTTP status (0 for a network error).                                |
| `code`              | A stable, typed code: switch on this, not on the message.               |
| `message`           | A sentence you can log or show.                                         |
| `traceId`           | Quote it to fliq support.                                               |
| `retryable`         | True for network errors, `429` and `5xx`: the same call may work later. |
| `retryAfterSeconds` | From the `Retry-After` header on a rate limit.                          |
| `quote`             | Only for `quote_changed`: the fresh quote.                              |

Common codes: `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `no_route`, `quote_expired`, `quote_changed`, `route_unavailable`, `account_not_found`, `account_name_required`, `provider_rejected`, `velocity_limit`, `idempotency_key_required`, `idempotency_mismatch`, `conflict`, `rate_limited`, `live_not_enabled`, `internal`, plus the client-side `network_error`, `timeout` and `invalid_response`.

## Webhooks

Register an endpoint in the dashboard and fliq sends a signed event for every payout change. Verify each one with the **raw request body**, exactly as received, before any JSON parsing:

```ts
import { verifyWebhook, WebhookVerificationError } from "@fliqlabs/sdk";

// Express: app.post("/fliq", express.raw({ type: "application/json" }), handler)
async function handler(req, res) {
  try {
    const event = await verifyWebhook(req.body, req.headers, process.env.FLIQ_WEBHOOK_SECRET!);
    if (event.type !== "test.webhook") await savePayout(event.data);
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.status(400).send(error.reason);
    throw error;
  }
}
```

- **Signature.** The `fliq-signature` header is `t=<unix seconds>,v1=<hex>`: an HMAC-SHA256 of `<t>.<raw body>` with your endpoint's secret. `verifyWebhook` checks it in constant time.
- **Freshness.** A timestamp more than 300 seconds from your clock is refused (change it with `{ toleranceSeconds }`).
- **Secret rotation.** During a rotation fliq signs with both secrets; you can pass an array of secrets too.
- **Order and repeats.** Deliveries can arrive out of order and more than once: deduplicate by `event.id` and keep the highest `data.version` per payout.
- **Retries.** Answer with a 2xx quickly. Anything else is retried with backoff.
- **Test events.** The dashboard's "send test" arrives as `test.webhook`. It names no payout: answer 2xx and do nothing.

## Other methods

| Method                                                                    | Calls                           | Use it for                                                |
| ------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `institutions(country)`                                                   | `GET /institutions?country=`    | Banks and wallets you can pay in a country, with codes.   |
| `getRate(token, currency)`                                                | `GET /rates/{token}/{currency}` | The current best rate for a reference amount.             |
| `getPayout(id)`                                                           | `GET /payouts/{id}`             | One payout, as it is now.                                 |
| `listPayouts({ limit, cursor, status, provider, currency, from, to, q })` | `GET /payouts`                  | One page of history; pass `next_cursor` back as `cursor`. |
| `getPayoutStats(timezone?)`                                               | `GET /payouts/stats`            | Totals for a dashboard.                                   |

## Runtimes and TypeScript

- Works anywhere with `fetch` and Web Crypto: Node 20+, Bun, Deno, Cloudflare Workers, Vercel Edge.
- ESM only (`import`). On Node 22.12+ `require()` of ESM also works.
- All request and response types are exported, for example `Quote`, `Payout`, `PayoutState`, `VerifiedAccount`, `WebhookEvent`.

## Links

- Website and dashboard: [fliq.cash](https://fliq.cash)
- Source: [github.com/FliqLabs/Fliq](https://github.com/FliqLabs/Fliq/tree/main/services/api/sdk)
- AI agents: [`@fliqlabs/mcp`](https://www.npmjs.com/package/@fliqlabs/mcp) gives Claude, Cursor and Codex the same powers as tools.

MIT licence.
