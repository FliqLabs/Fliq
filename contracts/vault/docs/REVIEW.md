# Security review: sQuiDbOb contract surface

Scope: `lib.rs`, `orders.rs`, `types.rs`, `receipts.rs`, `integration.rs`, and `vault.rs`. `vault.rs` was not changed; no `policies.rs` exists, so policy calls remain on `temp_policies.rs`.

## Public methods and callbacks

| Method | Who can call | State changed | Failure and balance effect |
| --- | --- | --- | --- |
| `new` | Vault account only during initialization | Writes owner, registration account, token contract, empty order/receipt maps | Calls from another predecessor and repeated initialization fail before state is changed. |
| `set_registration_account` | Owner only | Changes the registration account | Authorization failure changes nothing; no balance effect. |
| `get_config` | Anyone | None | Read-only. |
| `register_order` | Registration account only | Adds one immutable order and its initial receipt; emits `order_registered` | Validation, authorization, duplicate, or storage failure aborts the transaction; no reservation or balance movement occurs. |
| `payout` | Any predecessor accepted by the temporary payer policy; the policy currently allows only the payer | Reserves funds, records pending policy spend, changes `Registered` to `Executing`, creates the USDC transfer and callback | Any pre-promise panic rolls back the transaction, including reservation and pending spend. The transfer itself is resolved only by the private callback. |
| `set_status` | Registration account only | Changes backend status, refs, and `last_updated`; emits `status_set` | Unknown order/status, invalid refs, backward transition, or transfer-state contradiction aborts with no balance, transfer-state, or policy-count change. Exact replay is a no-op. |
| `recredit` | Public entry point, but intentionally always disabled | None | Always fails before changing state or balances until refund design is approved. |
| `get_receipt` | Anyone | None | Unknown order fails clearly; otherwise read-only and exposes the order plus separate verified/reported tracks. |
| `get_balance` | Anyone | None | Delegates to the real `Vault` ledger through the integration layer; read-only. |
| `get_policy` | Anyone | None | Temporary empty-policy view; it cannot move value. Real policy wiring remains outside this side's implementation. |
| `credit_for_testing` | Only compiled with `testing` and debug assertions | Adds test funds through the real `Vault` ledger | Test-only funding; absent from release builds and not a production deposit path. |
| `on_payout_complete` | Contract account only, with exactly one promise result | Commits or releases reservation, settles or releases pending policy spend, updates transfer state/receipt, emits `payout_executed` | Outsider, malformed, or stale callbacks change nothing. A transfer failure restores the reservation. Any callback panic rolls back its whole state change. |

## Findings and fixes

- Added an exact one-promise-result guard to the private payout callback. This prevents interpreting an unexpected promise result set as the USDC transfer result.
- Confirmed that state changes happen before the transfer promise and that callback success/failure paths are single-use through transfer-state and reservation checks.
- Confirmed that backend status updates cannot move funds or alter the verified transfer state.
- Confirmed that the testing credit method is gated by both the `testing` feature and debug assertions.
- Fixed initializer takeover risk by marking `Contract::new` private; deployment now requires a one-time `new` call made by the vault account itself.
- Restored Dapper's real vault entrypoints and routed balance, deposit, reservation, commit, and release operations through `vault.rs`, leaving only policy lifecycle calls on the temporary policy stand-in.

## Residual risks

- The temporary policy module is not a production authorization implementation and must be replaced through `integration.rs` before relying on agent limits.
- The refs character policy reduces accidental personal-data storage but cannot prove that an identifier is not personal data; backend approval and operational controls remain required.
- Refund/recredit behavior remains intentionally disabled and OPEN.
