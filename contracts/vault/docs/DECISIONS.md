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
- Failed transfers and `resolve_stuck_payout(..., false)` return to `Registered`, keep their reservation for retry, and create no refund record.

## Other OPEN contract questions

- The confirmed payout signature is now `payout(order_id, amount, deposit_address)` instead of `payout(order_id)`. This needs backend approval, and the relayer allowlist must permit both additional arguments.
- Public order and payout amounts use near-sdk `U128` JSON values, serialized as decimal strings; the contract keeps `u128` for internal arithmetic. Backend callers must send amounts as JSON strings.

- Is the order ID the same as the backend `po_` payout ID?
- What expiry time unit is final?
- How is corridor encoded?
- The registration account is stored once at initialization; key rotation happens on that account.
- `get_policy` remains unavailable until Aria's real policy design and implementation is approved.
- What agent identity is required for relayed calls?
- What counts toward agent daily limits?
