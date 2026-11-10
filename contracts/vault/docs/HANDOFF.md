# FLIQ vault contract handoff

Branch: `Dapper-Contract`

## Implemented contract surface

| Method or area | Owner module | Behavior |
| --- | --- | --- |
| `new`, `get_config` | `lib.rs` | Stores immutable owner, registration account and approved USDC token plus expiry and stuck-payout limits. Initialization is vault-account-only and one-time. Only `payout_timeout` can be changed afterwards; owner, registration account and token have no setter. |
| `migrate` | `lib.rs` | Vault-account-only, state-replacing initializer that reads the pre-`order_agents` layout (`ContractV1`) and carries balances, orders, receipts, refund evidence, payout keys and policies forward. Must run in the same transaction as the code deployment. |
| `register_order` | `orders.rs`, `vault.rs` | Registration-account-only immutable order creation with immediate balance reservation. |
| `payout` | `orders.rs`, `policies.rs`, `vault.rs` | Requires exact registered amount and destination, authorizes the payer or an agent account with an active policy from that payer, counts pending policy spend, changes state before sending USDC, and resolves through a private callback. |
| `set_agent` | `policies.rs` | With a deposit covering storage, creates or updates the (owner, agent account) policy: per-payout cap, daily cap, optional exact corridors, cooldown and expiry, without resetting same-day spend. Emits `agent_set`. |
| `remove_agent(agent_id)` | `policies.rs` | With exactly 1 yoctoNEAR, revokes the caller's policy for that agent. Emits `agent_revoked`. |
| `get_policy(owner, agent_id)` | `policies.rs` | Returns owner, agent, public key label, caps, current-day spend, corridors, cooldown, expiry, last payout time and the revoked flag. |
| Policy lifecycle | `policies.rs`, `integration.rs` | Counts pending plus successful spend, releases same-day spend after failed transfers, retains successful spend, rolls daily buckets, and makes parallel-limit bypass fail. |
| `on_payout_complete`, `resolve_stuck_payout` | `orders.rs` | Commits a confirmed transfer or releases the reservation and enters terminal `TransferFailed`; policy pending state follows the same outcome. After timeout, either the owner or registration account may resolve it. |
| `release_order` | `lib.rs`, `vault.rs` | Restores a reservation and moves a never-executed order to terminal `Released`. The registration account or the owner may release any `Registered` order; once an order has expired, anyone may release it, so an outage or a leaked registration key cannot freeze a balance beyond its expiry. |
| `withdraw`, `on_withdraw_complete` | `lib.rs`, `integration.rs` | With exactly 1 yoctoNEAR and at least 60 Tgas, sends the caller's own available USDC to the caller's account with no order and no backend involvement. The amount is reserved while the transfer is in flight, committed on success and returned on failure, so liabilities stay exact. One withdrawal per account at a time; `withdraw:`-prefixed order IDs are reserved so a reservation key cannot collide with an order. Emits `withdrawn` or `withdraw_failed`. |
| `set_status`, `get_receipt` | `orders.rs`, `receipts.rs` | Keeps authenticated backend status separate from verified NEAR transfer state; missing receipts return `null`. |
| `recredit` | `orders.rs`, `vault.rs` | Requires write-once refund evidence and real unattributed USDC backing before exactly-once recredit. |
| `ft_on_transfer`, `get_balance`, `transfer` | `vault.rs`, `lib.rs` | Handles approved-USDC deposits, isolated available/reserved balances and registered internal transfers. Optional validated request IDs let the backend correlate request payments from transaction arguments; agents cannot transfer the owner's balance. |

## Agent identity decision

Each policy is keyed by the payer that owns it and a distinct NEAR agent account. The public key is stored as a label for the backend. Direct and NEP-366-relayed calls expose the agent account as the vault predecessor, which the contract can verify. The contract does not use `env::signer_account_pk()` to identify the agent, because a relayed call reports the relayer's key there.

Hosted-agent key removal should accompany `remove_agent`, but the on-chain revoked flag is independently enforced. An agent cannot create or change its own policy because the owner is always the predecessor that configured a different `agent_id`, and a deposit is required for permission changes. An agent must never be given a key on the owner's account: calls from the owner's account are treated as the owner.

## Spending semantics

