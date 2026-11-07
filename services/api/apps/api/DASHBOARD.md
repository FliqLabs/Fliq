# Developer dashboard: which call backs which screen

Every route is under `/v1` and is described in [spec/openapi.yaml](../../../../spec/openapi.yaml), with example responses in [spec/fixtures](../../../../spec/fixtures). Types come from `@fliq/spec` (`spec/ts/openapi.ts`).

**Auth.** The dashboard sends the signed-in user's access token as `Authorization: Bearer <token>`. API keys (`rt_test_…`, `rt_live_…`) work only on rates, quotes, institutions, account verification and payouts; every dashboard-only route answers a key with `403 forbidden`.

**Errors.** Every error has the shape `{ "error": { "code": "...", "message": "..." } }`. Show `message` to the person and branch on `code`.

**Paging.** List calls return `next_cursor`. Send it back as `cursor`, together with the same filters, to get the next page. `null` means there are no more pages.

**Sandbox and live.** These are separate deployments, so the sandbox dashboard only ever sees sandbox keys, payouts and webhooks. `GET /workspaces/current/live-access` tells you which environment you are talking to.

## Payouts

| Screen or action | Call |
| --- | --- |
| History table | `GET /payouts?limit&cursor&status&provider&currency&from&to&q` |
| Status chips | `status` takes a comma-separated list of: `pending`, `paying_out`, `settled`, `refused`, `refunding`, `refunded`, `failed`, `expired`. Each item also has its own `status` field. |
| Search box | `q` matches a payout id or `client_reference` exactly. Recipient names cannot be searched: they are encrypted. |
| Cards | `GET /payouts/stats?tz=Africa/Lagos`. "Best rate now" has no backend yet (`/rates` is O17), so show it as unavailable. |
| Export CSV | `GET /payouts/export` with the same filters. It returns the newest 5000 rows. When the `x-export-truncated: true` header is set, ask the user to narrow the dates. |
| Detail and receipt | `GET /payouts/{payoutId}`, which includes the timeline (`history`), fees, provider, bank reference and seconds to bank. |
| Webhooks for this payout | `GET /webhook-deliveries?payout_id={payoutId}` |

Treat `pending` as in progress, never as failed. It includes payouts whose provider answer is still being checked.

## Create test payout drawer

All of these already exist and are the same calls an integrator makes.

1. **Banks.** `GET /institutions?country=ng` or `?country=ke`.
2. **Recipient check.** `POST /accounts/verify` with `{ bank, number }`. The server checks the account again when the payout is created, and that second check is the one that counts.
3. **Quote.** `POST /quotes` with `{ token: "usdc", currency: "ngn" | "kes", amount, source_chain }`. The response shows the provider, rate, fees, what the recipient receives, and `expires_in`.
4. **Submit.** `POST /payouts` with the `Idempotency-Key` header and `{ quote_id, account, client_reference?, refund_address? }`.
   - On success it returns `201` with `payout_id` and `state`.
   - A double submit with the same key returns the same answer.
   - An expired quote returns `422 quote_expired`.

In sandbox the provider is the built-in mock, so no money moves.

## Webhooks

| Screen or action | Call |
| --- | --- |
| Endpoint list | `GET /webhook-endpoints`. The response also carries `event_types` (for the subscription picker) and `signing` (for the verification snippet). |
| Add endpoint | `POST /webhook-endpoints` with `{ url, description?, events? }`. The response includes `secret`, shown only this once. URLs must be public https; anything else gets a `400` with a readable message. |
| Edit, enable or disable | `PATCH /webhook-endpoints/{id}` with `{ url?, description?, events?, enabled? }` |
| Delete | `DELETE /webhook-endpoints/{id}` |
| Rotate secret | `POST /webhook-endpoints/{id}/rotate-secret` with no body. The new `secret` is shown once, and the old one keeps working until `previous_secret_expires_at`. |
| Send test event | `POST /webhook-endpoints/{id}/test` with no body. It returns `delivery_id`; poll `GET /webhook-deliveries/{delivery_id}` until `status` is no longer `pending`. |
| Deliveries table | `GET /webhook-deliveries?endpoint_id&event_type&status&payout_id&from&to&limit&cursor` |
| Delivery detail | `GET /webhook-deliveries/{id}` returns the payload that was sent and `history`, one row per attempt. |
| Replay | `POST /webhook-deliveries/{id}/replay` with no body. It returns the new `delivery_id`, which keeps the same `event_id`. |

The routes with no body must be sent without a `content-type: application/json` header. Fastify refuses an empty JSON body.

The web components map onto the delivery fields like this:

| Component field | API field |
| --- | --- |
| `id` | `delivery_id` |
| `event` | `event_type` |
| `payoutId` | `payout_id` |
| `responseCode` | `response_status` |
| `createdAt` | `created_at` |
| `status` | `status` |
| `attempts` | `attempts` |

Replay and test events share a limit of 30 a minute per workspace. Past that the API returns `429 rate_limited`.

To verify a delivery, the receiver computes HMAC-SHA256 over `<t>.<raw body>` using the secret, hex-encodes it, and compares it with any `v1=` value in the `fliq-signature` header. It should reject `t` values more than 300 seconds from its clock, deduplicate on `fliq-event-id`, and keep the highest `data.version` per payout.

## API keys and Go live

| Screen or action | Call |
| --- | --- |
| Key list | `GET /keys`: masked key, name, status, `last_used_at` |
| Create key | `POST /keys` with `{ name, environment: "test" }`. The response has `key`, shown only this once. |
| Revoke | `DELETE /keys/{keyId}`. The key stops working at once. |
| Rotate | `POST /keys/{keyId}/rotate` returns a new `key`, shown once. The old key stops working at once. |
| Go live panel | `GET /workspaces/current/live-access`. `live_keys_allowed` is false for everyone until a KYB review exists. Asking for a live key gets `403 live_not_enabled`. |

## Usage

`GET /usage?days=7` (1 to 90 days) returns:

- `totals`: the counts for the whole period.
- `daily`: one entry per UTC day, including days with no traffic.
- `keys`: each key with its own counts.
- `rate_limit`: 300 requests a minute per key.

Only requests made with API keys are counted. Dashboard sessions are not.
