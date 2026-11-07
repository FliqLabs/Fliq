# Vault interface (L18)

**Status: FINAL from the backend side, 6 November 2026.** The backend accepts this document as its final interface, including the decisions below. It still needs written approval from the contract team (sQuiDbOb, Dapper, Aria). The contract freezes on 12 November 2026.

Source: architecture §11.1 to §11.4, assignment v1.1 requirements A1, A3, A4 and A5. Compared with the contract on branch `Dapper-Vault` at `0afa89e`. The TypeScript in this folder (`types.ts`, `events.ts`) is being updated to match the decisions below; until then, this document is the reference.

## Backend decisions, 6 November 2026

These answer the eight questions the contract team asked the backend. Where they change the proposal, the tables further down are already updated.

### 1. The interface is final

The backend will not ask for further changes beyond the ones in this section. Anything new after 12 November goes into a later version of the contract, not this one.

### 2. Registration account

| Network | Account |
| --- | --- |
| testnet | `fliq-registrar.testnet` |
| mainnet | `registrar.fliq.near` |

- **Ownership:** the backend owns and creates the account. Its full-access key stays offline. The API holds only a function-call key restricted to the vault contract and the methods `register_order`, `set_status`, `recredit` and `release_order`.
- **Contract side:** the contract takes the account in `new(approved_usdc, registrar)` and stores it. It has no method to change it.
- **Key rotation:** happens on the registration account itself, by adding the new access key and deleting the old one. No contract call is needed.

### 3. Proving which agent paid: by account, not by key

NEP-366 sets the receipt's `signer_public_key` to the relayer's key. A relayed `payout` therefore cannot see the agent's key, and `env::signer_account_pk()` cannot be used. Only `env::predecessor_account_id()` reliably names who signed the delegate.

So each agent gets its own NEAR account, and policies are keyed by that account.

- **Agent account:** a sub-account of the user, for example `agent-1.ada.fliq.near`. The account holds no funds. Its only power is the vault policy.
- **Granting:** the payer calls `set_agent({ agent_id, per_payout_cap, daily_cap, corridors })` to create or replace an agent policy.
- **Revoking:** the payer calls `remove_agent({ agent_id })`. Revocation is immediate, whoever holds the agent's keys.
- **Who may call `payout`:** the payer of the order, or an agent account with a policy owned by the payer. The policy limits apply only to an agent.
- **Interface changes:** `get_policy({ public_key })` becomes `get_agent({ agent_id })`. The `payout_executed` event replaces `public_key` with `executor`, the predecessor account.
- **Relayer:** it already relays `payout` from any sender. It adds `set_agent` and `remove_agent` to the allowed vault methods.

### 4. Evidence linking a refund to an order

A NEAR contract cannot read past transactions, so the contract cannot verify a refund transaction. The backend verifies it. The contract bounds what a wrong or stolen registration key can do, and records the evidence publicly.

- **Where refunds land:** on the Intents route, the 1Click `refundTo` is the vault contract, not the user's account. A 1Click refund is a plain `ft_transfer`, so it lands in the vault's unattributed balance. That balance is the only source `recredit` draws from.
- **Before calling `recredit`, the backend checks that:**
  - the refund transaction succeeded on NEAR;
  - its token is the approved USDC and its receiver is the vault;
  - 1Click reports `REFUNDED` for this order's deposit address, or the provider reports the order refunded, with the same refunded amount;
  - the transaction hash has never been used for another order. The database enforces this with a unique index.
- **Public record:** the backend first calls `set_status(order_id, "refunding", { refund_tx })`, so the receipt names the transaction before any money moves. Anyone can compare the two.
- **Contract bounds (unchanged):** the order must be `executed`. The amount must be at most the order amount and at most the unattributed balance. One recredit per order.

**Refunds by the provider.** Payouts are funded on NEAR only; there is no Base or other EVM leg. A provider's refund address is the vault contract, so its refund arrives the same way as a 1Click refund: a plain `ft_transfer` of NEAR USDC into the unattributed balance. The backend checks it the same way, except that the provider's order status (`refunded`, with the refund transaction hash) takes the place of the 1Click status. The backend never holds refunded funds.

### 5. Partial refunds and multiple refund transactions

