# Contract decisions

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

## OPEN refund and recredit questions

## PROPOSED refund behavior

- A refund can be recredited only for an order found through the order helpers, whose verified transfer state is `Dispatched` and whose backend status is `refunding` or `refunded`.
- The registration account calls `recredit(order_id, amount, actual_token_balance)`. The observed token balance is passed to Dapper's unchanged liability and under-backing checks.
- Dapper's vault creates the refund record on successful outflow, caps the recredit at that committed outflow, checks available unallocated USDC, and records a one-time tombstone. A successful call from `refunding` changes only the backend receipt status to `refunded`; verified transfer state remains `Dispatched`.
- Failed transfers and `resolve_stuck_payout(..., false)` end in `TransferFailed` and do not create a refund record, so they cannot be combined with recredit. Plain USDC sent without an order-specific recredit call remains unallocated.

These rules are PROPOSED pending backend approval.

- Who proves that a refund belongs to an order?
- What is the refund transaction hash and how is it verified?
- What happens if two orders refund the same amount?
- What happens if anyone sends USDC to the vault without an order?
- What happens if only part of an order amount returns?
- What happens if a late paid event arrives after a recredit?
- How does the backend prove the refund transaction and observed token balance before calling recredit?
- Should `actual_token_balance` be supplied by the registration relayer, an owner, or a trusted reconciliation process?

## Other OPEN contract questions

- The confirmed payout signature is now `payout(order_id, amount, deposit_address)` instead of `payout(order_id)`. This needs backend approval, and the relayer allowlist must permit both additional arguments.
- Public order and payout amounts use near-sdk `U128` JSON values, serialized as decimal strings; the contract keeps `u128` for internal arithmetic. Backend callers must send amounts as JSON strings.

- Is the order ID the same as the backend `po_` payout ID?
- What expiry time unit is final?
- How is corridor encoded?
- Which account registers orders, and how does key rotation work?
- What exact refs and status format does `set_status` accept?
- `get_policy` returns only when Aria's real policy design and implementation is approved. Dapper's guarded recredit is now wired, but the public flow remains PROPOSED pending refund proof.
- Which event payload fields and version does the backend approve?
- What agent identity is required for relayed calls?
- What counts toward agent daily limits?
