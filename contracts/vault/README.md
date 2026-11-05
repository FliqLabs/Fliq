# contracts/vault

The fliq USDC vault on NEAR: per-user balances, approved payout orders executed once, and agent spending policies. Owners: sQuiDbOb (lead), Dapper (balances), Aria (agent policy).

The plan, method names and responsibilities are in the contract team guide (FLIQ Smart Contract Team Guide, 30 Oct 2026). The crate pins its Rust toolchain in `rust-toolchain.toml`.

## Dapper vault milestone

Accounts must call `storage_deposit` before depositing USDC. The vault accepts `ft_transfer_call` only from its configured USDC contract and credits the NEP-141 `sender_id`. Deposit messages are intentionally rejected until the backend and contract team approve a verifiable top-up attribution format.

The crate-private reservation helpers move funds between `available` and `reserved`, consume a successful outflow once, and release a failed outflow once. Refund recredit is not implemented until the team approves the refund proof and attribution design.

This milestone does not expose a withdrawal or payout path. Deposited USDC remains in the vault until the contract lead integrates the order execution flow. Reservation records are transient and removed after commit or release; the permanent order state owned by the contract lead prevents an order ID from being executed again.

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

It does not implement real USDC custody, refund proof, recredit, provider allowlists, rate comparison, money conversion, bank transfers, or Aria/Dapper production policy and vault behavior. The `temp_vault` and `temp_policies` modules are temporary stand-ins.

From a fresh clone, run the vault tests and mock-token tests with one shell command:

```sh
(cd contracts/vault && cargo test --features testing) && cargo test --manifest-path contracts/mock_usdc/Cargo.toml
```

## TEMPORARY and OPEN items

Search all temporary and unresolved design markers with:

```sh
rg -n 'TEMPORARY|OPEN:' contracts docs
```

The current OPEN list is maintained in [docs/DECISIONS.md](../../docs/DECISIONS.md): order/`po_` ID mapping, expiry units, corridor encoding, registration key rotation, refs/status format, event approval, provider allowlists, relayed-agent identity, daily limits, and refund/recredit proof and reconciliation rules.
