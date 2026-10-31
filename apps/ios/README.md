# apps/ios

The fliq iPhone app. SwiftUI, iOS 17 minimum, Swift 6 strict concurrency. Owner: Frank.

Every line of Swift in this folder is written by hand. Coding agents must not create or edit files here (see `AGENTS.md`).

## Layout

```
apps/ios/
  project.yml          XcodeGen spec; the .xcodeproj is generated and not committed
  Fliq/
    App/               entry point, navigation, environment
    Features/          Onboarding, Home, Pay, Receive, Activity, Agents, Settings
    Domain/            Money, Quote, Payout, Route, Account, AgentKey
    Data/              APIClient, endpoints, polling, mock client
    Security/          Keychain, LocalAuthentication, passkeys
    DesignSystem/      colours, type, spacing, shared views
  FliqTests/           decodes every file in spec/fixtures into the Domain types
```

## Run

```
brew install xcodegen
make ios
open apps/ios/Fliq.xcodeproj
```

The API base URL comes from `Config/Debug.xcconfig` (`http://localhost:4000/v1` with `make dev-mock`). The app holds no secrets.

Design source of truth: fliq App Design v5 (Claude Design canvas).
