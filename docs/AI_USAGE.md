# AI usage

The NEAR HACKATHON rules require listing AI-generated code. Add a row whenever an AI tool generated a file or a substantial block.

| Date | Path | Tool | What was generated |
| --- | --- | --- | --- |
| 2026-10-31 | Repository skeleton: root config, `.github/`, `docs/`, `spec/`, `services/api/src/mock.ts`, area READMEs | Claude | Initial monorepo structure, CI, contribution rules, OpenAPI spec draft, fixtures and mock server |
| 2026-11-04 | `contracts/vault/src/{lib.rs,types.rs,orders.rs,receipts.rs,integration.rs,temp_vault.rs,temp_policies.rs}`, `contracts/vault/tests/contract.rs`, `contracts/mock_usdc`, `docs/{CONTEXT,DECISIONS,HANDOFF,REVIEW}.md` | Codex | Orders, payout, callback, receipts, temporary vault and policy stand ins, mock USDC and tests, scaffolded from the contract requirements and reviewed by sQuiDbOb |
| 2026-11-03 | `contracts/vault` crate, ledger and tests | Codex | Approved-USDC deposits, storage registration, balance and reservation accounting, and regression tests |
| 2026-11-04 | `contracts/vault/src/vault.rs`, `contracts/vault/README.md` | Codex | Transient reservation cleanup and accounting/storage regression tests |
| 2026-11-05 | `contracts/vault`, `README.md` | Codex | Standard NEP-141 receiver and NEP-145 storage interfaces using the official NEAR contract standards crate |
| 2026-11-05 | `contracts/vault/src` | Codex | Storage lifecycle, refund-recipient, forced-unregister and adversarial reservation regression tests |
| 2026-11-05 | `contracts/vault/src/vault.rs` | Codex | Combined available-and-reserved balance overflow protection and regression coverage |

The iOS app (`apps/ios`) is written by hand.
# AI usage disclosure

- `contracts/vault/src/{lib.rs,types.rs,orders.rs,receipts.rs,integration.rs,temp_vault.rs,temp_policies.rs}` and `contracts/vault/tests/contract.rs`: scaffolded and tested with Codex from the contract requirements.
