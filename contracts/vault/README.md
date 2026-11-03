# contracts/vault

The fliq USDC vault on NEAR: per-user balances, approved payout orders executed once, and agent spending policies. Owners: sQuiDbOb (lead), Dapper (balances), Aria (agent policy).

The plan, method names and responsibilities are in the contract team guide (FLIQ Smart Contract Team Guide, 30 Oct 2026). The crate pins its Rust toolchain in `rust-toolchain.toml`.

## Dapper vault milestone

Accounts must call `storage_deposit` before depositing USDC. The vault accepts `ft_transfer_call` only from its configured USDC contract and credits the NEP-141 `sender_id`. Deposit messages are intentionally rejected until the backend and contract team approve a verifiable top-up attribution format.

The crate-private reservation helpers move funds between `available` and `reserved`, consume a successful outflow once, and release a failed outflow once. Refund recredit is not implemented until the team approves the refund proof and attribution design.

This milestone does not expose a withdrawal or payout path. Deposited USDC remains in the vault until the contract lead integrates the order execution flow. Reservation records are retained to prevent replay; their storage funding or cleanup policy must be finalized before reservations become externally reachable.

Rules:

- Changes to balances, permissions or outgoing transfers need two contract owners to approve.
- Fixed integer token amounts only. No `unwrap()` or `expect()` on caller-reachable paths.
- Tests read the canonical payout from `spec/fixtures/quote.usdc-ngn-50.json`.
- Deploys to testnet run through the `Deploy contract` workflow, approved by sQuiDbOb. No deployer keys in the repository.

```
make test-contract
```
