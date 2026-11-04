# sQuiDbOb contract handoff

Branch: `sQuiDbOb-Orders-and-Payouts`

## What was built

| Method or area | File | What it does | Test evidence |
| --- | --- | --- | --- |
| `new` | `contracts/vault/src/lib.rs` | Stores owner, registration account, approved USDC token, and 24-hour expiry limit. | Configuration tests in `tests/contract.rs`. |
| `set_registration_account` | `lib.rs` | Lets only the owner rotate the registration account. | Owner and non-owner tests. |
| `get_config` | `lib.rs` | Read-only configuration view. | Used by configuration tests. |
| `register_order` | `lib.rs`, `orders.rs` | Authorizes the registration account, validates fields and expiry, stores an immutable order, and emits `order_registered`. It does not reserve funds. | Registration, duplicate, field, expiry, authorization, and event tests. |
| `payout` | `lib.rs`, `orders.rs` | Checks the stored order, asks the integration layer for policy approval, reserves funds, changes state before creating the USDC transfer, and calls the private callback. | Happy path, duplicate, same-block, wrong caller, expiry, oversubscription, edge amount, and stored destination/amount tests. |
| `on_payout_complete` | `lib.rs`, `orders.rs` | Accepts only the contract's callback with exactly one result; commits on success or releases on failure; stale callbacks do nothing. | Success, failure, outsider, stale, and invariant tests. |
| `set_status` | `lib.rs`, `orders.rs` | Lets only the registration account report monotonic backend progress. Replays are no-ops; it cannot change transfer state or balances. | Authorization, unknown values, replay, backward, gating, receipt, balance, and event tests. |
| `recredit` | `lib.rs` | Deliberately disabled until refund design approval. | Existing disabled-path behavior. |
| `get_receipt` | `lib.rs`, `types.rs` | Shows the stored order, verified NEAR transfer state, backend status, refs, and update time as separate tracks. | Receipt separation and unknown-order tests. |
| `get_balance` | `lib.rs`, `integration.rs` | Read-only balance view delegated through the integration layer. | Balance and invariant tests. |
| Recredit read helpers | `orders.rs` | `order_exists`, `order_payer`, `order_amount`, and `order_transfer_state`. | Read-helper test. |
| Integration boundary | `integration.rs` | Expects seven small functions so Dapper and Aria can replace only this layer. | Temporary-ledger and payout tests. |

Current vault result: 37 tests passed, 0 failed with `--features testing`; the default `make test-contract` run passes 26 tests. The near-workspaces smoke test is present but ignored by default. The standalone mock USDC crate builds and its test target has 0 tests and 0 failures.

The latest `origin/Contract` branch was fetched and was already an ancestor; the merge was up to date and had no conflicts. There are currently no real `vault.rs` or `policies.rs` files in this checkout.

## What is still a placeholder

Every marker below is intentional. Replace the temporary implementation only through `integration.rs`; do not make the stand-ins production custody or policy code.

### `contracts/vault/src/temp_vault.rs`

- Lines 11, 16: temporary storage-key builders. Dapper replaces them with its real balance/reservation storage.
- Lines 21, 32, 39, 46: temporary amount, reservation read/write/remove helpers. Dapper replaces the ledger operations with checked persistent balance operations.
- Line 51: temporary available/reserved ledger. Replace with Dapper's authoritative reservation API.
- Lines 78, 90: temporary commit and release behavior. Replace with Dapper's single-use outflow and rollback behavior.
- Line 108: temporary string balance view. Replace with Dapper's canonical total/available/reserved view.
- Line 122: test-only credit hook. It must disappear from release builds and never represent a real deposit path.

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

## What I need from Dapper

Replace only the temporary vault calls behind these `integration.rs` functions:

- `reserve_for_order(order_id, payer, amount)`: atomically verify available balance, move amount from available to an order reservation, and fail without partial state.
- `commit_outflow(order_id)`: consume the one reservation after a successful USDC transfer; never allow a second commit.
- `release_reservation(order_id)`: return the one reservation to available after a failed transfer; never release twice.
- `get_balance(account)`: return authoritative total, available, and reserved amounts as JSON-safe strings.

The integration layer also owns `release_pending` and `settle_pending` calls, which must be coordinated with Aria's policy implementation. Dapper should provide these read helpers for future recredit review: `order_exists(order_id)`, `order_payer(order_id)`, `order_amount(order_id)`, and `order_transfer_state(order_id)`. Recredit stays disabled until refund proof and reconciliation are approved.

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
| Reserve before transfer and restore after failure | Done, temporary | 37 feature-enabled tests pass; real balance authority still belongs to Dapper. |
| Callback is private and stale-safe | Done | Outsider, exact-result, failure, and stale callback tests pass. |
| Separate verified transfer state from backend status | Done | Receipt and status-gating tests pass. |
| Backend status replay and monotonicity | Done, proposed | Tests pass; rules remain marked PROPOSED pending backend approval. |
| No value movement from `set_status` | Done | Transfer-state and balance-invariance tests pass. |
| Refund proof and `recredit` | Not yet | Method intentionally fails until the OPEN design is approved. |
| Dapper/Aria production integration | Not yet | Only temporary stand-ins exist; no real modules are present. |
| Test-only credit absent from release build | Done | Release WASM check passes with `testing` enabled and debug assertions disabled. |
| Formatting and lint | Done | `cargo fmt --check` and strict clippy pass. |
