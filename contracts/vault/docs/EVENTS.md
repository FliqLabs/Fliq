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
| `agent_set` | `owner`, `public_key`, `agent_id`, `per_payout_cap`, `daily_cap`, `corridors`, `cooldown_ns`, `expiry_ns` |
| `agent_revoked` | `owner`, `agent_id`, `public_key` |
| `agent_spend` | `owner`, `agent_id`, `order_id`, `amount` |

The canonical wire examples are in `../tests/fixtures/events.jsonl` and are shared with the backend event-parser tests.

Examples (all proposed until the backend approves the payloads):

```text
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"agent_set","data":[{"owner":"owner.testnet","public_key":"ed25519:...","agent_id":"agent.testnet","per_payout_cap":"100","daily_cap":"1000","corridors":["NG-NGN-bank"],"cooldown_ns":"0","expiry_ns":"3600000000000"}]}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"agent_revoked","data":[{"owner":"owner.testnet","agent_id":"agent.testnet","public_key":"ed25519:..."}]}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"agent_spend","data":[{"owner":"owner.testnet","agent_id":"agent.testnet","order_id":"po_123","amount":"100"}]}
```

## Dapper to convert

`vault.rs` owns the current ledger event implementation and its fields. Dapper must confirm or convert its standard and version to the envelope above without changing ledger behavior. The current `recredited` example remains in `tests/fixtures/events.jsonl`.
