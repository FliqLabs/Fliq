# AI usage

The NEAR HACKATHON rules require listing AI-generated code. Add a row whenever an AI tool generated a file or a substantial block.

| Date | Path | Tool | What was generated |
| --- | --- | --- | --- |
| 2026-10-31 | Repository skeleton: root config, `.github/`, `docs/`, `spec/`, `services/api/src/mock.ts`, area READMEs | Claude | Initial monorepo structure, CI, contribution rules, OpenAPI spec draft, fixtures and mock server |
| 2026-11-03 | `apps/ios`: `project.yml`, `Config/`, `Fliq/App`, `Fliq/DesignSystem`, `Fliq/Domain`, `Fliq/Data`, `Fliq/Features/Home`, `FliqTests` | Claude Code | iOS app shell at Frank's direction: project spec, design tokens from App v5, Codable types for every spec schema, fixture and HTTP clients, empty Home, fixture decoding tests |
| 2026-11-03 | `apps/ios`: `Fliq/Features/Pay`, `Fliq/App/AppRouter.swift`, `Fliq/App/RootView.swift`, `Fliq/Security/Biometrics.swift`, `Fliq/DesignSystem/Components.swift`, `FliqTests/PayFlowTests.swift`, `FliqUITests` | Claude Code | Pay flow at Frank's direction: new account with bank verification, amount keypad, quote with countdown, Face ID confirm, sending timeline, paid receipt, plus unit and UI tests |

The iOS app (`apps/ios`) is built with Claude Code, directed and reviewed by Frank. Each iOS PR adds its rows to this table.
