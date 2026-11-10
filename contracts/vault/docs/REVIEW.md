# Security review: sQuiDbOb contract surface

Scope: `lib.rs`, `orders.rs`, `types.rs`, `receipts.rs`, `integration.rs`, `policies.rs`, and `vault.rs`.

## Public methods and callbacks

| Method | Who can call | State changed | Failure and balance effect |
| --- | --- | --- | --- |
| `new` | Vault account only during initialization | Writes owner, registration account, token contract, empty order/receipt maps | Calls from another predecessor and repeated initialization fail before state is changed. |
| `get_config` | Anyone | None | Read-only. |
| `set_agent` | Policy owner with a deposit covering storage | Creates or updates the (owner, agent account) policy, preserving same-day spend, and refunds unused deposit | Invalid fields, self-authorization and too small a deposit fail without changing the policy. |
| `remove_agent(agent_id)` | Policy owner with exactly 1 yoctoNEAR | Marks the caller's policy for that agent revoked | A missing policy fails without state changes. Another owner's policy for the same agent is untouched. |
| `get_policy(owner, agent_id)` | Anyone | None | Returns the full policy view; stale daily spend is shown as zero after rollover and revoked policies are shown with `revoked: true`. |
| `register_order` | Registration account only | Reserves funds, adds one immutable order and receipt, and emits `order_registered` | Validation, authorization, duplicate, insufficient balance, or storage failure aborts the whole transaction. |
| `payout` | Registered payer directly, or an agent account with an active policy from that payer | Validates caller-supplied amount and destination, atomically counts pending spend, records the signing key, changes `Registered` to `Executing`, and creates the USDC transfer and callback | Identity, cap, daily limit, corridor, cooldown, expiry and revocation failures leave the existing reservation unchanged. The transfer is resolved only by the private callback or owner recovery after timeout. |
| `set_status` | Registration account only | Changes proposed branching backend status, refs, and `last_updated`; emits `status_set` | Unknown/illegal edge, invalid refs, terminal-state signal, or transfer-state contradiction aborts with no balance, transfer-state, or policy-count change. Exact replay is a no-op. |
| `recredit` | Registration account | Validates `Dispatched`, `refunding`, and write-once `refund_tx`, then queries `ft_balance_of` on the approved USDC contract before guarded liability recredit; success changes status to `refunded` | Unknown, non-Dispatched, missing/reused evidence, oversized, under-backed, failed balance query, and repeated calls do not credit. |
| `set_payout_timeout` | Owner only | Changes the U64-encoded stuck-payout timeout; emits `payout_timeout_set` | Non-owner calls and any value outside 10 minutes to 7 days fail without state changes. The lower bound stops an operator resolving a payout as not transferred before the real transfer callback can run. |
| `resolve_stuck_payout` | Owner either way after timeout; registration account only with `transferred = true` | Commits a confirmed transfer or releases the reservation into terminal `TransferFailed`; emits `payout_resolved` | The caller must verify the USDC transfer on chain first; reporting false after a real transfer could permit a double spend, which is why only the cold owner key can give funds back. Other callers, early, non-Executing, and repeated calls fail. |
| `release_order` | Registration account or owner for any `Registered` order; anyone once the order has expired | Restores the reservation and moves the order to terminal `Released` | Non-`Registered` orders fail. The expiry path bounds how long an outage or a leaked registration key can freeze a balance to the order's expiry, at most 24 hours. |
| `withdraw` | Any registered account, for its own balance, with exactly 1 yoctoNEAR and at least 60 Tgas | Reserves the caller's own available balance under a `withdraw:`-prefixed key and creates the USDC transfer and callback | Needs no order and no backend, so funds can always leave the vault. A second concurrent withdrawal, a non-positive amount and an insufficient balance all fail without state changes. Order IDs may not start with `withdraw:`, so a reservation key cannot collide with an order. |
| `on_withdraw_complete` | Contract account only, with exactly one promise result | Commits the reservation and emits `withdrawn`, or releases it and emits `withdraw_failed` | Outsider and malformed callbacks change nothing; the reservation means `total_liabilities` is exact at every step. |
| `migrate` | Vault account only | Replaces state in place, reading the pre-`order_agents` `ContractV1` layout and carrying balances, orders, receipts, refund evidence, payout keys and policies forward | Reads exactly one old layout and fails against any other. Sent as one transaction with the deployment it rolls the deployment back on failure; sent separately, as the `Deploy contract` workflow does, it does not, and recovery means redeploying the previous Wasm. `order_agents` starts empty, so pre-upgrade orders are payable by their payer alone. |
| `get_receipt` | Anyone | None | Unknown order returns JSON `null`; otherwise read-only and exposes flat backend fields plus separate verified/reported tracks. |
| `get_balance` | Anyone | None | Delegates to the real `Vault` ledger through the integration layer; read-only. |
| `credit_for_testing` | Only compiled with `testing` and debug assertions | Adds test funds through the real `Vault` ledger | Test-only funding; absent from release builds and not a production deposit path. |
| `on_payout_complete` | Contract account only, with exactly one promise result | Commits on success; on failure releases the reservation and enters terminal `TransferFailed` | Outsider, malformed, or stale callbacks change nothing. Any callback panic rolls back its whole state change. |
| `transfer` | Registered account with exactly 1 yoctoNEAR | Moves the caller's own available balance to another registered vault user; an optional validated `request_id` remains in the public transaction arguments; emits the frozen `transferred` event | Agents have no path to the owner's balance. Invalid request IDs, zero, same-account, unregistered, insufficient and overflow cases change nothing. |

