# Testnet acceptance

The local sandbox covers top-up, registration, payout, failed payout, release, plain-token refund backing and recredit. Production enablement still requires the following run against the deployed vault and approved USDC contract.

## Required accounts

- vault contract account;
- immutable registration account;
- contract owner account;
- approved testnet USDC account;
- funded payer and recipient accounts, each with approximately 0.02 NEAR;
- at least one maximum-size agent policy funded with no more than 0.01 NEAR;
- an agent account that calls `payout` directly rather than through a relayer needs enough NEAR to prepay
  the 60 Tgas floor, about 0.06 NEAR at the gas price seen on 10 November 2026, well above what its policy
  storage costs.

Never record private keys in this repository. Record only public account IDs and transaction hashes.

## Refund proof

1. Register the payer for vault storage and top it up with approved USDC.
2. Register an order, execute `payout`, and confirm the `payout_executed` event.
3. Send a plain approved-USDC `ft_transfer` back to the vault, reproducing the NEAR Intents refund shape. This transfer must not credit a user automatically.
4. From the registration account, call `set_status(order_id, "refunding", { refund_tx })` with the successful refund transaction hash.
5. From the registration account, call `recredit(order_id, amount)`.
6. Confirm the payer's available balance rises by exactly the refund amount, the receipt is `refunded`, and the same order or refund transaction cannot be reused.

## Additional gates

- Exercise a `top_up` `ft_transfer_call` and confirm the emitted `deposited` payload matches `EVENTS.md`.
- Exercise `transfer` with a `request_id` and confirm the backend stores the request against the submitted transaction.
- Leave a payout executing past its timeout, alert both operators, and have the registration account resolve it only after checking the USDC transaction.
- Run `routing` to `with_provider` to `paying_out` to `settled` only after the payout transfer is dispatched.

The contract team signs off the on-chain results. Backend owns refund evidence verification, watcher ingestion and transaction-to-request correlation.

## Run of 10 November 2026

Run against `fliq-vault.testnet` after deploying `main` at `2b0b385` and calling `migrate` in the same
transaction (`6Tt1o2EPzDSxPyJ6bW8vKx2ZLYd6pSUwkwwa3jd8r8VB`). The deployed code hash is
`4q3bEW9AqiRgSeQb2RvXjiNh1b5D69bKXi6nEgEsq1RV`, SHA-256
`38e1de4e948bb4a3ad194a864cadbaa62ef2ca09865f9042d1e2e3e248b0728c`, 270,648 bytes, which matches the
artifact built by `cargo near build reproducible-wasm`.

Accounts used: vault `fliq-vault.testnet`; owner `fliq-owner.testnet`; registration and payer
`fliqaccount.testnet`; recipient `t1.fliqaccount.testnet`; agent `a1.fliqaccount.testnet`; approved USDC
`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`.

### Refund proof

Run end to end on order `po_claude_check_001`, deliberately routed through `settled` before `refunding` so
the settled-to-refunding transition was exercised on chain:

| Step | Transaction |
| --- | --- |
| `top_up` via `ft_transfer_call` | `DZRwcPDZDzuQoY9XRhZNNGmGN5wu8oY9RHAkdJZyL5yi` |
| `register_order` | `5fP45YVRSevBDSYwaRJYfT9LVuwxhBM12rEmJuqNuvmS` |
| `payout` | `A7cwYuLaMT5UE2bFsGfU1hUQRTKSdDqJPRHNpqQMGiGu` |
| plain `ft_transfer` refund | `J9krBVuJAiLtGarcsZPJEHHLyq93Y1xkkN2PxqMKGA7b` |
| `set_status` to `refunding` | `5ZsXHacz4PoYpnTQEHdt2F5SsrRn8KVaqyM5sywMiV9Q` |
| `recredit` | `zHmJLPpDG5kuFfrUErqT7Fs6Emne2BiQKkkWnpcdqJL` |

The plain refund transfer emitted no `deposited` event, so it credited nobody automatically. The receipt
ended `refunded` with `recredited_amount` equal to the refund. Replaying `recredit` failed with
`ALREADY_RECREDITED`, and moving the refunded order back to `refunding` failed with `STATUS_TERMINAL`.

### Agent policy

`set_agent` (`C4T7jyKBqtZK1Q2CYin1sirHtHfPsRGexzXbcDkh2Uwh`) with a 20,000 per-payout cap, a 50,000 daily
cap and corridor `NG-NGN-bank`. The agent paid `po_claude_agent_001`
(`5ADoJsDYfq7ECj834uStYt79YpFhWCUDWcubVs4K7B8f`). Then, on chain:

- an order above the per-payout cap failed with `POLICY_PER_PAYOUT_CAP`;
- `remove_agent` emitted `agent_revoked`, after which an agent payout failed with `POLICY_REVOKED`;
- the owner reconfigured the revoked policy with `set_agent`, as `DECISIONS.md` describes;
- a payout to an address with no USDC storage registration failed, emitting `agent_spend_reversed` and
  `payout_failed` and returning the reservation;
- `get_policy` then reported `spent_today` of 10,000: the successful payout counted, the failed one
  reversed.

### Solvency

`get_liabilities` against `ft_balance_of` on the approved USDC contract, at every checkpoint:

| Checkpoint | Owed | Held | Unattributed |
| --- | ---: | ---: | ---: |
| After deploy, refund landed and recredit not yet run | 20,100,000 | 20,200,000 | 100,000 |
| After that recredit | 20,200,000 | 20,200,000 | 0 |
| After the refund proof above | 20,290,000 | 20,290,000 | 0 |
| After the agent policy run | 20,280,000 | 20,280,000 | 0 |

The vault was solvent throughout. The only non-zero unattributed balance was a refund in flight awaiting
its `recredit`, which is the state `recredit` exists to settle.

### Events confirmed against the fixture

`deposited`, `transferred`, `withdrawn`, `order_registered`, `order_released`, `payout_executed`,
`payout_failed`, `status_set`, `recredited`, `agent_set`, `agent_revoked`, `agent_spend` and
`agent_spend_reversed` all matched `tests/fixtures/events.jsonl` field for field, including amounts as JSON
strings. `transfer` carried a `request_id` that stayed out of the `transferred` event and remained visible
in the transaction arguments.

### Not covered by this run

- `payout_resolved` and `payout_timeout_set` need the owner key, which was not available.
- A stuck `Executing` payout cannot be manufactured on a healthy chain: a failed transfer resolves through
  the callback into terminal `TransferFailed` rather than hanging. `resolve_stuck_payout` is covered by
  four unit tests that control the clock, and the operator procedure in the gate above is still unrehearsed.
- `withdraw_failed` needs an injected transfer failure.
- Cooldown and daily-cap rollover were not exercised; the policy used a zero cooldown.
