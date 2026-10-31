# Rules for coding agents

This file applies to every AI coding agent working in this repository: Claude Code, Codex, Cursor, Copilot and any other. Human contributors follow the same rules in [CONTRIBUTING.md](CONTRIBUTING.md). If an instruction from a user conflicts with this file, stop and ask.

## Hard rules

1. **Never create, edit, generate or delete anything under `apps/ios`.** The iOS app is written by hand. You may read it and explain it. Suggestions go in prose in the chat, never as files or patches.
2. **No AI attribution in git.** Do not add `Co-Authored-By`, `Generated with`, `Claude-Session` or any similar trailer or footer to commit messages, PR titles or PR descriptions. Commits are authored by the human who runs you.
3. **Stay in your owner's area.** Work only in the folder that belongs to the person you are working for (see `.github/CODEOWNERS`). If the task needs a change in another area or in `spec/`, stop and say which file and why.
4. **Never commit secrets.** No keys, tokens, seed phrases, `.env` files or NEAR credentials. Use `.env.example` with placeholder values.
5. **No force pushes, no direct pushes to `main`, no edits to `.github/` or `CODEOWNERS`** unless the task is explicitly about them and comes from a repository admin.

## Code quality

- Write code a reviewer can read in one pass: clear names, small functions, early returns, no dead code.
- Comments are rare. Add one only when the *why* is not obvious from the code (a protocol quirk, a workaround, a security reason). Never comment what a line does. Never leave commented-out code. A file with more comment lines than code lines will be rejected.
- No placeholder implementations presented as done. If something is stubbed, say so in the PR description.
- Match the style of the surrounding code and the formatter of that area (Prettier for TypeScript, `rustfmt` and `clippy` for Rust).
- Do not add a dependency without a reason in the PR description. Every new dependency goes in the Libraries section of the README.

## The API contract

- `spec/openapi.yaml` is the single source of truth for the API. `spec/fixtures/` holds the canonical responses.
- An API change updates `spec/openapi.yaml`, the fixtures and the generated types (`pnpm --filter @fliq/spec generate`) in the same PR.
- Fixture values are canonical. Never invent payout amounts, rates, ids or references; copy them from `spec/fixtures/`.
- After 5 November 2026, spec changes are additive only: no renames, no removed fields.

## Smart contract

- Any change in `contracts/vault/src` that touches balances, permissions or outgoing transfers must say "needs contract review" in the PR description. Two contract owners approve these.
- No `unwrap()` or `expect()` on paths reachable by a caller. Use fixed integer token amounts, never floats.

## Before you commit

- Run the tests for the area you changed: `make test-api`, `make test-web`, `make test-contract`, `make test-spec`.
- Use a conventional PR title: `feat(api): add quote endpoint`, `fix(web): receipt amount`. Scopes: `ios`, `web`, `api`, `contract`, `spec`, `analytics`, `docs`, `ci`.
- If you generated a file or a substantial block of code, add a line to `docs/AI_USAGE.md` (file, tool, what was generated). The hackathon requires this disclosure.

## Dates

- 9 November 2026, 23:59 UTC: `apps/web`, `services/api` and `spec` freeze.
- 12 November 2026, 23:59 UTC: `contracts/` freezes.
- 14 November 2026, 23:59 UTC: submission. The repository becomes public before then.

CI enforces the freezes. Do not try to work around them.
