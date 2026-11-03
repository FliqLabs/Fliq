# fliq

Global crypto. Local money.

fliq pays stablecoins out to bank and mobile money accounts at the best after-fee rate across licensed off-ramp providers. A developer or an app sends USDC; fliq quotes every provider in parallel, routes to the best one, and returns a receipt with the bank's own reference. A NEAR smart contract holds the funds and enforces per-payout and daily caps, so an AI agent can pay from the same account without ever spending more than its owner allowed.

Built at the NEAR HACKATHON, 1 to 14 November 2026. Tracks: Real-World Money, Agent Economy.

## Try it in two minutes

Requirements: Node 22 and pnpm (via `corepack`).

```
git clone https://github.com/FliqLabs/fliq.git && cd fliq
make setup
make dev-mock
```

In another terminal:

| Do | See |
| --- | --- |
| `curl localhost:4000/v1/rates/usdc/ngn` | The best after-fee rate, `1376.32` naira per USDC, from Paycrest |
| `curl -X POST localhost:4000/v1/quote -H "Authorization: Bearer rt_test_7Kp2demo00c9Qe"` | A quote: $50 becomes `68816` naira after `344` naira in fees, best of 4 providers |
| `curl localhost:4000/v1/payouts/po_9c2f71aa -H "Authorization: Bearer rt_test_7Kp2demo00c9Qe"` | A settled payout with the GTBank reference `000013251029140213` |
| `make test` | Spec, fixtures, API and contract tests |

Mock mode needs no keys or accounts. Hosted demo, video and app build: linked here on submission.

## How it fits together

| Folder | What | Owner |
| --- | --- | --- |
| [`apps/ios`](apps/ios) | iPhone app, SwiftUI | Frank |
| [`apps/web`](apps/web) | Public site and developer dashboard, Next.js | Emmanuel |
| [`services/api`](services/api) | API, MCP server, webhooks, rate sampler, chain watcher | Dipo |
| [`contracts/vault`](contracts/vault) | NEAR USDC vault: balances, orders, agent policy | sQuiDbOb, Dapper, Aria |
| [`spec`](spec) | OpenAPI contract, canonical fixtures, event schemas | shared |
| [`analytics`](analytics) | Rollups, status data | Sejiro |
| [`docs`](docs) | Architecture, decisions, AI usage | Frank |

Architecture diagrams: [docs/architecture.md](docs/architecture.md).

## NEAR protocols used

- NEAR smart contract (Rust, `near-sdk`) holding USDC (NEP-141) with per-user balances and agent spending policies
- NEP-297 events consumed by the backend
- NEAR Intents for cross-chain deposits (in progress)

## Hackathon disclosure

- Baseline: the first commit is tagged `pre-hackathon`; the submission is tagged `hackathon-submission`. The hackathon work is the diff between them.
- No existing product on another chain.
- AI-generated code is listed in [docs/AI_USAGE.md](docs/AI_USAGE.md). The iOS app is built with Claude Code, directed and reviewed by Frank.

## Libraries

| Library | Where | Why |
| --- | --- | --- |
| openapi-typescript | spec | Generate TypeScript types from the OpenAPI spec |
| @redocly/cli | spec | Lint the OpenAPI spec |
| ajv, ajv-formats, yaml | spec | Validate fixtures against the spec |
| tsx, vitest, typescript | services/api | Run and test the API |
| fastify | services/api | HTTP server; validates requests against schemas built from the OpenAPI spec |
| prisma, @prisma/client | services/api | Database schema, migrations and typed queries on Postgres |
| @simplewebauthn/server | services/api | Verify passkey registration and sign-in (WebAuthn) |
| ioredis | services/api | Redis client for the atomic token-bucket rate limiter |
| yaml | services/api | Read spec/openapi.yaml at startup to register routes |
| prettier | root | Formatting |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents read [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
