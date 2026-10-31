# 1. One repository for everything

Date: 2026-10-31
Status: accepted

## Context

Seven people build an iOS app, a web app, an API and a NEAR contract in 14 days. They share one API and one set of demo numbers, and judges clone the repository and run it.

## Decision

One repository in the FliqLabs organisation. pnpm workspaces for the TypeScript parts, Cargo inside `contracts/vault` only, XcodeGen for iOS. No build orchestrator. `spec/` holds the OpenAPI contract and canonical fixtures that every part tests against. CI runs per folder; one aggregate check, `ci-gate`, protects `main`.

## Consequences

- An API change and every consumer's fix ship in one PR.
- A judge runs one clone and one `make setup`.
- CI has to be path-filtered so an iOS change does not run Rust jobs.
- Ownership is enforced with CODEOWNERS and team reviews instead of separate repositories.
