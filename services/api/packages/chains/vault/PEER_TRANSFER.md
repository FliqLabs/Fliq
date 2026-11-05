# Vault to vault transfer (proposal, for the contract team)

Screen "Pay a fliq user" moves USDC between two users' vault balances: instant, no fee, no provider. The contract in `INTERFACE.md` has no method for it: `payout` does a plain `ft_transfer` to an address, which would leave the recipient's USDC outside their vault.

## Proposed method

| Method | Caller | Effect | Refused when |
| --- | --- | --- | --- |
| `transfer({ to_account, amount })` | The payer, directly or by meta transaction through the relayer | Moves `amount` from the payer's `available` to `to_account`'s `available` | `to_account` has no storage registration; amount 0; insufficient available; same account; the signing key's agent policy refuses it |

Event: `transferred` with `from`, `to`, `amount`.

## Why the backend does not move the funds

The backend never holds a key that can move a user's vault funds. The sender signs `transfer`; the backend only:

1. Looks the recipient up by fliq name (`GET /v1/people/{name}`) so the app shows who it is paying.
2. Reads the sender's balance (`GET /v1/vault`), where the chain is authoritative.
3. Records the transfer when the NEAR watcher sees `transferred` (`recordObservedTransfer`): one `core.transfers` row and one `VAULT_TRANSFER` ledger posting, keyed by the transaction hash so a replay does nothing.

An agent key's per-payout and daily caps should apply to `transfer` as they do to `payout`.