- **Partial refunds are allowed:** `recredit` takes any amount from 1 up to the order amount. A refund is often smaller than the payout, because the hop and the provider keep their fees.
- **One refund per order:** an order has one deposit address and so receives at most one refund, so the contract keeps `ALREADY_RECREDITED`.
- **A second refund for the same order** stays in the unattributed balance. Ops raise an alert and handle it by hand. The contract does not reopen a refunded order.

### 6. Final `refs` fields and the payout-status mapping

There are four `refs` keys, and no others:

| Key | Value |
| --- | --- |
| `provider` | adapter id, for example `paycrest` |
| `provider_order` | the provider's order id |
| `bank_reference` | the reference the bank or mobile-money network gave |
| `refund_tx` | the NEAR transaction hash that funded the recredit |

- **Format:** each value is ASCII, at most 128 bytes.
- **Write-once:** `set_status` merges the new keys into the stored refs. It refuses to change a key that already has a value, with the new error code `REF_IMMUTABLE`.
- **`refunded`:** only `recredit` sets it. `set_status` can no longer write `refunded`, so a receipt cannot say "refunded" unless the money came back.

| Backend payout state | Vault call |
| --- | --- |
| `created`, `provider_timeout`, `awaiting_recon`, `awaiting_deposit` | `register_order` happens during `created`; no status |
| `deposit_seen` | none; the contract set `state = executed` in `payout` |
| `routing`, `with_provider`, `paying_out`, `settled` | `set_status` with the same name |
| `refunding` | `set_status("refunding", { refund_tx })` |
| `refunded` | `recredit` |
| `expired` | `release_order` |
| `failed` before the deposit | `release_order` |
| `failed` from `refunding` | `set_status("failed")`; ops follow up |

### 7. Watcher acceptance test

- **Shared file:** the contract's unit tests write every event they emit to `contracts/vault/tests/events.log`, one `EVENT_JSON:` line per event. It covers each event in the table below at least once.
- **Backend check:** a backend test runs every line of that file through `parseVaultEvents`. It fails on any line that throws or that maps to no known event.
- **Contract change:** any change to an event must update that file, so the backend test catches the drift.
- **Ownership:** the contract team owns the file. The backend owns the test.

### 8. The 1Click `customRecipientMsg` top-up test

1Click runs on mainnet only, so the test runs against a throwaway mainnet deployment of the same wasm at `vault-test.fliq.near`, with at most 5 USDC in total. Oladipo runs it after the contract team ships the `top_up` message form.

| Case | Expected |
| --- | --- |
| A 1Click top-up into the vault, `customRecipientMsg` = `top_up` for a registered account | that account's `available` rises by the delivered amount; `deposited` event with `sender_id` = 1Click's account |
| Same, for an unregistered account | answers the open question below: record where the returned amount ends up |
| A quote left to expire with `refundTo` = vault | plain `ft_transfer` into the vault; unattributed balance rises; no event |
| A `msg` that is neither `""` nor `top_up` | the amount is returned |

- **Monitoring:** the NEAR watcher runs against the test contract the whole time. The 1Click status endpoint is polled for each deposit address.
- **Result:** the outcome, the transaction hashes and the answer to the unregistered case are recorded in this folder as `TOPUP_TEST.md`.
- **Gate:** top-ups stay disabled in production until every case passes.

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
| `payout({ order_id })` | The payer, or an agent account the payer registered (`predecessor_account_id`), directly or by meta transaction through the relayer | Checks the agent's policy when the caller is an agent; transfers `amount` to `deposit_address`; order becomes `executed` | not the payer or one of its agents; not `registered`; expired; over the agent's per-payout cap, daily cap or corridor list |
| `set_agent({ agent_id, per_payout_cap, daily_cap, corridors })` **new** | The payer | Creates or replaces the policy of `agent_id` for the caller | caps 0; `agent_id` already an agent of another payer |
| `remove_agent({ agent_id })` **new** | The payer | Deletes the policy; the agent can no longer pay | no such agent for the caller |
| `release_order({ order_id })` **new** | Registration account at any time, or the payer after expiry | Returns `reserved` to `available`; order becomes `released` | not `registered`; payer calling before expiry |
| `set_status({ order_id, status, refs })` | Registration account | Writes the receipt status and merges in new references | transition not in the table below; changing an existing ref |
| `recredit({ order_id, amount })` | Registration account | Credits `amount` back to the payer's `available` from the unattributed balance; status becomes `refunded` | not `executed`; status not `refunding`; already re-credited; amount 0; amount above the order amount; amount above the unattributed balance |

