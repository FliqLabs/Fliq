# Forwarded deposits

## Deposit from a derived address

Each Fliq user may have a Chain Signatures derived address on Solana, Base or Ethereum. That derived address is not a NEAR vault account and does not receive a vault balance directly.

The forwarder or 1Click must transfer USDC to `fliq-vault.testnet` with `ft_transfer_call`. The `msg` argument names the NEAR beneficiary:

```json
{"top_up":{"account_id":"user.testnet"}}
```

Example call arguments with USDC base units (6 decimals):

```json
{
  "receiver_id": "fliq-vault.testnet",
  "amount": "5000000",
  "msg": "{\"top_up\":{\"account_id\":\"user.testnet\"}}"
}
```

`5000000` is 5 USDC. JSON amount values are strings.

The contract accepts only this strict shape for a named beneficiary:

- `msg` must parse as JSON.
- The top-level object must have exactly `top_up`.
- `top_up` must have exactly `account_id`.
- `account_id` must be a valid NEAR account ID string.
- Unknown fields, extra fields, missing fields, an empty account ID and malformed JSON are rejected.

The following alternative is valid:

- `msg == ""`: the contract credits `sender_id`, so the `ft_transfer_call` sender is the beneficiary.

No other message format names a beneficiary.

## Registration

Before a forwarder sends a named deposit:

1. The beneficiary NEAR account must have vault storage.
2. The vault must have storage registration on the approved USDC token contract.
3. For direct NEP-141 transfers, the sender must have storage on the USDC token contract.

The exact vault storage command is:

```sh
near contract call-function as-transaction "<user.testnet>" \
  storage_deposit json-args '{"account_id":null,"registration_only":true}' \
  prepaid-gas '30 Tgas' attached-deposit '0.0001 NEAR' \
  sign-with-keychain send network-config testnet
```

The vault registers on the approved USDC token with:

```sh
near contract call-function as-transaction "<usdc-token.testnet>" \
  storage_deposit json-args '{"account_id":"fliq-vault.testnet","registration_only":true}' \
  prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-with-keychain send network-config testnet
```

The sending account uses the same token storage command, changing `account_id` to the sender:

```sh
near contract call-function as-transaction "<sender.testnet>" \
  storage_deposit json-args '{"account_id":"<sender.testnet>","registration_only":true}' \
  prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-with-keychain send network-config testnet
```

Storage deposits are idempotent where already registered.

## Result

After an accepted strict-message deposit, `get_balance(user.testnet)` reports the amount under `available`, `reserved` remains unchanged and `total` is `available + reserved`.

An accepted empty-message deposit credits `sender_id`. A strict message credits only `account_id`, never the forwarder.

The contract emits a `deposited` NEP-297 event containing the beneficiary, sender and string amount.

## Refund and rejection rules

`ft_on_transfer` returns the unused USDC amount. NEP-141 token callback logic refunds that amount to the sender.

- Malformed or unknown message: full refund.
- Strict message for an account not registered in vault storage: full refund.
- Wrong token predecessor: full refund.
- Zero amount: full refund.
- Overflow while adding the beneficiary available balance, total balance or liabilities: full refund.
- Arithmetic overflow never credits the beneficiary.

The backend should detect refunds from the USDC token callback or by watching the sender's USDC balance and the absence of a `deposited` event for the intended beneficiary. It should not infer that a deposit landed from the derived-address balance alone.

## Recredit behavior

Recredit is separate from forwarded deposits. It is only for an existing dispatched payout refund and requires the registration account, write-once refund evidence and real unattributed USDC backing.

The backend must verify the refund transaction, then call `recredit(order_id, amount)` for the allowed amount. Recredit does not change this deposit attribution path.

## Open decisions

PROPOSED: The backend should derive and watch permanent addresses for all three chains.

PROPOSED: The backend or 1Click should forward received USDC to the vault and include the strict JSON message naming the NEAR beneficiary.

OPEN: Which account pays gas on each derived-address chain.

OPEN: Chain Signatures signing latency and retry policy.

OPEN: Which backend watcher owns the Solana, Base and Ethereum arrival state.
