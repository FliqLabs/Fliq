# Backend / contract alignment

Compared with `origin/main` contract code and the backend interface on `origin/api/ladipeo-vault-interface`, plus the newer relayer policy on `origin/api/frank-relayer-payout-args`. Backend files were read only; no backend file was changed.

| Item | Backend sends or expects | Contract today | Result | Contract action / confirmer |
| --- | --- | --- | --- | --- |
| `register_order` | `services/api/packages/chains/vault/types.ts:RegisterOrderInput`: `orderId,payer,depositAddress,amount,expiresAtNs,corridor`; JSON `order_id,payer,deposit_address,amount,expires_at_ns,corridor` | `contracts/vault/src/lib.rs:163-218`, same order and names after `expires_at_ns` fix | MATCH | Backend lead confirms |
| `payout` | Vault interface proposes `{order_id}`; relayer branch `services/api/packages/chains/near/policy.ts` requires `order_id,amount,deposit_address` | `contracts/vault/src/lib.rs:221-232`, `orders.rs:245-321`, three arguments and exact amount/address checks | CONTRACT MUST CHANGE | Keep three-argument safety interface; backend lead must update the older vault interface/parser |
| `set_status` | `types.ts` uses `orderId,status,refs` with snake-case wire fields | `lib.rs:234`, `orders.rs:180-218`; registration account only and write-once refs | MATCH | Backend lead confirms transition table |
| `release_order` | `types.ts` exposes it; relayer policy allows it with `order_id` and zero deposit | `lib.rs:239-262`; registration account or owner, Registered only, terminal Released | MATCH | Contract lead confirms payer-before-expiry policy is intentionally stricter than old proposal |
| `recredit` | `types.ts` calls `recredit(orderId, amount)`; old interface expects the same | `lib.rs:272-285`; two args, registration account only, balance callback | MATCH | Dapper/backend confirm refund evidence flow |
| `get_receipt` missing order | Backend type is nullable | `lib.rs:311-326` now returns `Option<ReceiptView>` and serializes missing as `null` | MATCH | Backend watcher confirms nested receipt shape |
| `get_balance` | `{available,reserved,total}` bigint values | `lib.rs:109-111`, `vault.rs:BalanceView`; JSON U128 strings | MATCH | Backend lead confirms |
| Amount format | `types.ts` uses bigint; event parser requires unsigned decimal strings | Public U128 boundaries and event U128 values in `lib.rs`, `types.rs`, `receipts.rs` | MATCH | Backend lead confirms no JSON numbers |
| `order_id` / `po_` ID | Backend leaves `OrderId` as string and decisions ask whether it is the payout ID | `orders.rs:validate_order` accepts up to 64 chars, does not add/remove `po_` | UNKNOWN | Contract must not transform IDs; backend lead confirms canonical mapping |
| Expiry | `expiresAtNs` bigint; vault interface says nanoseconds | `types.rs:now()` uses block timestamp nanoseconds; `register_order` bounds U64 | MATCH | Backend lead confirms nanoseconds |
| Corridors | Example `NG-NGN-bank` in vault interface and fixtures | `orders.rs` stores exact string; policy corridors exact-match ASCII list | MATCH | Backend/provider lead confirms canonical values |
| Deposit address | Relayer validates a NEAR account string; backend registers it | `orders.rs:validate_deposit_address`; payout requires exact registered address | MATCH | Backend lead confirms recipient allowlist remains backend-only |
| Transfer states | Backend legacy type expects `registered/executed/released` | `types.rs:TransferState` is `Registered/Executing/Dispatched/TransferFailed/Released` | CONTRACT MUST CHANGE | Backend watcher must consume the verified state names or contract needs a compatibility view; backend stays as-is per task, so add an adapter view in the contract only if approved |
| Status names/transitions | `types.ts` has routing, with_provider, paying_out, settled, refunding, refunded, failed | `orders.rs:status_successors`; includes created/awaiting/timeout branches and gates paying_out/settled on Dispatched | UNKNOWN | Backend lead confirms the expanded status graph |
| Refs | Backend wire keys `provider,provider_order,bank_reference,refund_tx` | `types.rs:ReceiptRefs`, `orders.rs:validate_refs`; same snake-case keys, write-once | MATCH | Backend lead confirms |
| Receipt shape | Legacy backend expects flat receipt with state/status/recredited amount | Contract returns nested `order`, separate `transfer_state`, `expired`, `executing_since`, backend status and refs; no `recredited_amount` view field | CONTRACT MUST CHANGE | Add compatibility fields/shape without removing verified fields; backend lead confirms exact JSON |
| Event envelope | Backend parser requires `EVENT_JSON`, `fliq_vault`, `1.0.0`, exact fields | `receipts.rs` emits that envelope for contract-owned events; Dapper vault event code remains separate | MATCH / UNKNOWN | Backend confirms policy events and Dapper conversion |
| Event watcher fields | Parser currently knows order_registered, payout_executed, order_released, status_set, recredited, deposited | Contract also emits transferred, agent_set, agent_revoked, agent_spend | UNKNOWN | Backend lead approves or ignores the additional event names |
| Errors | Backend maps `fliq_vault: CODE`; legacy list includes names not in current errors | `errors.rs` uses exact prefix/codes; Dapper enum errors are mapped in `integration.rs` | CONTRACT MUST CHANGE | Add compatibility aliases only after backend confirms; do not change Dapper strings in this run |
| Relayer allowlist and gas | `near/policy.ts`: payout has three args, 0 deposit; gas 1-100 Tgas; contract needs at least 50 Tgas | `orders.rs:292-298` requires at least 50 Tgas and uses 30 transfer + 20 callback | MATCH | Relayer lead confirms max and method allowlist |
| Top-up message | Vault interface supports `{"top_up":{"account_id":"..."}}`; newer relayer policy currently allows only empty msg | `lib.rs` accepts empty sender credit and strict top_up beneficiary | CONTRACT MUST CHANGE | Backend/relayer must allow the agreed top_up message; contract already supports it |
| Registration signer | Backend interface says registration account calls register/status/recredit/release | `lib.rs` checks immutable `registration_account`; vault account must call private `new` | MATCH | Deployment owner confirms account IDs |
| Refunds | Backend verifies refund tx and calls recredit once | `orders.rs:331-388` requires Dispatched, refunding, write-once `refund_tx`, real USDC backing | MATCH | Backend refund watcher confirms |
| Testnet accounts | No deployed account is present in the checked contract tree; interface asks for deployment details | `Config` stores owner, registration and approved USDC only | UNKNOWN | Deployment operator supplies vault, USDC and registration IDs |
| Storage | Backend does not send order storage deposit | `register_order` is funded by the vault account's storage balance | UNKNOWN | Contract owners confirm funding policy |

## Questions requiring confirmation

1. Is the canonical payout ID always the backend `po_` value?
2. Should the backend accept the verified state names `Executing`, `Dispatched`, `TransferFailed`, or should the contract add a compatibility view?
3. Which exact event fields should the watcher parse for `agent_set`, `agent_revoked`, and `agent_spend`?
4. Does the relayer permit the strict top-up message, and which registration/USDC/vault testnet account IDs are final?
