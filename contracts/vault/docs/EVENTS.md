# Events

All events use NEP-297 with `standard: "fliq_vault"` and `version: "1.0.0"`. Payload fields are PROPOSED until the backend lead approves them. Amounts are JSON strings and no payload contains personal data.

| Event | Fields |
| --- | --- |
| order_registered | `order_id`, `amount`, `expiry`, `corridor` |
| payout_executed | `order_id`, `transfer_state` |
| status_set | `order_id`, `status`, `refs`, `last_updated` |
| recredited | `order_id`, `amount` |
| order_released | `order_id` |

Examples:

```text
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"order_registered","data":{"order_id":"po_1","amount":"50000000","expiry":"2000000000","corridor":"USDC-NGN"}}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"payout_executed","data":{"order_id":"po_1","transfer_state":"Dispatched"}}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"status_set","data":{"order_id":"po_1","status":"settled","refs":"provider/ref","last_updated":"2000000000"}}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"recredited","data":[{"order_id":"po_1","amount":"50000000"}]}
EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"order_released","data":{"order_id":"po_1"}}
```
