# Contract decisions

## Confirmed release_order rules

- `release_order(order_id)` is callable by the registration account or owner only.
- It works only from `Registered`, restores the order's reservation to the payer's available balance, and moves the order to terminal `Released`.
- A `Released` order cannot be paid, released again, registered again, or moved by `set_status`; an `Executing` order must use `resolve_stuck_payout`.
- The event is `order_released` under the `fliq_vault` NEP-297 envelope, version `1.0.0`.

## PROPOSED backend status rules

These rules are PROPOSED and require backend approval:

- `set_status` is callable only by `registration_account`.
- The order must exist and the status must be in `BACKEND_STATUSES`.
- Replaying the same status with the same refs is accepted as a no-op.
- Statuses follow the branching transitions from the backend payout-state model; illegal edges and signals after terminal states are rejected.
- `paying_out` and `settled` are accepted only after the verified NEAR `transfer_state` is `Dispatched`.
- Status updates never change the verified transfer state, balances, or policy counts.
- Refs are limited to 256 ASCII identifier characters (`A-Z`, `a-z`, `0-9`, `:`, `/`, `.`, `_`, `-`) to keep personal data out of receipts and events. This format is PROPOSED.
- The proposed status table includes the `refused` and `not_received` terminal branches from the API spec. The transition table remains PROPOSED pending backend approval.

## Confirmed refund behavior

- A refund can be recredited only for an existing `Dispatched` order whose backend status is `refunding` and whose receipt has a write-once `refund_tx`.
- The backend verifies the refund transaction before the registration account calls `recredit(order_id, amount)`.
- The contract queries `ft_balance_of` on the approved USDC contract, caps the credit at the committed outflow and unattributed token balance, and records both the order credit and refund transaction as single-use.
- A partial refund is allowed, but each order has at most one recredit. Only a successful callback changes the receipt status to `refunded`.
- Failed transfers and `resolve_stuck_payout(..., false)` release the reservation, enter terminal `TransferFailed`, and create no refund record.

## Agent policy behavior

- Policies are keyed by (owner, agent account). The public key is a label for the backend. Naming an account as your agent never affects that account's own funds or anyone else's policy for it.
- `set_agent` creates or updates caps, optional exact-match corridors, cooldown and expiry without resetting same-day spend, charges the policy storage to the owner and refunds the rest of the deposit. `remove_agent` marks the policy revoked and keeps it. A deposit is required for both, so an ordinary function-call key cannot change agent permissions.
- Daily spend includes pending and successful payouts. Parallel attempts therefore cannot race past the limit. A failed transfer releases its same-day amount; a successful payout remains counted even if it is later refunded.
- Cooldown starts when a payout is authorized and remains in force after a failed transfer. Daily buckets use NEAR block timestamp nanoseconds and UTC-sized 24-hour intervals.
- Direct payer calls do not require an agent policy. Agent payout calls require the policy owner to equal the registered order payer. Agent-initiated vault transfers debit the policy owner and enforce the same per-action cap, daily cap, cooldown, expiry and revocation rules; corridor validation applies only to payouts because a vault transfer has no corridor.

## Other OPEN contract questions

- The confirmed payout signature is now `payout(order_id, amount, deposit_address)` instead of `payout(order_id)`. This needs backend approval, and the relayer allowlist must permit both additional arguments.
- Public order and payout amounts use near-sdk `U128` JSON values, serialized as decimal strings; the contract keeps `u128` for internal arithmetic. Backend callers must send amounts as JSON strings.

- Is the order ID the same as the backend `po_` payout ID?
- What expiry time unit is final?
- How is corridor encoded?
- The registration account is stored once at initialization; key rotation happens on that account.
- Agent policy identity and daily-limit accounting are implemented as described above.
## Proposed policy identity and failure semantics

- **PROPOSED:** Agent policies are keyed by `(owner, agent account)`. An agent is a distinct NEAR account because a relayed NEP-366 call reports the relayer's key as the signer. The app and backend must never place an agent key on the user's own account: calls from the user's account are treated as the user. The contract cannot see which function-call key signed the transaction.
- **PROPOSED:** A failed payout refunds that payout's daily policy spend but retains the cooldown timestamp. This prevents a failed transfer from consuming the daily allowance while preventing immediate retry abuse.
- **PROPOSED:** A failed payout releases the Dapper reservation and enters terminal `TransferFailed`; it cannot be retried or released again. A stale callback is a no-op.
