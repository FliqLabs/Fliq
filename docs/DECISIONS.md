# Contract decisions

## PROPOSED backend status rules

These rules are PROPOSED and require backend approval:

- `set_status` is callable only by `registration_account`.
- The order must exist and the status must be in `BACKEND_STATUSES`.
- Replaying the same status with the same refs is accepted as a no-op.
- Statuses are monotonic according to the order in `BACKEND_STATUSES`; earlier statuses are rejected.
- `paying_out` and `settled` are accepted only after the verified NEAR `transfer_state` is `Dispatched`.
- Status updates never change the verified transfer state, balances, or policy counts.
- Refs are limited to 256 ASCII identifier characters (`A-Z`, `a-z`, `0-9`, `:`, `/`, `.`, `_`, `-`) to keep personal data out of receipts and events. This format is PROPOSED.

## OPEN refund and recredit questions

- Who proves that a refund belongs to an order?
- What is the refund transaction hash and how is it verified?
- What happens if two orders refund the same amount?
- What happens if anyone sends USDC to the vault without an order?
- What happens if only part of an order amount returns?
- What happens if a late paid event arrives after a recredit?

## Other OPEN contract questions

- Is the order ID the same as the backend `po_` payout ID?
- What expiry time unit is final?
- How is corridor encoded?
- Which account registers orders, and how does key rotation work?
- What exact refs and status format does `set_status` accept?
- Which event payload fields and version does the backend approve?
- What agent identity is required for relayed calls?
- What counts toward agent daily limits?
