# AI usage

The NEAR HACKATHON rules require listing AI-generated code. Add a row whenever an AI tool generated a file or a substantial block.

| Date | Path | Tool | What was generated |
| --- | --- | --- | --- |
| 2026-10-31 | Repository skeleton: root config, `.github/`, `docs/`, `spec/`, `services/api/src/mock.ts`, area READMEs | Claude | Initial monorepo structure, CI, contribution rules, OpenAPI spec draft, fixtures and mock server |

The iOS app (`apps/ios`) is written by hand.
# AI usage disclosure

- `contracts/vault/src/{lib.rs,types.rs,orders.rs,receipts.rs,integration.rs,temp_vault.rs,temp_policies.rs}` and `contracts/vault/tests/contract.rs`: scaffolded and tested with Codex from the contract requirements.
