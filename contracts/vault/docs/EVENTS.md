# Events

All events use NEP-297 with `standard: "fliq_vault"`, `version: "1.0.0"`, and a non-empty `data` array. Integer amounts and timestamps are JSON strings. No payload contains personal data.

| Event | Fields |
| --- | --- |
| `order_registered` | `order_id`, `payer`, `deposit_address`, `amount`, `expires_at_ns`, `corridor` |
| `payout_executed` | `order_id`, `payer`, `deposit_address`, `amount`, `public_key` |
| `order_released` | `order_id`, `payer`, `amount` |
| `status_set` | `order_id`, `status`, structured `refs` |
| `recredited` | `order_id`, `payer`, `amount` |
| `deposited` | `account_id`, `sender_id`, `amount` |
| `transferred` | `from`, `to`, `amount` |

The canonical wire examples are in `../tests/fixtures/events.jsonl` and are shared with the backend event-parser tests.
