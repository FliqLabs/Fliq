# Security review: sQuiDbOb contract surface

Scope: `lib.rs`, `orders.rs`, `types.rs`, `receipts.rs`, `integration.rs`, and `vault.rs`. `vault.rs` changes are limited to standardized error strings; no `policies.rs` exists, so policy calls remain on `temp_policies.rs`.

## Public methods and callbacks

| Method | Who can call | State changed | Failure and balance effect |
| --- | --- | --- | --- |
| `new` | Vault account only during initialization | Writes owner, registration account, token contract, empty order/receipt maps | Calls from another predecessor and repeated initialization fail before state is changed. |
| `get_config` | Anyone | None | Read-only. |
| `register_order` | Registration account only | Reserves funds, adds one immutable order and receipt, and emits `order_registered` | Validation, authorization, duplicate, insufficient balance, or storage failure aborts the whole transaction. |
| `payout` | Any predecessor accepted by the temporary payer policy; the policy currently allows only the payer | Validates caller-supplied amount and destination, records pending policy spend and signing key, changes `Registered` to `Executing`, and creates the USDC transfer and callback | Mismatches leave the existing reservation unchanged. The transfer is resolved only by the private callback or owner recovery after timeout. |
| `set_status` | Registration account only | Changes proposed branching backend status, refs, and `last_updated`; emits `status_set` | Unknown/illegal edge, invalid refs, terminal-state signal, or transfer-state contradiction aborts with no balance, transfer-state, or policy-count change. Exact replay is a no-op. |
| `recredit` | Registration account | Validates `Dispatched`, `refunding`, and write-once `refund_tx`, then queries `ft_balance_of` on the approved USDC contract before guarded liability recredit; success changes status to `refunded` | Unknown, non-Dispatched, missing/reused evidence, oversized, under-backed, failed balance query, and repeated calls do not credit. |
| `set_payout_timeout` | Owner only | Changes the U64-encoded stuck-payout timeout | Non-owner and zero timeout fail without state changes. |
| `resolve_stuck_payout` | Owner only after timeout | Commits a confirmed transfer or returns the order to retryable `Registered` while preserving its reservation | The owner must verify the USDC transfer on chain first; reporting false after a real transfer could permit a retry. Non-owner, early, non-Executing, and repeated calls fail. |
| `get_receipt` | Anyone | None | Unknown order fails clearly; otherwise read-only and exposes the order plus separate verified/reported tracks. |
| `get_balance` | Anyone | None | Delegates to the real `Vault` ledger through the integration layer; read-only. |
| `credit_for_testing` | Only compiled with `testing` and debug assertions | Adds test funds through the real `Vault` ledger | Test-only funding; absent from release builds and not a production deposit path. |
| `on_payout_complete` | Contract account only, with exactly one promise result | Commits on success; on failure returns the order to `Registered` and keeps its reservation for retry | Outsider, malformed, or stale callbacks change nothing. Any callback panic rolls back its whole state change. |
| `transfer` | Registered payer with exactly 1 yoctoNEAR | Moves available balance to another registered vault user and emits `transferred` | A function-call key unable to attach 1 yocto cannot invoke it; zero, same-account, unregistered, insufficient, and overflow cases change nothing. |

## Findings and fixes

- Added an exact one-promise-result guard to the private payout callback. This prevents interpreting an unexpected promise result set as the USDC transfer result.
- Confirmed that state changes happen before the transfer promise and that callback success/failure paths are single-use through transfer-state and reservation checks.
- Confirmed that backend status updates cannot move funds or alter the verified transfer state.
- Confirmed that the testing credit method is gated by both the `testing` feature and debug assertions.
- Fixed initializer takeover risk by marking `Contract::new` private; deployment now requires a one-time `new` call made by the vault account itself.
- Restored Dapper's real vault entrypoints and routed balance, deposit, reservation, commit, and release operations through `vault.rs`, leaving only policy lifecycle calls on the temporary policy stand-in.
- Added payout amount/destination validation, timeout-based stuck-payout recovery, U64-safe public timestamps, and proposed branching backend status transitions.
- Removed the temporary vault ledger and the `get_policy` stub; retained Dapper's real guarded recredit and wired it through the order boundary.
- Added the terminal `Released` state and `release_order`; completed orders retain their order IDs and receipts, and `get_storage_usage` supports measurement without mutation.
- Standardized contract-owned panic strings as `fliq_vault: CODE`; Dapper enum failures are mapped at `integration.rs` and documented for conversion.

## Residual risks

- The temporary policy module is not a production authorization implementation and must be replaced through `integration.rs` before relying on agent limits.
- The refs character policy reduces accidental personal-data storage but cannot prove that an identifier is not personal data; backend approval and operational controls remain required.
- Refund transaction verification remains an operational backend responsibility; the contract independently checks approved-USDC backing and rejects evidence reuse.
- The status transition table remains PROPOSED pending backend approval; the payout signature and relayer allowlist also need backend approval.