## Findings and fixes

- Added an exact one-promise-result guard to the private payout callback. This prevents interpreting an unexpected promise result set as the USDC transfer result.
- Confirmed that state changes happen before the transfer promise and that callback success/failure paths are single-use through transfer-state and reservation checks.
- Changed failed transfer and stuck-payout recovery to release Dapper's reservation and enter terminal `TransferFailed`; this is PROPOSED pending backend confirmation.
- Confirmed that backend status updates cannot move funds or alter the verified transfer state.
- Confirmed that the testing credit method is gated by both the `testing` feature and debug assertions.
- Fixed initializer takeover risk by marking `Contract::new` private; deployment now requires a one-time `new` call made by the vault account itself.
- Restored Dapper's real vault entrypoints and routed balance, deposit, reservation, commit, and release operations through `vault.rs`.
- Added payout amount/destination validation, timeout-based stuck-payout recovery, U64-safe public timestamps, and proposed branching backend status transitions.
- Replaced the temporary policy stand-in with (owner, agent account) policies: caps, corridors, cooldown, expiry, revocation and pending-spend accounting. The owner pays policy storage. Payouts started before the upgrade settle without a pending row.
- Reinstated a single, narrow upgrade path. `migrate` is vault-account-only, reads only the pre-`order_agents` layout, and must run in the same transaction as the deployment. It exists because the live testnet vault already holds balances and orders that `new` cannot be called over.
- Added the terminal `Released` state and `release_order`; completed orders retain their order IDs and receipts, and `get_storage_usage` supports measurement without mutation.
- Standardized contract-owned panic strings as `fliq_vault: CODE`; Dapper enum failures are mapped at `integration.rs` and documented for conversion.

## Residual risks

- Agent access-key deletion remains an operational companion to on-chain revocation; the vault enforces the agent account policy even if a key remains active. Recipient allowlists are not on chain: deposit addresses change per order, so who may be paid is enforced by the backend.
- The refs character policy reduces accidental personal-data storage but cannot prove that an identifier is not personal data; backend approval and operational controls remain required.
- Refund transaction verification remains an operational backend responsibility; the contract independently checks approved-USDC backing and rejects evidence reuse.
- The status transition table remains PROPOSED pending backend approval; the payout signature and relayer allowlist also need backend approval.
