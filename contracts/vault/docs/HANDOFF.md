# FLIQ vault contract handoff

Branch: `Ariya-Agent-Permissions`

## Implemented contract surface

| Method or area | Owner module | Behavior |
| --- | --- | --- |
| `new`, `get_config` | `lib.rs` | Stores immutable owner, registration account and approved USDC token plus expiry and stuck-payout limits. Initialization is vault-account-only and one-time. |
| `register_order` | `orders.rs`, `vault.rs` | Registration-account-only immutable order creation with immediate balance reservation. |
| `payout` | `orders.rs`, `policies.rs`, `vault.rs` | Requires exact registered amount and destination, authorizes the payer or an agent account with an active policy from that payer, counts pending policy spend, changes state before sending USDC, and resolves through a private callback. |
| `set_agent` | `policies.rs` | With a deposit covering storage, creates or updates the (owner, agent account) policy: per-payout cap, daily cap, optional exact corridors, cooldown and expiry, without resetting same-day spend. Emits `agent_set`. |
| `remove_agent(agent_id)` | `policies.rs` | With exactly 1 yoctoNEAR, revokes the caller's policy for that agent. Emits `agent_revoked`. |
| `get_policy(owner, agent_id)` | `policies.rs` | Returns owner, agent, public key label, caps, current-day spend, corridors, cooldown, expiry, last payout time and the revoked flag. |
| Policy lifecycle | `policies.rs`, `integration.rs` | Counts pending plus successful spend, releases same-day spend after failed transfers, retains successful spend, rolls daily buckets, and makes parallel-limit bypass fail. |
| `on_payout_complete`, `resolve_stuck_payout` | `orders.rs` | Commits a confirmed transfer or releases the reservation and enters terminal `TransferFailed`; policy pending state follows the same outcome. |
| `release_order` | `lib.rs`, `vault.rs` | Registration account or contract owner restores a reservation and moves a never-executed order to terminal `Released`. |
| `set_status`, `get_receipt` | `orders.rs`, `receipts.rs` | Keeps authenticated backend status separate from verified NEAR transfer state; missing receipts return `null`. |
| `recredit` | `orders.rs`, `vault.rs` | Requires write-once refund evidence and real unattributed USDC backing before exactly-once recredit. |
| `ft_on_transfer`, `get_balance`, `transfer` | `vault.rs`, `lib.rs`, `policies.rs` | Handles approved-USDC deposits, isolated available/reserved balances and registered internal transfers; agent transfers debit the policy owner and enforce policy spend limits. |

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
- Agent-initiated vault transfers use the same per-action cap, daily cap, cooldown, expiry and revocation checks and debit the policy owner. Corridors do not apply because a vault transfer has no corridor.
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
- exactly-1-yocto agent administration and policy-limited vault transfers.

## Deployment migration

This release targets a fresh testnet vault. Deploy the Wasm and call the private `new(owner, registration_account, approved_usdc_token_contract)` initializer from the vault account itself. There is no migration path in this release.

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
