# Contract handoff

Wasm: `contracts/vault/target/wasm32-unknown-unknown/release/fliq_vault.wasm`

SHA-256: `3ddfbb60b898242944db6d4607f3008e0822049757c629569072c23faed19152`

Deployed vault account: `<printed by deployment script>`

Public backend methods (amounts are decimal strings; U64 timestamps are decimal strings):

```json
{"method":"register_order","args":{"order_id":"po_123","payer":"user.testnet","deposit_address":"recipient.testnet","amount":"100","expires_at_ns":"3600000000000","corridor":"NG-NGN-bank"}}
{"method":"payout","args":{"order_id":"po_123","amount":"100","deposit_address":"recipient.testnet"}}
{"method":"set_status","args":{"order_id":"po_123","status":"routing","refs":{"provider_order":"ref_1"}}}
{"method":"release_order","args":{"order_id":"po_123"}}
{"method":"recredit","args":{"order_id":"po_123","amount":"100"}}
{"method":"get_receipt","args":{"order_id":"po_123"}}
{"method":"get_balance","args":{"account_id":"user.testnet"}}
```

Policy methods are `set_agent`, `remove_agent`, and `get_policy`; payout requires at least 50 Tgas. Events and errors are documented in `../docs/EVENTS.md` and `../docs/ERRORS.md`. Open questions are in `../docs/BACKEND_ALIGNMENT.md`.