- Amounts are integer USDC base units represented as JSON strings at the public boundary.
- Pending and successful agent payouts count toward the current 24-hour bucket.
- A failed token transfer or `resolve_stuck_payout(order_id, false)` releases its amount when the policy is still in that bucket.
- Successful spend remains counted if the provider later refunds it, preventing spend-limit recycling.
- Cooldown begins when authorization succeeds and remains after a transfer failure.
- Corridors use exact string matching. Policy corridor values are non-empty ASCII identifiers containing letters, digits, `-`, or `_`.
- Agent accounts cannot transfer the policy owner's balance; every vault transfer debits its predecessor's own registered balance.
- Policy updates preserve current-day spend and last-payout time. Revoked policies can be deliberately reconfigured by their owner through `set_agent`.

## Verification

The near-workspaces integration test is not ignored, uses the official `target/near` release artifacts, and requires a protocol-88-capable sandbox. Order expiry values in the test are computed as `current_block_timestamp_ns + margin_ns`, with a positive margin within the configured maximum horizon (24 hours by default).

Policy coverage includes:

- valid agent payout and direct payer payout;
- cross-user and unknown-agent calls;
- per-payout and daily caps;
- exact corridor allowlists;
- expiry, cooldown and revocation;
- simultaneous pending orders;
- failed-transfer release and successful-transfer retention;
- daily rollover and same-day update preservation;
- duplicate payout and callback replay protection.
- deposit-funded agent administration and caller-owned vault transfers.

## Deployment migration

There are two paths, and which one applies depends on whether the target account already holds vault state.

**A fresh account, including the mainnet vault.** Deploy the Wasm and call the private `new(owner, registration_account, approved_usdc_token_contract)` initializer from the vault account itself, in the same transaction as the deployment. Deployment needs a full-access key on the vault account.

**An account that already runs a pre-`order_agents` build, including the live testnet vault.** Deploy the new Wasm and call `migrate` in the same transaction, again from the vault account itself. Balances, orders, receipts, refund evidence, payout keys and policies are kept; `order_agents` starts empty, so orders registered before the upgrade can be paid by their payer alone. `new` cannot be used here: it is `#[init]` and guarded by `ALREADY_INITIALIZED`.

`migrate` reads exactly one old layout, `ContractV1`. Confirm the deployed build is pre-`order_agents` before relying on it; against any other layout the state read fails.

Whether that failure is safe depends on how the deployment is sent, and the two are not equivalent:

- **One transaction** (`cargo near deploy ... with-init-call migrate`, signed by the vault account, which needs a full-access key on it). A failing `migrate` rolls the deployment back with it, so the account keeps its working code.
- **Two transactions**, which is what the `Deploy contract` workflow does: it deploys `without-init-call`, so `migrate` is a separate call afterwards. Between the two the account runs new code over old state and every call fails. If `migrate` then fails, the old code is already gone and the only way back is redeploying the previous Wasm, so keep those exact bytes to hand before starting.

The `Deploy contract` workflow also only accepts a testnet account and runs in the `testnet` environment. There is no mainnet deployment workflow; the mainnet deploy in step 17 of the runbook is a manual, locally signed transaction.

As of 10 November 2026 the live testnet vault is `fliq-vault.testnet`, owner `fliq-owner.testnet`, registration account `fliqaccount.testnet`, approved USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, `max_expiry` 24 hours, `payout_timeout` 10 minutes. Its deployed code exports neither `withdraw` nor `migrate`, so it predates the November review fixes and the `migrate` path above is the one that applies to it.

## Backend alignment

The backend already verifies NEP-366 delegate signatures, sender accounts, access-key membership, nonces, receiver, method, arguments and gas sponsorship. The vault adds independent on-chain amount, destination, payer and agent-policy enforcement. The backend must send the existing confirmed payout arguments: `order_id`, `amount`, and `deposit_address`.

The contract exposes `set_agent`, `remove_agent(agent_id)` and `get_policy(owner, agent_id)` with the `POLICY_PER_PAYOUT_CAP`, `POLICY_DAILY_CAP` and `POLICY_CORRIDOR` errors, and emits `agent_set` and `agent_revoked`. The agent account is the enforceable call identity. No backend source file was changed on this branch.

## Remaining open decisions

- Whether `order_id` is exactly the backend `po_` payout ID.
- Final canonical corridor encoding across backend and contract.
- Whether a provider allowlist is required in addition to immutable registered destinations.
- Order and receipt storage cleanup/funding.
- Testnet vault, token and deployment account IDs.
- Final approval of proposed backend status transitions and event payloads.

## Review requirements

This branch changes permissions and outgoing-transfer authorization and therefore needs contract review. Two contract owners must approve it before merge. The PR description must include **needs contract review**.
