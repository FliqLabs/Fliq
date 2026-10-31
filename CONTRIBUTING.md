# Contributing to fliq

Everyone works in this one repository. These rules keep `main` green and the demo safe. They apply to humans and to coding agents (agents also follow [AGENTS.md](AGENTS.md)).

## Who owns what

| Area | Folder | Owners (GitHub team) |
| --- | --- | --- |
| iOS | `apps/ios` | `@FliqLabs/ios` |
| Web | `apps/web` | `@FliqLabs/web` |
| API and MCP | `services/` | `@FliqLabs/backend` |
| Vault contract | `contracts/` | `@FliqLabs/contracts` |
| Analytics | `analytics/`, `spec/events/` | `@FliqLabs/analytics` |
| API contract | `spec/openapi.yaml`, `spec/fixtures/` | `@FliqLabs/backend`, `@FliqLabs/web`, `@FliqLabs/ios` |
| Repository | root files, `.github/`, `docs/` | `@FliqLabs/leads` |

Work in your own folder. If you need a change somewhere else, open an issue or ask the owner; do not edit their area.

## How a change gets to main

1. **Branch** from an up-to-date `main`: `area/handle-topic`. Areas: `ios`, `web`, `api`, `contract`, `spec`, `analytics`, `docs`, `ci`.
   - `web/emmanuel-payouts-table`
   - `api/dipo-quote-endpoint`
   - `contract/aria-agent-policy`
2. **Commit** small and often. Write messages a teammate understands without opening the diff. No AI attribution trailers.
3. **Open a pull request** early, as a draft if needed. The title is a conventional commit, because it becomes the squash commit on `main`:
   - `feat(api): add quote endpoint`
   - `fix(web): show fees on the receipt`
   - `test(contract): refuse orders over the daily cap`
   - Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`.
4. **Keep it small**: under about 400 changed lines and no older than two days. Rebase on `main` daily.
5. **CI** runs only the jobs for the folders you touched. One check, `ci-gate`, must be green.
6. **Review**: one approval from the owning team. Contract changes in `contracts/vault/src` need two approvals from `@FliqLabs/contracts`. Changes to `spec/openapi.yaml` or `spec/fixtures/` need approval from backend, web and iOS.
7. **Merge** with squash. Delete the branch.

Nobody pushes to `main` directly, nobody force-pushes a shared branch, and nobody bypasses the checks, admins included.

## The API contract

`spec/` is the agreement between the app, the web, the API and the vault. To change the API:

1. Edit `spec/openapi.yaml`.
2. Update the fixtures in `spec/fixtures/` and list new ones in `spec/fixtures/index.json`.
3. Run `pnpm --filter @fliq/spec generate` and `make test-spec`.
4. Ship all of it in one PR.

From 5 November 2026, spec changes are additive only.

## Code standards

- Readable first: clear names, small functions, no dead code, no commented-out code.
- Comments explain *why*, never *what*. Most files need very few. A PR where comments outnumber code will be sent back.
- Format before pushing: Prettier for TypeScript, `cargo fmt` and `cargo clippy -- -D warnings` for Rust, Xcode's formatter for Swift.
- Tests come with the feature, not at the end.
- Every new dependency is justified in the PR and listed in the README.

## Secrets

- Never commit secrets. Each service has a `.env.example`; your real `.env` is gitignored.
- Real values live in Vercel, Fly and GitHub Environments. Shared development values live in the team password vault.
- If you commit a secret by accident, tell the team immediately and rotate it. Deleting the commit is not enough.

## Freezes

| Date (UTC) | Frozen |
| --- | --- |
| 9 Nov 2026, 23:59 | `apps/web`, `services/`, `spec/` |
| 12 Nov 2026, 23:59 | `contracts/` |
| 13 Nov 2026 | Demo recorded from a tagged green commit |
| 14 Nov 2026, 23:59 | Submission; repository public |

CI rejects PRs into frozen areas. A fix after a freeze needs the `freeze-exception` label, which only the leads can add.

## Releases and deploys

- `main` deploys the web app to Vercel and the API to Fly automatically.
- The contract deploys to testnet only through the `Deploy contract` workflow, approved by the contract lead.
- iOS builds go to TestFlight from Xcode.
- Tags: `pre-hackathon` marks the baseline, `hackathon-submission` marks what judges see. Both are protected.

## Issues

Use the templates. Label with the area. Anything blocking someone else gets the `blocking` label and a mention in the team chat.
