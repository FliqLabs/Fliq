# sQuiDbOb contract handoff

Branch: `sQuiDbOb-Orders-and-Payouts`

## What was built

| Method or area | File | What it does | Test evidence |
| --- | --- | --- | --- |
| `new` | `contracts/vault/src/lib.rs` | Stores owner, registration account, approved USDC token, and 24-hour expiry limit; only the vault account itself may call it, and it can run only once. | Configuration and initialization authorization tests in `tests/contract.rs`. |
| `set_registration_account` | `lib.rs` | Lets only the owner rotate the registration account. | Owner and non-owner tests. |
| `get_config` | `lib.rs` | Read-only configuration view. | Used by configuration tests. |
| `register_order` | `lib.rs`, `orders.rs` | Authorizes the registration account, validates fields and expiry, stores an immutable order, and emits `order_registered`. It does not reserve funds. | Registration, duplicate, field, expiry, authorization, and event tests. |
| `payout` | `lib.rs`, `orders.rs` | Checks the stored order, asks the integration layer for policy approval, reserves funds, changes state before creating the USDC transfer, and calls the private callback. | Happy path, duplicate, same-block, wrong caller, expiry, oversubscription, edge amount, and stored destination/amount tests. |
| `on_payout_complete` | `lib.rs`, `orders.rs` | Accepts only the contract's callback with exactly one result; commits on success or releases on failure; stale callbacks do nothing. | Success, failure, outsider, stale, and invariant tests. |
| `set_status` | `lib.rs`, `orders.rs` | Lets only the registration account report monotonic backend progress. Replays are no-ops; it cannot change transfer state or balances. | Authorization, unknown values, replay, backward, gating, receipt, balance, and event tests. |
| `recredit` | `lib.rs` | Deliberately disabled until refund design approval. | Existing disabled-path behavior. |
| `get_receipt` | `lib.rs`, `types.rs` | Shows the stored order, verified NEAR transfer state, backend status, refs, and update time as separate tracks. | Receipt separation and unknown-order tests. |
| `get_balance` | `lib.rs`, `integration.rs`, `vault.rs` | Read-only `vault::BalanceView` backed by Dapper's real ledger. | Dapper deposit/isolation/overflow tests and payout invariants. |
| Recredit read helpers | `orders.rs` | `order_exists`, `order_payer`, `order_amount`, and `order_transfer_state`. | Read-helper test. |
| Integration boundary | `integration.rs` | Routes balance, reservation, commit, and release operations to `Vault`; keeps policy lifecycle calls on the temporary policy module. | Dapper vault tests and payout tests. |

Current vault result: 40 tests passed, 0 failed with `--features testing`; the default `make test-contract` run passes 29 tests. The near-workspaces smoke test is present but ignored by default. The standalone mock USDC crate builds and its test target has 0 tests and 0 failures.

The deploy workflow intentionally uses `without-init-call`. After deployment, initialize by sending `new(owner, registration_account, approved_usdc_token_contract)` from the vault account itself. The initializer is private and rejects calls from any other predecessor; initialization cannot be repeated.

The latest `origin/Contract` branch was merged into this branch. Its real `vault.rs` is wired through `integration.rs`; no incoming `policies.rs` exists, so policy calls remain on the temporary policy module.

## What is still a placeholder

Every marker below is intentional. Replace the temporary policy implementation only through `integration.rs`; do not make the stand-ins production custody or policy code.

### `contracts/vault/src/temp_vault.rs`

Retained as an unused historical fallback only. Runtime custody and reservation operations no longer call it; `vault.rs` is the single source of truth for balances.

### `contracts/vault/src/temp_policies.rs`

- Line 11: temporary pending-spend storage key. Aria replaces it with policy storage.
- Line 16: temporary payer-only policy check. Aria replaces it with the approved agent policy.
- Line 34: temporary pending-spend recording. Aria replaces it with authoritative pending-count/limit accounting.
- Lines 45, 50: temporary release and settle operations. Aria replaces them with its policy lifecycle operations.

### `OPEN` comments and decisions

- `contracts/vault/src/lib.rs:37`: provider allowlist is not implemented; backend must decide whether one is needed.
- `contracts/vault/src/receipts.rs:29`: event payload fields and version need backend approval.
- `contracts/vault/src/types.rs:10`: expiry currently follows NEAR block timestamp nanoseconds; the final unit is open.
- `contracts/vault/src/types.rs:42`: relayed-agent identity is open.
- `docs/CONTEXT.md:7` and `docs/DECISIONS.md`: the remaining open questions are order ID versus `po_` ID, corridor encoding, registration-account rotation, refs/status format, refund proof and recredit, daily limits, and event approval.

## What I need from the backend team

