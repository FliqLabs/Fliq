# sQuiDbOb contract handoff

Branch: `sQuiDbOb-Orders-and-Payouts`

## What was built

| Method or area | File | What it does | Test evidence |
| --- | --- | --- | --- |
| `new` | `contracts/vault/src/lib.rs` | Stores owner, registration account, approved USDC token, 24-hour expiry limit, and 10-minute payout timeout; only the vault account itself may call it, and it can run only once. | Configuration and initialization authorization tests in `tests/contract.rs`. |
| `set_registration_account` | `lib.rs` | Lets only the owner rotate the registration account. | Owner and non-owner tests. |
| `get_config` | `lib.rs` | Read-only configuration view. | Used by configuration tests. |
| `register_order` | `lib.rs`, `orders.rs` | Authorizes the registration account, accepts `amount` as a U128 JSON string, validates fields and expiry, stores an immutable order, and emits `order_registered`. It does not reserve funds. | Registration, duplicate, field, expiry, authorization, JSON amount, and event tests. |
| `payout` | `lib.rs`, `orders.rs` | Accepts `order_id`, U128 JSON-string `amount`, and `deposit_address`; validates both against the stored order, asks the integration layer for policy approval, reserves funds, changes state before creating the USDC transfer, and calls the private callback. | Matching/mismatch arguments, duplicate, same-block, wrong caller, expiry, oversubscription, edge amount, JSON amount, and stored destination/amount tests. |
| `resolve_stuck_payout` | `lib.rs`, `orders.rs` | Owner-only recovery after the configured timeout; commits or releases the real vault reservation after an on-chain transfer check and emits `payout_executed`. | Owner, timeout, success, failure, late callback, and single-use tests. |
| `on_payout_complete` | `lib.rs`, `orders.rs` | Accepts only the contract's callback with exactly one result; commits on success or releases on failure; stale callbacks do nothing. | Success, failure, outsider, stale, and invariant tests. |
| `set_status` | `lib.rs`, `orders.rs` | Lets only the registration account report proposed branching backend progress, including `refused` and `not_received`. Replays are no-ops; it cannot change transfer state or balances. | Authorization, branching edges, terminal-state, replay, gating, receipt, balance, and event tests. |
| `recredit` | `lib.rs`, `orders.rs`, `integration.rs`, `vault.rs` | Registration-account boundary for Dapper's guarded one-time refund recredit. It requires an existing `Dispatched` order in `refunding` or `refunded`, an observed token balance, and delegates liability and double-credit checks to `Vault`. A successful `refunding` call sets backend status to `refunded`; verified transfer state stays `Dispatched`. | Real payout/refund, duplicate, unknown, oversized, non-Dispatched, and unrelated-balance tests. |
| `set_payout_timeout` | `lib.rs` | Lets only the owner change the U64-encoded stuck-payout timeout. | Owner and non-owner configuration tests. |
| `get_receipt` | `lib.rs`, `types.rs` | Shows the stored order, verified NEAR transfer state, backend status, refs, and update time as separate tracks. | Receipt separation and unknown-order tests. |
| `get_balance` | `lib.rs`, `integration.rs`, `vault.rs` | Read-only `vault::BalanceView` backed by Dapper's real ledger. | Dapper deposit/isolation/overflow tests and payout invariants. |
| `release_order` | `lib.rs`, `orders.rs` | Registration account or owner moves only a `Registered` order to terminal `Released`; no USDC is reserved or changed. | Authorization, balance, event, replay, payout, and order-ID reuse tests. |
| `get_storage_usage` | `lib.rs` | Read-only current storage usage in bytes for storage measurement. | Order-plus-receipt delta test. |
| Recredit read helpers | `orders.rs` | `order_exists`, `order_payer`, `order_amount`, and `order_transfer_state`. | Read-helper test. |
| Integration boundary | `integration.rs` | Routes balance, reservation, commit, and release operations to `Vault`; keeps policy lifecycle calls on the temporary policy module. | Dapper vault tests and payout tests. |

Current vault result: 39 unit tests and 57 order/integration tests passed with `--features testing`; the default `make test-contract` run passes 39 unit tests and 34 order/integration tests. The near-workspaces smoke test is present but ignored by default. The order-plus-receipt storage delta is 219 bytes in the unit environment.

The deploy workflow intentionally uses `without-init-call`. After deployment, initialize by sending `new(owner, registration_account, approved_usdc_token_contract)` from the vault account itself. The initializer is private and rejects calls from any other predecessor; initialization cannot be repeated.

The latest `origin/Contract` branch is included. Dapper change #79 was not yet present in `origin/Contract` during this sync, so no merge was performed. Its real `vault.rs` is wired through `integration.rs`; no incoming `policies.rs` exists, so policy calls remain on the temporary policy module.

## What is still a placeholder

Every marker below is intentional. Replace the temporary policy implementation only through `integration.rs`; do not make the stand-ins production custody or policy code.

### `contracts/vault/src/temp_policies.rs`

- Line 11: temporary pending-spend storage key. Aria replaces it with policy storage.
- Line 16: temporary payer-only policy check. Aria replaces it with the approved agent policy.
- Line 34: temporary pending-spend recording. Aria replaces it with authoritative pending-count/limit accounting.
- Lines 45, 50: temporary release and settle operations. Aria replaces them with its policy lifecycle operations.

### `OPEN` comments and decisions

