# FLIQ vault contract handoff

Branch: `Ariya-Agent-Permissions`

## Implemented contract surface

| Method or area | Owner module | Behavior |
| --- | --- | --- |
| `new`, `get_config` | `lib.rs` | Stores immutable owner, registration account and approved USDC token plus expiry and stuck-payout limits. Initialization is vault-account-only and one-time. |
| `migrate` | `lib.rs` | Vault-account-only upgrade from the pre-policy state layout; preserves all existing vault and payout state and initializes empty policy maps. |
| `register_order` | `orders.rs`, `vault.rs` | Registration-account-only immutable order creation with immediate balance reservation. |
| `payout` | `orders.rs`, `policies.rs`, `vault.rs` | Requires exact registered amount and destination, authorizes the payer or a policy-bound agent account, counts pending policy spend, changes state before sending USDC, and resolves through a private callback. |
| `set_agent` | `policies.rs` | With exactly 1 yoctoNEAR, binds a public key to one distinct agent account and creates or updates its per-action cap, daily cap, optional exact corridors, cooldown and expiry without resetting same-day spend. |
| `remove_agent` | `policies.rs` | With exactly 1 yoctoNEAR, lets only the stored policy owner revoke the public-key binding. |
| `get_policy(public_key)` | `policies.rs` | Returns the backend-compatible owner, per-payout cap, daily cap, current-day spend and optional corridors view. |
| Policy lifecycle | `policies.rs`, `integration.rs` | Counts pending plus successful spend, releases same-day spend after failed transfers, retains successful spend, rolls daily buckets, and makes parallel-limit bypass fail. |
| `on_payout_complete`, `resolve_stuck_payout` | `orders.rs` | Commits a confirmed transfer or returns the order to retryable `Registered`; policy pending state follows the same outcome. |
| `release_order` | `lib.rs`, `vault.rs` | Registration account or contract owner restores a reservation and moves a never-executed order to terminal `Released`. |
| `set_status`, `get_receipt` | `orders.rs`, `receipts.rs` | Keeps authenticated backend status separate from verified NEAR transfer state. |
| `recredit` | `orders.rs`, `vault.rs` | Requires write-once refund evidence and real unattributed USDC backing before exactly-once recredit. |
| `ft_on_transfer`, `get_balance`, `transfer` | `vault.rs`, `lib.rs`, `policies.rs` | Handles approved-USDC deposits, isolated available/reserved balances and registered internal transfers; agent transfers debit the policy owner and enforce policy spend limits. |

## Agent identity decision

A public key is the backend lookup and administration key for each policy, and `set_agent` binds it to a distinct NEAR agent account. The payer owns that policy. Direct and NEP-366-relayed calls expose the delegated sender account as the vault predecessor, which the contract can verify. The contract does not claim that `env::signer_account_pk()` identifies the delegated key because NEAR does not expose that key identity to the called method.

Hosted-agent key removal should accompany `remove_agent`, but the on-chain revoked flag is independently enforced. An agent cannot create or change its own policy because policy ownership is always the predecessor that configured a different `agent_id`; exactly 1 yoctoNEAR is also required for permission changes.

## Spending semantics

- Amounts are integer USDC base units represented as JSON strings at the public boundary.
- Pending and successful agent payouts count toward the current 24-hour bucket.
- A failed token transfer or `resolve_stuck_payout(order_id, false)` releases its amount when the policy is still in that bucket.
- Successful spend remains counted if the provider later refunds it, preventing spend-limit recycling.
- Cooldown begins when authorization succeeds and remains after a transfer failure.
- Corridors use exact string matching. Policy corridor values are non-empty ASCII identifiers containing letters, digits, `-`, or `_`.
- Agent-initiated vault transfers use the same per-action cap, daily cap, cooldown, expiry and revocation checks and debit the policy owner. Corridors do not apply because a vault transfer has no corridor.
- Policy updates preserve current-day spend and last-payout time. Revoked policies can be deliberately reconfigured by their owner through `set_agent`.

## Verification

The current local result is 41 vault unit tests and 66 contract/integration tests passing with `--features testing`. Strict clippy and rustfmt checks pass. The near-workspaces smoke harness remains ignored by default and requires a supported local NEAR sandbox platform.

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
- exactly-1-yocto agent administration and policy-limited vault transfers.

## Deployment migration

An already-initialized vault running the pre-policy layout must deploy this Wasm and invoke private `migrate()` as the vault account before any ordinary method call. The migration preserves the existing ledger, configuration, orders, receipts, refund evidence and payout-key collections and creates the three policy collections. It rejects calls from any predecessor other than the vault account and rejects unsupported stored layouts. A new testnet vault should call `new` instead and needs no migration.

## Backend alignment

The backend already verifies NEP-366 delegate signatures, sender accounts, access-key membership, nonces, receiver, method, arguments and gas sponsorship. The vault adds independent on-chain amount, destination, payer and agent-policy enforcement. The backend must send the existing confirmed payout arguments: `order_id`, `amount`, and `deposit_address`.

The contract now exposes the agreed `set_agent`, `remove_agent`, and `get_policy(public_key)` interface and the `POLICY_PER_PAYOUT_CAP`, `POLICY_DAILY_CAP`, and `POLICY_CORRIDOR` errors. The public key identifies the policy at the interface boundary; the bound agent account remains the enforceable call identity. No backend source file was changed on this branch.

## Remaining open decisions

- Whether `order_id` is exactly the backend `po_` payout ID.
- Final canonical corridor encoding across backend and contract.
- Whether a provider allowlist is required in addition to immutable registered destinations.
- Order and receipt storage cleanup/funding.
- Testnet vault, token and deployment account IDs.
- Final approval of proposed backend status transitions and event payloads.

## Review requirements

This branch changes permissions and outgoing-transfer authorization and therefore needs contract review. Two contract owners must approve it before merge. The PR description must include **needs contract review**.
