# Vault interface proposal (L18)

**Status: PROPOSED.** Needs written approval from the contract team (sQuiDbOb, Dapper, Aria) and Oladipo. Freeze target: 4 November 2026.

Source: architecture §11.1 to §11.4, assignment v1.1 requirements A1, A3, A4 and A5. Compared with the contract on branch `Dapper-Vault` at `0afa89e`. The TypeScript in this folder (`types.ts`, `events.ts`) encodes exactly this document; the backend builds against it and a mock until a testnet deployment exists.

## What the contract has today (`0afa89e`)

| Spec §11.4 item | In the contract |
| --- | --- |
| `get_balance(account_id)` | Yes: `{ available, reserved, total }` as U128 strings |
| NEP-145 `storage_deposit` and friends | Yes; an account must register before it can hold a balance |
| `ft_on_transfer` | Yes, from the approved USDC contract only; credits `sender_id`; **returns the full amount when `msg` is not empty** |
| reserve, commit and release of a reservation | Internal helpers only, not callable |
| `register_order`, `payout`, `set_status`, `recredit` | Missing |
| `get_receipt`, `get_policy` | Missing |
| Events | None |

## Blocking incompatibility: top-ups through 1Click (A1)

A1 needs a top-up from any chain to credit the user's vault balance. 1Click delivers to a NEAR account in one of two ways (1Click OpenAPI 0.1.10, `QuoteRequest.customRecipientMsg`):

1. Without `customRecipientMsg`: plain `ft_transfer`. The vault is never called, so the USDC lands in the vault's token balance and is credited to nobody.
2. With `customRecipientMsg`: `ft_transfer_call` with that message. Today the vault returns the whole amount because the message is not empty. Even with an empty message it would credit `sender_id`, which is the account 1Click withdraws from, not the user.

So **A1 cannot work against `0afa89e`**. The backend will not work around this (for example by receiving and forwarding funds itself), because that would make the backend custodial.

1Click marks `customRecipientMsg` as highly experimental and warns that funds are lost when the recipient has no storage registration or no `ft_on_transfer`. Both are handled below, but the path must be proven on testnet with a small amount before top-ups are enabled.

### Proposal

`ft_on_transfer` accepts exactly two message forms from the approved USDC contract:

| `msg` | Effect |
| --- | --- |
| `""` | Unchanged: credit `sender_id` if registered, else return the amount |
| `{"top_up":{"account_id":"<account>"}}` | Credit `account_id` if registered, else return the amount |
| anything else | Return the amount |

This is safe: the sender gives away its own tokens, so crediting another account takes nothing from anyone. The backend only issues a top-up quote after checking `storage_balance_of(account_id)`, and L12 sponsors that storage deposit for new users.

Open question for the contract team: when 1Click is the sender and the vault returns an amount, where does it end up? Until that is answered on testnet, an unregistered beneficiary is a loss case, which is why the backend pre-checks registration.

## Proposed interface

Amounts are USDC base units as U128 strings. Timestamps are nanoseconds as U64 strings, matching `env::block_timestamp`. `order_id` is our payout id: ASCII, at most 64 characters. `corridor` is `<country>-<currency>-<payout_type>`, for example `NG-NGN-bank`.

### Change methods

| Method | Caller | Effect | Refused when |
| --- | --- | --- | --- |
| `register_order({ order_id, payer, deposit_address, amount, expires_at_ns, corridor })` | Registration account | Moves `amount` from the payer's `available` to `reserved`; order becomes `registered` | not the registration account; duplicate id; amount 0; insufficient available; expiry in the past or more than `MAX_ORDER_TTL` ahead |
| `payout({ order_id })` | The payer (`predecessor_account_id`), directly or by meta transaction through the relayer | Checks the signing key's agent policy if it has one; transfers `amount` to `deposit_address`; order becomes `executed` | not the payer; not `registered`; expired; over the per-payout cap, daily cap or corridor list of the signing key |
| `release_order({ order_id })` **new** | Registration account at any time, or the payer after expiry | Returns `reserved` to `available`; order becomes `released` | not `registered`; payer calling before expiry |
| `set_status({ order_id, status, refs })` | Registration account | Writes the receipt status and references | transition not in the table below |
| `recredit({ order_id, amount })` | Registration account | Credits `amount` back to the payer's `available` from the unattributed balance; status becomes `refunded` | not `executed`; status not `refunding` or `refunded`; already re-credited; amount 0; amount above the order amount; amount above the unattributed balance |

