# Agent API payments

## Flow

1. The agent sends `GET /v1/demo/rates/usdc/ngn` with its Fliq agent headers.
2. Without a payment header, the demo API returns `402 Payment Required`.
3. The response contains:
   - `price`: `"10000"` USDC base units (1 cent)
   - `token_contract`: the approved USDC token account
   - `vault_account`: `fliq-vault.testnet`
   - `pay_to_address`: the registered NEAR account that receives the API payment
   - `order_id`: a unique vault order
   - `expires_at_ns`: a future timestamp within 24 hours
   - `payment_header`: `x-fliq-payment`
   - `payment_method`: instructions for a signed `payout(order_id, amount, deposit_address)` call
4. The backend registers the order through the relayer registration account using payer, amount, destination, expiry and corridor `API`.
5. The agent calls the vault's `payout(order_id, amount, deposit_address)` with at least 50 Tgas, using the agent NEAR account.
6. The agent retries the same request with `x-fliq-payment: <order_id>` (or the payout transaction hash).
7. The server waits briefly for the transfer callback, reads `get_receipt(order_id)`, and accepts only if the verified vault `transfer_state` is `dispatched`, the amount is exactly `"10000"` and the destination exactly matches `pay_to_address`.
8. The server atomically consumes the order in the database with a unique order-ID constraint and returns the live naira rate. A successful call creates an Activity row: `Agent paid $0.01 to Live Naira Rate`.

```text
Agent                       Demo API                        Relayer/Vault
  |                            |                                  |
  | GET /demo/rates           |                                  |
  |--------------------------->|                                  |
  |                            | register_order(...)              |
  |                            |-------------------------------> |
  | 402 price + order_id       |                                  |
  |<---------------------------|                                  |
  | payout(order_id, amount, address)                           |
  |------------------------------------------------------------>|
  |                            | get_receipt(order_id), poll      |
  | retry + payment header     |                                  |
  |--------------------------->|--------------------------------->|
  |                            | transfer_state=dispatched        |
  |                            | consume once                     |
  | 200 live rate              |                                  |
  |<---------------------------|                                  |
```

## Proposed behaviour

PROPOSED: The retry polls `get_receipt` for up to 5 seconds because the payout callback settles after the payout transaction. It retries every 250 milliseconds.

PROPOSED: If a payout is still `executing`, the response is a retryable `202` or `409` with code `payment_pending`. If the receipt is unknown or remains unconfirmed after polling, it is a clear retryable `payment_unconfirmed` error.

PROPOSED: An expired order is rejected and not consumed. The agent can call the endpoint again to receive a newly registered 402 order.

PROPOSED: A replayed order is refused by both the database unique constraint and the in-memory check. The first successful retry consumes it; later retries return `409 conflict` / `payment_order_reused`.

PROPOSED: Wrong amount or deposit address in the retry header is rejected as `payment_mismatch`; these values must match the registered order and the verified receipt.

PROPOSED: A failed payout has no dispatched receipt and is reported as `payment_failed` or remains retryable with `payment_unconfirmed`.

PROPOSED: If the same 402 order is retried concurrently, exactly one request atomically inserts the consumed-order row. The loser receives `payment_order_reused`.

PROPOSED: Chain refusals are read from the failed transaction and stored in `agent_refusals`. `POLICY_PER_PAYOUT_CAP`, `POLICY_DAILY_CAP`, `POLICY_COOLDOWN`, `POLICY_EXPIRED`, `POLICY_REVOKED`, and `AGENT_NOT_BOUND` are visible in Activity with reason labels.
