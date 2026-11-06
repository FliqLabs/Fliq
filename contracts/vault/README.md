# contracts/vault

The fliq USDC vault on NEAR: per-user balances, approved payout orders executed once, and agent spending policies. Owners: sQuiDbOb (lead), Dapper (balances), Aria (agent policy).

The plan, method names and responsibilities are in the contract team guide (FLIQ Smart Contract Team Guide, 30 Oct 2026). The crate pins its Rust toolchain in `rust-toolchain.toml`.

## Dapper vault milestone

Accounts must call `storage_deposit` before depositing USDC. The vault accepts `ft_transfer_call` only from its configured USDC contract. An empty message credits the NEP-141 `sender_id`; the strict `{"top_up":{"account_id":"<account>"}}` message credits that registered account. Malformed messages, unknown fields and unregistered beneficiaries return the full token amount. Accepted deposits emit the provisional `fliq_vault` `deposited` event consumed by the backend adapter.

`register_order` reserves the payer's funds immediately. `payout` is payer-authorized and commits the reservation only after the approved USDC contract confirms its transfer; a failed callback leaves the order registered and retryable. `release_order` restores a reservation, and the registration account can advance the public receipt through the agreed backend status graph.

`recredit` is registration-account-only and queries the vault's real USDC balance before restoring a refunded payout. The amount cannot exceed the original outflow or the vault's unattributed token balance, and each order can be recredited once. `transfer` moves available balances between two registered vault users without changing aggregate liabilities.

The registration account is fixed at initialization and rotates keys on that account rather than through a contract setter. Receipt reference fields are write-once. A recredit requires a recorded `refund_tx`, and each refund transaction can back at most one order across the contract; only a successful recredit can mark the receipt `refunded`. The complete event wire fixture is `tests/fixtures/events.jsonl`, shared with the backend parser tests.

The current payout authorization is payer-only. Aria's signing-key policy implementation will replace that temporary rule; `get_policy` therefore returns `null` until that work is integrated. Order storage is currently funded by the vault account and must be included in the contract team's deployment funding decision.

Rules:

- Changes to balances, permissions or outgoing transfers need two contract owners to approve.
- Fixed integer token amounts only. No `unwrap()` or `expect()` on caller-reachable paths.
- Tests read the canonical payout from `spec/fixtures/quote.usdc-ngn-50.json`.
- Deploys to testnet run through the `Deploy contract` workflow, approved by sQuiDbOb. The workflow deploys without an init call; after deployment, the vault account itself must call `new(owner, registration_account, approved_usdc_token_contract)` as the predecessor. No deployer keys in the repository.

Initialization is deliberately self-authorized. The `new` call must be signed and sent by the deployed vault account, with the vault account as the transaction predecessor; an external deployer or any other account cannot initialize it. The initialization arguments are the immutable owner, registration account, and approved USDC token contract.

```
make test-contract
```

## sQuiDbOb side

This side owns order registration, payout state transitions, backend status reporting, receipts, and the integration boundary for balances and policy decisions. It verifies on-chain transfer state separately from backend-reported progress, reserves before creating a USDC transfer, and restores temporary reservations when a transfer fails.

It does not implement refund proof, provider allowlists, rate comparison, money conversion, bank transfers, or Aria production policy behavior. Dapper's guarded recredit is wired through the order boundary, but refund proof and observed token-balance authority remain proposed. The `temp_policies` module is a temporary stand-in; Dapper's real vault ledger is active.

From a fresh clone, run the vault tests and mock-token tests with one shell command:

```sh
(cd contracts/vault && cargo test --features testing) && cargo test --manifest-path contracts/mock_usdc/Cargo.toml
```

## TEMPORARY and OPEN items

Search all temporary and unresolved design markers with:

```sh
rg -n 'TEMPORARY|OPEN:' contracts docs
```

The current OPEN list is maintained in [docs/DECISIONS.md](docs/DECISIONS.md): order/`po_` ID mapping, expiry units, corridor encoding, registration key rotation, refs/status format, event approval, provider allowlists, relayed-agent identity, daily limits, and refund/recredit proof and reconciliation rules.