- `contracts/vault/src/lib.rs`: provider allowlist is not implemented; backend must decide whether one is needed.
- `contracts/vault/src/receipts.rs:29`: event payload fields and version need backend approval.
- `contracts/vault/src/types.rs`: expiry and timeout currently follow NEAR block timestamp nanoseconds; the final unit is open.
- `contracts/vault/src/types.rs:42`: relayed-agent identity is open.
- `contracts/vault/docs/CONTEXT.md:7` and `contracts/vault/docs/DECISIONS.md`: the remaining open questions are order ID versus `po_` ID, corridor encoding, registration-account rotation, refs/status format, refund proof and recredit, daily limits, and event approval.

## What I need from the backend team

| Exact question | Why it matters | Default used now | File if different |
| --- | --- | --- | --- |
| Is `order_id` exactly the backend `po_` payout ID? | It determines idempotency and how receipts are joined to backend records. | Treats the supplied string as the canonical order key. | `contracts/vault/docs/DECISIONS.md`, `orders.rs`, API integration tests. |
| What exact `register_order` JSON does the backend send, and is amount an integer base-unit string? | Deserialization and amount safety must match the API contract. | Uses the confirmed argument order and integer base units represented as JSON strings. | `types.rs`, `lib.rs`, fixtures/API docs if needed. |
| What expiry unit is final? | Expiry checks and the 24-hour maximum depend on it. | Uses NEAR block timestamp nanoseconds. | `types.rs`, `orders.rs`, tests. |
| Which account registers orders and reports statuses, and how are its keys rotated? | A compromised or stale key could create orders or falsify backend progress. | One configured `registration_account`, owner-rotated. | `lib.rs`, `types.rs`, deployment docs. |
| What exact `refs` format and stored backend statuses are approved? | Refs are persisted and emitted; malformed or personal data must be rejected. | Branching proposed status transitions; refs are at most 256 ASCII identifier characters. | `orders.rs`, `types.rs`, `receipts.rs`, `contracts/vault/docs/DECISIONS.md`. |
| Which fields and version must each event carry? | Indexers and reconciliation depend on stable event schemas. | `fliq`, version `1.0.0`, with the current minimal payloads. | `receipts.rs`, event tests, `contracts/vault/docs/DECISIONS.md`. |
| Does the backend want a provider allowlist? | A missing allowlist could permit an unintended destination if the API is compromised. | No provider allowlist, because the spec does not define one. | `lib.rs`, `orders.rs`, `contracts/vault/docs/DECISIONS.md`. |
| Which testnet vault and mock USDC account IDs will be used? | Integration tests and deployment configuration need stable addresses. | The standalone mock crate is used locally; the configured token account is supplied at init. | `contracts/mock_usdc`, workspace tests, deployment docs. |
| What gas should relayers attach for `payout`? | Too little gas prevents the transfer or callback; too much changes relayer economics. | Requires at least 50 Tgas: 30 Tgas transfer plus 20 Tgas callback. | `orders.rs`, tests, relayer docs. |

## Dapper integration status

`integration.rs` now calls Dapper's real `Vault` methods for `reserve_for_order`, `commit_outflow`, `release_reservation`, `recredit_refund`, and `get_balance`. Order identity and verified state come from `orders.rs` read helpers before delegation. Refund proof and observed token-balance authority remain PROPOSED.

## What I need from Aria

Replace the temporary policy calls behind these `integration.rs` functions:

- `evaluate_payout(caller, payer, order_id, amount, corridor)`: return an explicit reason on rejection; approve only when the caller identity and daily/agent policy allow the payer's order.
- `release_pending(order_id)`: remove the pending policy spend after a failed transfer.
- `settle_pending(order_id)`: consume the pending policy spend after a successful transfer.

The open question is what identity is authoritative for a relayed agent call. The current small `PayoutCaller` struct carries only the predecessor account and has an `OPEN` marker for the eventual relayer/agent identity.

## Risks and gaps

- The temporary policy module is not a production authorization system.
- Recredit now exists behind Dapper's guarded liability checks, but incorrect refund proof or token-balance input could create value; backend approval and reconciliation controls remain required.
- Backend status is deliberately not proof of bank settlement.
- The refs character filter cannot prove that a value is not personal data.
- The near-workspaces test is a smoke harness and is ignored by default; the detailed checks use unit-test promise results.
- Cargo resolves the semver range to the current lockfile version; the manifest still expresses the repository's required near-sdk `5.17.2` compatibility range.
- Dapper's real `vault.rs` is active and its required `pub(crate)` methods are wired; Aria's production policy module is not present, so policy calls remain on `temp_policies.rs`.

## Readiness for checks belonging to this side

| Check | Status | Evidence |
| --- | --- | --- |
| Register only through the configured account | Done | Authorization and forged-caller tests pass. |
| Validate order ID, amount, corridor, destination, and expiry | Done | Validation and edge-value tests pass. |
| Never send an order twice | Done | Duplicate, same-block, terminal-state, and invariant tests pass. |
| Reserve before transfer and restore after failure | Done, real vault | Dapper vault tests and 48 feature-enabled order tests pass. |
| Callback is private and stale-safe | Done | Outsider, exact-result, failure, and stale callback tests pass. |
| Separate verified transfer state from backend status | Done | Receipt and status-gating tests pass. |
| Backend status branching and replay | Done, proposed | Tests pass; rules remain marked PROPOSED pending backend approval. |
| No value movement from `set_status` | Done | Transfer-state and balance-invariance tests pass. |
| Refund proof and `recredit` | PROPOSED | Dapper's real one-time recredit is wired behind order/state checks; refund proof and observed token-balance authority still need approval. |
| Dapper/Aria production integration | Dapper done, Aria pending | Real `vault.rs` is wired; policy calls still use `temp_policies.rs`. |
| Test-only credit absent from release build | Done | Release WASM check passes with `testing` enabled and debug assertions disabled. |
| Formatting and lint | Done | `cargo fmt --check` and strict clippy pass. |
