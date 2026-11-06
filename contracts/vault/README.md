# contracts/vault

The fliq USDC vault on NEAR: per-user balances, approved payout orders executed once, and agent spending policies. Owners: sQuiDbOb (lead), Dapper (balances), Aria (agent policy).

The plan, method names and responsibilities are in the contract team guide (FLIQ Smart Contract Team Guide, 30 Oct 2026). The crate pins its Rust toolchain in `rust-toolchain.toml`.

## Vault and policy integration

Accounts must call `storage_deposit` before depositing USDC. The vault accepts `ft_transfer_call` only from its configured USDC contract. An empty message credits the NEP-141 `sender_id`; the strict `{"top_up":{"account_id":"<account>"}}` message credits that registered account. Malformed messages, unknown fields and unregistered beneficiaries return the full token amount. Accepted deposits emit the provisional `fliq_vault` `deposited` event consumed by the backend adapter.

`register_order` reserves the payer's funds immediately. `payout` accepts the payer directly or a distinct NEAR agent account with an active owner-created policy, and commits the reservation only after the approved USDC contract confirms its transfer. A failed callback leaves the order registered and retryable. `release_order` restores a reservation, and the registration account can advance the public receipt through the agreed backend status graph.

Agent policies enforce a per-payout cap, a daily cap that includes pending transfers, optional exact corridor allowlists, cooldown, expiry and revocation. A policy is keyed by its owner and a distinct agent account, so naming someone as your agent only ever spends your own funds. Agents can pay out registered orders and nothing else: `transfer` always moves the caller's own balance. Failed payouts release same-day policy spend; successful payouts remain counted even if later refunded. `set_agent` stores the policy and pays for its storage from the attached deposit (the rest is refunded), `remove_agent(agent_id)` revokes it, and `get_policy(owner, agent_id)` shows every field, revoked policies included. Changing a policy needs an attached deposit and revoking needs exactly 1 yoctoNEAR, so a function-call key cannot do either. The agent is identified by its own account because a relayed NEP-366 call reports the relayer's key as the signer; an agent must never hold a key on the owner's account.

`recredit` is registration-account-only and queries the vault's real USDC balance before restoring a refunded payout. The amount cannot exceed the original outflow or the vault's unattributed token balance, and each order can be recredited once. `transfer` moves available balances between two registered vault users without changing aggregate liabilities.

The registration account is fixed at initialization and rotates keys on that account rather than through a contract setter. Receipt reference fields are write-once. A recredit requires a recorded `refund_tx`, and each refund transaction can back at most one order across the contract; only a successful recredit can mark the receipt `refunded`. The complete event wire fixture is `tests/fixtures/events.jsonl`, shared with the backend parser tests.

Order storage is currently funded by the vault account and must be included in the contract team's deployment funding decision.

Rules:

- Changes to balances, permissions or outgoing transfers need two contract owners to approve.
- Fixed integer token amounts only. No `unwrap()` or `expect()` on caller-reachable paths.
- Tests read the canonical payout from `spec/fixtures/quote.usdc-ngn-50.json`.
- Deploys to testnet run through the `Deploy contract` workflow, approved by sQuiDbOb. The workflow deploys without an init call; after deployment, the vault account itself must call `new(owner, registration_account, approved_usdc_token_contract)` as the predecessor. No deployer keys in the repository.

Initialization is deliberately self-authorized. The `new` call must be signed and sent by the deployed vault account, with the vault account as the transaction predecessor; an external deployer or any other account cannot initialize it. The initialization arguments are the immutable owner, registration account, and approved USDC token contract.

Upgrading an initialized pre-policy vault requires deploying the new Wasm and calling the private `migrate()` method from the vault account in the same controlled upgrade procedure. Migration preserves the token configuration, vault ledger, orders, receipts, refund evidence and payout keys, then initializes empty agent-policy maps. Do not call `new` on an existing vault. A fresh deployment uses `new` and does not call `migrate`.

```
make test-contract
```

## sQuiDbOb side

This side owns order registration, payout state transitions, backend status reporting, receipts, and the integration boundary for balances and policy decisions. It verifies on-chain transfer state separately from backend-reported progress. Registration reserves funds; a failed USDC transfer keeps that reservation and returns the order to its retryable registered state.

It does not implement provider allowlists, rate comparison, money conversion, or bank transfers. The backend verifies refund transactions before calling `recredit`; the contract records the refund transaction once and independently queries its real USDC balance before crediting. Dapper's real vault ledger and Aria's production policy module are active.

From a fresh clone, run the vault tests and mock-token tests with one shell command:

```sh
(cd contracts/vault && cargo test --features testing) && cargo test --manifest-path contracts/mock_usdc/Cargo.toml
```

## OPEN items

Search all temporary and unresolved design markers with:

```sh
rg -n 'TEMPORARY|OPEN:' contracts docs
```

The current OPEN list is maintained in [docs/DECISIONS.md](docs/DECISIONS.md): order/`po_` ID mapping, corridor encoding, provider allowlists, storage cleanup, and testnet deployment details.
