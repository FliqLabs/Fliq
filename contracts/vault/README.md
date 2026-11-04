# contracts/vault

The fliq USDC vault on NEAR: per-user balances, approved payout orders executed once, and agent spending policies. Owners: sQuiDbOb (lead), Dapper (balances), Aria (agent policy).

The plan, method names and responsibilities are in the contract team guide (FLIQ Smart Contract Team Guide, 30 Oct 2026). Scaffold with `cargo near new` in this folder and pin the toolchain in `rust-toolchain.toml`.

Rules:

- Changes to balances, permissions or outgoing transfers need two contract owners to approve.
- Fixed integer token amounts only. No `unwrap()` or `expect()` on caller-reachable paths.
- Tests read the canonical payout from `spec/fixtures/quote.usdc-ngn-50.json`.
- Deploys to testnet run through the `Deploy contract` workflow, approved by sQuiDbOb. No deployer keys in the repository.

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
