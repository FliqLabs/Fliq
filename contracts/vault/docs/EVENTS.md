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
| `agent_spend_reversed` | `owner`, `agent_id`, `order_id`, `amount`: a failed agent payout gave its daily spend back |
| `payout_failed` | `order_id`, `payer`, `amount`: the USDC transfer failed and the reservation went back to `available` |
| `payout_resolved` | `order_id`, `transferred`, `resolved_by`: an operator settled a stuck payout |
| `payout_timeout_set` | `payout_timeout` |
| `withdrawn` | `account_id`, `amount`: USDC left the vault to the user's own account |
| `withdraw_failed` | `account_id`, `amount`: the withdraw transfer failed and the amount is available again |

The canonical wire examples are in `../tests/fixtures/events.jsonl` and are shared with the backend event-parser tests. The fixture contains every event in this table, including `deposited` and the three agent events. Contract tests enforce that coverage, while the backend parser test enforces every field and type.

`transfer` accepts an optional `request_id` call argument. It is intentionally not copied into `transferred`, keeping the frozen event compatible; the backend that submitted the call associates the request with its transaction hash and arguments.

Examples (all proposed until the backend approves the payloads):

```text
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"agent_set","data":[{"owner":"owner.testnet","public_key":"ed25519:...","agent_id":"agent.testnet","per_payout_cap":"100","daily_cap":"1000","corridors":["NG-NGN-bank"],"cooldown_ns":"0","expiry_ns":"3600000000000"}]}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"agent_revoked","data":[{"owner":"owner.testnet","agent_id":"agent.testnet","public_key":"ed25519:..."}]}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"agent_spend","data":[{"owner":"owner.testnet","agent_id":"agent.testnet","order_id":"po_123","amount":"100"}]}
```

## Confirmation

Dapper's deposit, transfer and recredit events use this `fliq_vault` `1.0.0` envelope. The canonical fixture and backend parser acceptance test are the merge gate for future changes.