`MAX_ORDER_TTL`: proposed 1 hour. It bounds how long a stolen registration key could lock a payer's funds in a reservation.

If the `ft_transfer` in `payout` fails, its callback must restore the reservation to `registered`.

### Views

| View | Returns |
| --- | --- |
| `get_receipt({ order_id })` | `{ order_id, payer, deposit_address, amount, expires_at_ns, corridor, state, status, refs, recredited_amount }` or `null` |
| `get_balance({ account_id })` | `{ available, reserved, total }` (exists) |
| `get_policy({ public_key })` | `{ owner, per_payout_cap, daily_cap, spent_today, corridors }` or `null`; `corridors` null means any. Policy design belongs to Aria |

### Order states and receipt statuses

`state` is owned by the contract: `registered` → `executed` or `released`.

`status` is written by the registration account only after `executed`:

| From | Allowed next statuses |
| --- | --- |
| (none, just executed) | `routing`, `with_provider`, `paying_out`, `settled`, `refunding`, `failed` |
| `routing` | `with_provider`, `paying_out`, `settled`, `refunding`, `failed` |
| `with_provider` | `paying_out`, `settled`, `refunding`, `failed` |
| `paying_out` | `settled`, `refunding`, `failed` |
| `refunding` | `refunded`, `failed` |
| `settled`, `refunded`, `failed` | none (terminal) |

`refs` keys: `provider`, `provider_order`, `bank_reference`, `refund_tx`. No account numbers, names or phone numbers, ever: receipts are public.

### Events (NEP-297)

`EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"<name>","data":[{...}]}`

| Event | Data |
| --- | --- |
| `order_registered` | `order_id, payer, deposit_address, amount, expires_at_ns, corridor` |
| `payout_executed` | `order_id, payer, deposit_address, amount, public_key` |
| `order_released` | `order_id, payer, amount` |
| `status_set` | `order_id, status, refs` |
| `recredited` | `order_id, payer, amount` |
| `deposited` | `account_id, sender_id, amount` (both message forms) |

The backend's reconciler (L09) and NEAR watcher (L10) depend on these. A missing event means a mismatch alert.

### Errors

Refusals panic with `fliq_vault: <CODE>` so the backend can map them: `UNAUTHORIZED`, `ORDER_EXISTS`, `ORDER_NOT_FOUND`, `INVALID_AMOUNT`, `INVALID_EXPIRY`, `INSUFFICIENT_BALANCE`, `ORDER_NOT_REGISTERED`, `ORDER_EXPIRED`, `ORDER_NOT_EXPIRED`, `POLICY_PER_PAYOUT_CAP`, `POLICY_DAILY_CAP`, `POLICY_CORRIDOR`, `INVALID_TRANSITION`, `NOT_REFUNDABLE`, `ALREADY_RECREDITED`, `RECREDIT_EXCEEDS_ORDER`, `RECREDIT_EXCEEDS_UNATTRIBUTED`.

## Storage

Function-call keys cannot attach a deposit, so the registration key cannot pay for order storage. The contract must either fund order storage from its own NEAR balance (and keep enough NEAR on the vault account) or delete orders once final. The review of the first contract milestone raised the same point.

## Questions for the contract team

1. Do you accept the `top_up` message form, and can you test the 1Click `customRecipientMsg` path on testnet with a small amount?
2. Do you accept `release_order` and the 1 hour `MAX_ORDER_TTL`?
3. Who funds order storage, and are final orders deleted?
4. Testnet account and deployment date (needed by 6 November), and the wasm for local Docker Compose.
