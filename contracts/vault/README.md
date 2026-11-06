# contracts/vault

The fliq USDC vault on NEAR: per-user balances, approved payout orders executed once, and agent spending policies. Owners: sQuiDbOb (lead), Dapper (balances), Aria (agent policy).

The plan, method names and responsibilities are in the contract team guide (FLIQ Smart Contract Team Guide, 30 Oct 2026). The crate pins its Rust toolchain in `rust-toolchain.toml`.

## Dapper vault milestone

Accounts must call `storage_deposit` before depositing USDC. The vault accepts `ft_transfer_call` only from its configured USDC contract. An empty message credits the NEP-141 `sender_id`; the strict `{"top_up":{"account_id":"<account>"}}` message credits that registered account. Malformed messages, unknown fields and unregistered beneficiaries return the full token amount. Accepted deposits emit the provisional `fliq_vault` `deposited` event consumed by the backend adapter.

The crate-private reservation helpers move funds between `available` and `reserved`, consume a successful outflow once, and release a failed outflow once. Committed outflows retain one refund record, and the internal recredit operation atomically checks the original outflow, the token balance observed by its callback and prior recredit before restoring a liability. It is intentionally not a public contract method until the contract lead wires the approved order-status, caller-authorization and token-balance callback flow.

This milestone does not expose a withdrawal or payout path. Deposited USDC remains in the vault until the contract lead integrates the order execution flow. Reservation records are removed after commit or release; a committed order ID cannot be reserved again because its refund record acts as a tombstone.

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