`MAX_ORDER_TTL`: proposed 1 hour. It bounds how long a stolen registration key could lock a payer's funds in a reservation.

If the `ft_transfer` in `payout` fails, its callback must restore the reservation to `registered`.

### Views

| View | Returns |
| --- | --- |
| `get_receipt({ order_id })` | `{ order_id, payer, deposit_address, amount, expires_at_ns, corridor, state, status, refs, recredited_amount }` or `null` |
| `get_balance({ account_id })` | `{ available, reserved, total }` (exists) |
| `get_agent({ agent_id })` | `{ owner, per_payout_cap, daily_cap, spent_today, corridors }` or `null`; `corridors` null means any. Policy design belongs to Aria |

### Order states and receipt statuses

`state` is owned by the contract: `registered` → `executed` or `released`.

`status` is written by the registration account only after `executed`:

| From | Allowed next statuses |
| --- | --- |
| (none, just executed) | `routing`, `with_provider`, `paying_out`, `settled`, `refunding`, `failed` |
| `routing` | `with_provider`, `paying_out`, `settled`, `refunding`, `failed` |
| `with_provider` | `paying_out`, `settled`, `refunding`, `failed` |
| `paying_out` | `settled`, `refunding`, `failed` |
| `refunding` | `failed` (`refunded` is set only by `recredit`) |
| `settled`, `refunded`, `failed` | none (terminal) |

`refs` keys: `provider`, `provider_order`, `bank_reference`, `refund_tx`. Values are ASCII, at most 128 bytes, and write-once. No account numbers, names or phone numbers, ever: receipts are public.

### Events (NEP-297)

`EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"<name>","data":[{...}]}`

| Event | Data |
| --- | --- |
| `order_registered` | `order_id, payer, deposit_address, amount, expires_at_ns, corridor` |
| `payout_executed` | `order_id, payer, deposit_address, amount, executor` |
| `agent_set` **new** | `owner, agent_id, per_payout_cap, daily_cap, corridors` |
| `agent_removed` **new** | `owner, agent_id` |
| `order_released` | `order_id, payer, amount` |
| `status_set` | `order_id, status, refs` |
| `recredited` | `order_id, payer, amount` |
| `deposited` | `account_id, sender_id, amount` (both message forms) |

The backend's reconciler (L09) and NEAR watcher (L10) depend on these. A missing event means a mismatch alert.

### Errors

Refusals panic with `fliq_vault: <CODE>` so the backend can map them: `UNAUTHORIZED`, `ORDER_EXISTS`, `ORDER_NOT_FOUND`, `INVALID_AMOUNT`, `INVALID_EXPIRY`, `INSUFFICIENT_BALANCE`, `ORDER_NOT_REGISTERED`, `ORDER_EXPIRED`, `ORDER_NOT_EXPIRED`, `POLICY_PER_PAYOUT_CAP`, `POLICY_DAILY_CAP`, `POLICY_CORRIDOR`, `INVALID_TRANSITION`, `NOT_REFUNDABLE`, `ALREADY_RECREDITED`, `RECREDIT_EXCEEDS_ORDER`, `RECREDIT_EXCEEDS_UNATTRIBUTED`, `INVALID_REF`, `REF_IMMUTABLE`, `AGENT_NOT_FOUND`, `AGENT_TAKEN`.

## Storage

Function-call keys cannot attach a deposit, so the registration key cannot pay for order storage. The contract must either fund order storage from its own NEAR balance (and keep enough NEAR on the vault account) or delete orders once final. The review of the first contract milestone raised the same point.

## Questions for the contract team

1. Do you accept the `top_up` message form, and can you test the 1Click `customRecipientMsg` path on testnet with a small amount?
2. Do you accept `release_order` and the 1 hour `MAX_ORDER_TTL`?
3. Who funds order storage, and are final orders deleted?
4. Testnet account and deployment date (needed by 6 November), and the wasm for local Docker Compose.
