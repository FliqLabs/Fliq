# Security review: sQuiDbOb contract surface

Scope: `lib.rs`, `orders.rs`, `types.rs`, `receipts.rs`, `integration.rs`, and `vault.rs`. `vault.rs` was not changed; no `policies.rs` exists, so policy calls remain on `temp_policies.rs`.

## Public methods and callbacks

| Method | Who can call | State changed | Failure and balance effect |
| --- | --- | --- | --- |
| `new` | Vault account only during initialization | Writes owner, registration account, token contract, empty order/receipt maps | Calls from another predecessor and repeated initialization fail before state is changed. |
| `set_registration_account` | Owner only | Changes the registration account | Authorization failure changes nothing; no balance effect. |
| `get_config` | Anyone | None | Read-only. |
| `register_order` | Registration account only | Adds one immutable order and its initial receipt; emits `order_registered` | Validation, authorization, duplicate, or storage failure aborts the transaction; no reservation or balance movement occurs. |
| `payout` | Any predecessor accepted by the temporary payer policy; the policy currently allows only the payer | Validates caller-supplied amount and destination against the immutable order, reserves funds, records pending policy spend, changes `Registered` to `Executing`, creates the USDC transfer and callback | Mismatches fail before reservation. Any later pre-promise panic rolls back reservation and pending spend. The transfer itself is resolved only by the private callback or owner recovery after timeout. |
| `set_status` | Registration account only | Changes proposed branching backend status, refs, and `last_updated`; emits `status_set` | Unknown/illegal edge, invalid refs, terminal-state signal, or transfer-state contradiction aborts with no balance, transfer-state, or policy-count change. Exact replay is a no-op. |
| `set_payout_timeout` | Owner only | Changes the U64-encoded stuck-payout timeout | Non-owner and zero timeout fail without state changes. |
| `resolve_stuck_payout` | Owner only after timeout | Commits or releases the real vault reservation, settles/releases pending policy spend, changes `Executing` to `Dispatched` or `TransferFailed`, and emits `payout_executed` | The owner must verify the USDC transfer on chain first; releasing after a real transfer could double pay. Non-owner, early, non-Executing, and repeated calls fail. |
| `get_receipt` | Anyone | None | Unknown order fails clearly; otherwise read-only and exposes the order plus separate verified/reported tracks. |
| `get_balance` | Anyone | None | Delegates to the real `Vault` ledger through the integration layer; read-only. |
| `credit_for_testing` | Only compiled with `testing` and debug assertions | Adds test funds through the real `Vault` ledger | Test-only funding; absent from release builds and not a production deposit path. |
| `on_payout_complete` | Contract account only, with exactly one promise result | Commits or releases reservation, settles or releases pending policy spend, updates transfer state/receipt, emits `payout_executed` | Outsider, malformed, or stale callbacks change nothing. A transfer failure restores the reservation. Any callback panic rolls back its whole state change. |

## Findings and fixes

- Added an exact one-promise-result guard to the private payout callback. This prevents interpreting an unexpected promise result set as the USDC transfer result.
- Confirmed that state changes happen before the transfer promise and that callback success/failure paths are single-use through transfer-state and reservation checks.
- Confirmed that backend status updates cannot move funds or alter the verified transfer state.
- Confirmed that the testing credit method is gated by both the `testing` feature and debug assertions.
- Fixed initializer takeover risk by marking `Contract::new` private; deployment now requires a one-time `new` call made by the vault account itself.
- Restored Dapper's real vault entrypoints and routed balance, deposit, reservation, commit, and release operations through `vault.rs`, leaving only policy lifecycle calls on the temporary policy stand-in.
- Added payout amount/destination validation, timeout-based stuck-payout recovery, U64-safe public timestamps, and proposed branching backend status transitions.
- Removed the temporary vault ledger and the stub `recredit`/`get_policy` ABI methods.

## Residual risks

- The temporary policy module is not a production authorization implementation and must be replaced through `integration.rs` before relying on agent limits.
- The refs character policy reduces accidental personal-data storage but cannot prove that an identifier is not personal data; backend approval and operational controls remain required.
- Refund/recredit behavior remains intentionally disabled and OPEN.
- The status transition table remains PROPOSED pending backend approval; the payout signature and relayer allowlist also need backend approval.