| Exact question | Why it matters | Default used now | File if different |
| --- | --- | --- | --- |
| Is `order_id` exactly the backend `po_` payout ID? | It determines idempotency and how receipts are joined to backend records. | Treats the supplied string as the canonical order key. | `docs/DECISIONS.md`, `orders.rs`, API integration tests. |
| What exact `register_order` JSON does the backend send, and is amount an integer base-unit string? | Deserialization and amount safety must match the API contract. | Uses the confirmed argument order and integer base units represented as JSON strings. | `types.rs`, `lib.rs`, fixtures/API docs if needed. |
| What expiry unit is final? | Expiry checks and the 24-hour maximum depend on it. | Uses NEAR block timestamp nanoseconds. | `types.rs`, `orders.rs`, tests. |
| Which account registers orders and reports statuses, and how are its keys rotated? | A compromised or stale key could create orders or falsify backend progress. | One configured `registration_account`, owner-rotated. | `lib.rs`, `types.rs`, deployment docs. |
| What exact `refs` format and stored backend statuses are approved? | Refs are persisted and emitted; malformed or personal data must be rejected. | Monotonic `BACKEND_STATUSES`; refs are at most 256 ASCII identifier characters. | `orders.rs`, `types.rs`, `receipts.rs`, `docs/DECISIONS.md`. |
| Which fields and version must each event carry? | Indexers and reconciliation depend on stable event schemas. | `fliq`, version `1.0.0`, with the current minimal payloads. | `receipts.rs`, event tests, `docs/DECISIONS.md`. |
| Does the backend want a provider allowlist? | A missing allowlist could permit an unintended destination if the API is compromised. | No provider allowlist, because the spec does not define one. | `lib.rs`, `orders.rs`, `docs/DECISIONS.md`. |
| Which testnet vault and mock USDC account IDs will be used? | Integration tests and deployment configuration need stable addresses. | The standalone mock crate is used locally; the configured token account is supplied at init. | `contracts/mock_usdc`, workspace tests, deployment docs. |
| What gas should relayers attach for `payout`? | Too little gas prevents the transfer or callback; too much changes relayer economics. | Requires at least 50 Tgas: 30 Tgas transfer plus 20 Tgas callback. | `orders.rs`, tests, relayer docs. |

## Dapper integration status

`integration.rs` now calls Dapper's real `Vault` methods for `reserve_for_order`, `commit_outflow`, `release_reservation`, and `get_balance`. All required methods are `pub(crate)` and no additional exposure is needed. The integration layer also owns `release_pending` and `settle_pending`, which remain coordinated with the temporary policy implementation. Recredit stays disabled until refund proof and reconciliation are approved.

## What I need from Aria

Replace the temporary policy calls behind these `integration.rs` functions:

- `evaluate_payout(caller, payer, order_id, amount, corridor)`: return an explicit reason on rejection; approve only when the caller identity and daily/agent policy allow the payer's order.
- `release_pending(order_id)`: remove the pending policy spend after a failed transfer.
- `settle_pending(order_id)`: consume the pending policy spend after a successful transfer.

The open question is what identity is authoritative for a relayed agent call. The current small `PayoutCaller` struct carries only the predecessor account and has an `OPEN` marker for the eventual relayer/agent identity.

## Risks and gaps

- The temporary vault and policy modules are not production custody or permission systems.
- No refund or recredit path exists; adding one without proof could create value.
- Backend status is deliberately not proof of bank settlement.
- The refs character filter cannot prove that a value is not personal data.
- The near-workspaces test is a smoke harness and is ignored by default; the detailed checks use unit-test promise results.
- Cargo resolves the semver range to the current lockfile version; the manifest still expresses the repository's required near-sdk `5.17.2` compatibility range.
- No real Dapper or Aria modules are present in this checkout, so their exact compile-time interfaces remain to be validated.

## Readiness for checks belonging to this side

| Check | Status | Evidence |
| --- | --- | --- |
| Register only through the configured account | Done | Authorization and forged-caller tests pass. |
| Validate order ID, amount, corridor, destination, and expiry | Done | Validation and edge-value tests pass. |
| Never send an order twice | Done | Duplicate, same-block, terminal-state, and invariant tests pass. |
| Reserve before transfer and restore after failure | Done, real vault | Dapper vault tests and 40 feature-enabled order tests pass. |
| Callback is private and stale-safe | Done | Outsider, exact-result, failure, and stale callback tests pass. |
| Separate verified transfer state from backend status | Done | Receipt and status-gating tests pass. |
| Backend status replay and monotonicity | Done, proposed | Tests pass; rules remain marked PROPOSED pending backend approval. |
| No value movement from `set_status` | Done | Transfer-state and balance-invariance tests pass. |
| Refund proof and `recredit` | Not yet | Method intentionally fails until the OPEN design is approved. |
| Dapper/Aria production integration | Dapper done, Aria pending | Real `vault.rs` is wired; policy calls still use `temp_policies.rs`. |
| Test-only credit absent from release build | Done | Release WASM check passes with `testing` enabled and debug assertions disabled. |
| Formatting and lint | Done | `cargo fmt --check` and strict clippy pass. |
