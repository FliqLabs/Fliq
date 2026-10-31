# spec

The contract between the iOS app, the web app, the API and the vault. If two parts of fliq disagree, this folder is right.

| Path | What it is | Owner |
| --- | --- | --- |
| `openapi.yaml` | Every endpoint and schema of the public API | Dipo, reviewed by Emmanuel and Frank |
| `fixtures/` | Canonical responses, the same numbers everywhere | Dipo, reviewed by Emmanuel and Frank |
| `fixtures/index.json` | Which schema each fixture must match | Dipo |
| `events/` | Analytics event schemas | Sejiro |
| `ts/` | Types generated from `openapi.yaml`, imported by web and api | Generated, never edited by hand |

## Changing the API

1. Edit `openapi.yaml`.
2. Update or add the fixture in `fixtures/` and list it in `fixtures/index.json`.
3. Run `pnpm --filter @fliq/spec generate`.
4. Run `make test-spec`.
5. Open one PR with all of it. Dipo, Emmanuel and Frank approve.

After 5 November 2026 changes are additive only.

## Using it

- Web and API: `import type { Quote } from "@fliq/spec"`, fixtures via `@fliq/spec/fixtures/quote.usdc-ngn-50.json`.
- iOS: `project.yml` bundles `spec/fixtures` as a resource folder; a unit test decodes every fixture into the hand-written Codable types.
- Contract tests: read the payout numbers from `fixtures/quote.usdc-ngn-50.json`.

Money in fixtures: token amounts are decimal strings, fees are in minor units of the local currency (kobo), `receive` is in whole local currency units.
