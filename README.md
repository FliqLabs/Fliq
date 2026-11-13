# fliq

[![CI](https://github.com/FliqLabs/Fliq/actions/workflows/ci.yml/badge.svg)](https://github.com/FliqLabs/Fliq/actions/workflows/ci.yml)

**Dollars in, your bank account out.** fliq turns stablecoins into money in a real bank or mobile
money account, at the best after-fee rate across licensed payout providers. USDC sits in a NEAR
vault that only you, or an AI agent you set limits for, can spend from. Pick an OPay, GTBank or
M-Pesa account, see exactly what arrives, confirm with Face ID, and the Naira or Shillings land in
about two minutes, with the bank's own reference on the receipt.

[![fliq.cash: Dollars in, your bank account out](docs/images/web/landing.png)](https://fliq.cash)

Built for the NEAR Hackathon, November 2026. Tracks: Real-World Money and Agent Economy. The first
commit is tagged `pre-hackathon` and the work is everything after it.

## Check it in 60 seconds

Nothing to install. Each line says what you should see.

| What | Where |
| --- | --- |
| The site and live rates | [fliq.cash/rates](https://fliq.cash/rates): what 1 USDC lands as in Nigeria and Kenya right now, after every fee |
| The same rate from the mainnet API | `curl -s https://api-mainnet-64d65ef4.up.railway.app/v1/rates/usdc/ngn` |
| The vault contract on mainnet | `fliq-vault.near` on [NearBlocks](https://nearblocks.io/address/fliq-vault.near) |
| The vault on testnet, with real payout orders | `fliq-vault.testnet` on [NearBlocks](https://testnet.nearblocks.io/address/fliq-vault.testnet) |
| The agent tools | `npx -y @fliqlabs/mcp` ([npm](https://www.npmjs.com/package/@fliqlabs/mcp)), for Claude, Cursor, Codex and any MCP client |
| Service health | [fliq.cash/status](https://fliq.cash/status) |

[![fliq.cash/rates: what 1 USDC lands as in Nigeria and Kenya after every fee](docs/images/web/rates.png)](https://fliq.cash/rates)

Two reads anyone can make, no account needed:

```bash
# The best rate after fees, and which provider gives it
curl -s https://api-mainnet-64d65ef4.up.railway.app/v1/rates/usdc/ngn
# {"token":"usdc","currency":"ngn","rate":1393.195,"rate_before_fees":1393.5099,"provider":"paycrest",...}

# Who controls the mainnet vault, and the only USDC contract it accepts
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"fliq-vault.near","method_name":"get_config","args_base64":"e30="}}' \
  | jq -r '.result.result | implode'
# {"owner":"fliq-owner.near","registration_account":"fliqaccount.near",
#  "approved_usdc_token_contract":"17208628f84f...36133a1", ...}
```

The USDC id is Circle's native USDC on NEAR. The vault refuses deposits from any other token.

## What is new here

1. **Your money stays yours until the bank is paid.** USDC sits in your balance inside a NEAR
   contract, not in a company wallet. A payout reserves it, the provider is paid only for that
   order, and if the payout fails the reservation is released or the refund is credited back,
   once, against a verified refund transaction.
2. **The best rate after fees, not the best headline rate.** The API asks every enabled provider
   for a quote in parallel and ranks them by what actually lands in the account. The receipt shows
   the rate, every fee and the bank's own session reference.
3. **AI agents can pay, inside limits the contract enforces.** An agent gets its own NEAR account
   and a policy on your vault: a per-payout cap, a daily cap that counts pending transfers, an
   optional list of allowed corridors, a cooldown and an expiry. It can only pay orders registered
   for it. Revoking takes one call that a function-call key cannot make.
4. **No seed phrase, no wallet app, no gas.** You sign in with a passkey. The phone makes its own
   NEAR key behind Face ID, fliq creates a `name.fliqaccount.near` account for it, and a relayer
   pays the NEAR gas, so you only ever hold dollars.
5. **Money in, not just out.** Deposit USDC or USDT from Base, Solana, Ethereum and more through
   NEAR Intents, or pay Naira by bank transfer (through Paj) and receive USDC in the vault.

## The problem

Millions of people in Nigeria and Kenya are paid in dollars: freelancers, remote workers,
creators. Getting those dollars into a local account today means a P2P desk, a screenshot of a
bank transfer and trust in a stranger, or an exchange with a rate that hides its fees. Each
provider quotes differently and nobody shows what actually arrives. fliq makes the cash-out one
screen: the amount that lands, the rate after fees, and a receipt the bank recognises.

## How it works

```mermaid
flowchart LR
  User["You, in the iPhone app<br/>or an AI agent through MCP"] -- "quote, pay" --> API["fliq API<br/>quotes every provider,<br/>picks the best after fees"]
  API -- "register_order" --> Vault{{"fliq vault on NEAR<br/>your USDC balance,<br/>agent caps"}}
  User -- "payout, signed on your phone<br/>gas paid by the relayer" --> Vault
  Vault -- "USDC for this order only" --> Provider["Licensed provider<br/>Paycrest"]
  Provider -- "NGN, KES" --> Bank["OPay, GTBank, Kuda,<br/>M-Pesa ..."]
  Provider -- "signed webhook" --> API
  API -- "receipt with the bank reference" --> User
```

1. **Quote.** The API resolves the account name with the bank first, so you see "DARA OKONKWO"
   before you send, then quotes every provider and holds the best rate for a short window.
2. **Reserve.** The API registers the order with the vault, which reserves exactly that amount
   from your balance.
3. **Pay.** You confirm with Face ID. The payout is a NEAR transaction from your own account,
   relayed so you pay no gas. The vault releases USDC to the provider for that order and nothing
   else.
4. **Settle.** The provider pays the bank. fliq marks the payout settled only on the provider's
   evidence of the bank transfer, never on the USDC transfer alone, and shows the bank reference.
5. **Or refund.** A payout that fails or times out releases the reservation, and a refund from the
   provider is credited back once, checked against the vault's real USDC balance.

Payout states: `awaiting_deposit` → `deposit_seen` → `paying_out` → `settled`, with `refused`,
`refunded` and `not_received` as branches. Each one fires a signed `payout.<state>` webhook.

## On your iPhone

The fliq app (`apps/ios`, SwiftUI) is the whole product in your pocket: a dollar balance, cash-out
to any saved account, a request link to get paid, deposits from any chain or by bank transfer, and
your AI agents with their limits.

<table>
<tr>
<td><img src="docs/images/ios/1-home.png" width="200" alt="Home: the vault balance in dollars and the live Naira rate"></td>
<td><img src="docs/images/ios/3-amount.png" width="200" alt="Amount: an in-app keypad, what you send and what they receive in Naira"></td>
<td><img src="docs/images/ios/4-quote.png" width="200" alt="Quote: the rate after fees, every fee, the rate held for a countdown, Confirm with Face ID"></td>
<td><img src="docs/images/ios/6-paid.png" width="200" alt="Paid: the Naira amount, the recipient and the bank's NIP session reference"></td>
</tr>
<tr>
<td align="center">Home</td><td align="center">Amount</td><td align="center">Quote</td><td align="center">Paid, with the bank reference</td>
</tr>
</table>

Recorded on mainnet. The two payments are in real time, not sped up or cut. The bank transfer is
shortened: the switch to the bank app and the wait of about a minute and a half for the money to
land are cut out.

<table>
<tr>
<td><a href="docs/videos/pay-a-fliq-user.mp4"><img src="docs/videos/pay-a-fliq-user.gif" width="260" alt="Paying a fliq user by name: search, type the amount, Face ID, and the balance drops"></a></td>
<td><a href="docs/videos/send-and-receipt.mp4"><img src="docs/videos/send-and-receipt.gif" width="260" alt="Sending 3 dollars to a fliq user, then opening the receipt from Activity"></a></td>
<td><a href="docs/videos/add-money-by-bank-transfer.mp4"><img src="docs/videos/add-money-by-bank-transfer.gif" width="260" alt="Adding money by bank transfer: 5,000 Naira in, the bank details to pay, then 3.43 dollars added to the vault"></a></td>
</tr>
<tr>
<td align="center">Pay a fliq user by name</td><td align="center">Send, then open the receipt</td><td align="center">Add money by bank transfer (shortened)</td>
</tr>
</table>

Click any of them for the video file.

- **Passkeys, not seed phrases.** One "Continue with passkey" button signs you in, or creates
  your account if you have none. Your NEAR account's key is made on the phone, kept in the
  Keychain and used only after Face ID; it never leaves the device.
- **Native NEAR.** Borsh transactions and NEP-366 delegate actions built in Swift and sent through
  the relayer, so the app never needs NEAR for gas.
- **The amount that lands, first.** The amount screen shows what the recipient receives as you
  type, and the button stays off if you ask for more than your vault holds.
- **Receive from anywhere.** A deposit address for each supported chain (NEAR Intents), a request
  link anyone can pay, or Naira by bank transfer that arrives as USDC.

Verify without an iPhone:

```bash
brew install xcodegen
make ios                                      # generates apps/ios/Fliq.xcodeproj
xcodebuild test -project apps/ios/Fliq.xcodeproj -scheme Fliq \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'   # any iPhone from xcrun simctl list devices
```

`FliqUITests/PayFlowUITests` walks the payment above on fixtures, Home to Paid, and saves each
screen when `TEST_RUNNER_SCREENSHOT_DIR` is set. Those are the screenshots on this page, taken on
the canonical fixtures.

## For developers and AI agents

Everything the app does is one API, described in [`spec/openapi.yaml`](spec/openapi.yaml) with
canonical responses in [`spec/fixtures`](spec/fixtures).

```bash
# An AI agent cashes out with your limits, not its own judgement
claude mcp add fliq --env FLIQ_API_KEY=rt_test_... -- npx -y @fliqlabs/mcp
```

The MCP server has two modes. In developer mode, with an API key from the
[fliq.cash](https://fliq.cash) dashboard, an agent can quote, verify an account, pay and track a
payout. In agent mode, with an agent id and key from the app, it pays from your vault and the
contract refuses anything over the caps you set. The tools, setup for each client and the answers
they give are in [`services/api/mcp/README.md`](services/api/mcp/README.md).

The web dashboard at [fliq.cash](https://fliq.cash) gives developers test and live API keys,
payouts with filters and export, webhooks and usage.

## Verify it in ten minutes

**1. The live services.** The rates above, the mainnet vault's config, and
[fliq.cash/status](https://fliq.cash/status) for the API, relayer and providers.

**2. The whole API on your machine, with no keys.** Requirements: Node 22 and pnpm (via
`corepack`).

```bash
git clone https://github.com/FliqLabs/Fliq.git && cd Fliq
make setup
make dev-mock
```

In another terminal:

| Do | See |
| --- | --- |
| `curl localhost:4000/v1/rates/usdc/ngn` | The best after-fee rate, `1376.32` Naira per USDC, from Paycrest |
| `curl -X POST localhost:4000/v1/quote -H "Authorization: Bearer rt_test_7Kp2demo00c9Qe"` | A quote: $50 becomes `68816` Naira after `344` Naira in fees, best of 4 providers |
| `curl localhost:4000/v1/payouts/po_9c2f71aa -H "Authorization: Bearer rt_test_7Kp2demo00c9Qe"` | A settled payout with the GTBank reference `000013251029140213` |

Mock mode serves the canonical fixtures from `spec/fixtures`, so these values are the same
everywhere.

**3. The tests.**

```bash
make test             # spec, API, web and contract
make test-sandbox     # the vault and a mock USDC on a local NEAR node
```

| Area | Tests |
| --- | --- |
| Vault contract (Rust, near-sdk, near-workspaces) | 133 |
| API, workers, relayer and MCP server (TypeScript, vitest) | 680 |
| iPhone app (XCTest and XCUITest) | 176 |

CI runs the spec, API, web and contract suites, a secret scan, and a contract review gate on every
pull request.

**4. The contract on testnet.** `fliq-vault.testnet` holds the full order life cycle:
`register_order`, an agent's `payout` signed by `a1.fliqaccount.testnet`
([AEAv6k…](https://testnet.nearblocks.io/txns/AEAv6kDWeaFbsJtYV6hhB9cg3KqvRiKBnmEN3bXyGxet)),
`set_status` from the backend and `release_order`.

## Security model

| Threat | What stops it |
| --- | --- |
| fliq, or anyone holding fliq's keys, spends your balance | The vault only pays an order you, or your agent, sign a `payout` for. The registration account can reserve and report status, not send your USDC anywhere else. `withdraw` always pays your own account |
| A payout that never reaches the bank | Funds are reserved, not spent, until the provider confirms. A failed USDC transfer releases the reservation in the callback; a stuck one can be resolved after the timeout |
| A refund credited twice, or credited without the money | `recredit` checks the vault's real USDC balance, needs a recorded refund transaction, and each refund transaction backs one order only |
| A prompt-injected or buggy agent drains the account | Per-payout and daily caps in the contract, counted with pending transfers; optional corridor allowlist; cooldown; expiry. The agent can only pay orders registered for it |
| An agent changes or keeps its own permissions | Changing a policy needs an attached deposit and revoking needs exactly 1 yoctoNEAR, so a function-call key can do neither. The owner revokes with `remove_agent` |
| A fake token deposited to inflate balances | The vault accepts `ft_transfer_call` only from the USDC contract fixed at initialisation |
| Sending to the wrong person | The bank resolves the account name before you can pay, and you see it on every screen to Paid |
| A lost or stolen phone | The account key signs only after Face ID or the device passcode, and the app lock asks for its own passcode |
| Provider webhooks forged | Every provider webhook is HMAC-verified, with a previous secret allowed during rotation |
| Secrets in the repository | CI runs Gitleaks on every pull request; the app holds no secrets; keys live in the hosting environment |

## NEAR used

- **A NEAR smart contract** (Rust, near-sdk) holding NEP-141 USDC with per-user balances,
  single-use payout orders, receipts and agent spending policies. NEP-145 storage, NEP-297 events
  read by the backend.
- **Named accounts for everyone.** Each user gets `name.fliqaccount.near`, created by fliq.
- **Meta-transactions (NEP-366).** A relayer with a pool of function-call keys pays gas, so users
  only hold dollars.
- **NEAR Intents** for deposits from other chains into the vault.
- **Ed25519 keys made on the iPhone** own each account and sign behind Face ID; passkeys
  (WebAuthn) sign the user in to the API.

## Layout

| Path | What | Owner |
| --- | --- | --- |
| [`apps/ios`](apps/ios) | The iPhone app, SwiftUI, iOS 17, Swift 6 | Frank |
| [`apps/web`](apps/web) | fliq.cash: landing, rates, status, developer dashboard, web wallet, Next.js 16 | Emmanuel |
| [`services/api`](services/api) | API, MCP server, relayer, rate sampler, chain watcher, webhooks | Dipo |
| [`contracts/vault`](contracts/vault) | The NEAR USDC vault: balances, orders, receipts, agent policy | Dapper, James, Aria |
| [`spec`](spec) | OpenAPI contract, canonical fixtures, event schemas | shared |
| [`analytics`](analytics) | Rollups and status data | Sejiro |
| [`docs`](docs) | Architecture and decisions | Frank |

Architecture: [docs/architecture.md](docs/architecture.md).

## Status

- [x] NEAR vault: balances, single-use orders, refunds, receipts, agent policies; live on mainnet as `fliq-vault.near`
- [x] API on mainnet: rates, quotes, account name lookup, payouts, signed webhooks, status
- [x] Payouts to Nigerian banks and OPay (NGN) and M-Pesa (KES) through Paycrest
- [x] Passkey accounts on `fliqaccount.near` with gas paid by the relayer
- [x] iPhone app: cash-out, request links, deposits, bank-transfer deposits, agents, app lock
- [x] fliq.cash: landing, live rates, status, developer dashboard and API keys, web wallet
- [x] MCP server on npm for developer and agent modes
- [x] Deposits from other chains through NEAR Intents; Naira in through Paj
- [ ] More providers live in the comparison (adapters for Bitnob, Busha, Fonbnk and TransFi are built and switch on with their keys)
- [ ] Ghana, Uganda, Tanzania and South Africa payouts
- [ ] The app on TestFlight

## Team

| Person | Area |
| --- | --- |
| Frank Samson ([@samsonnolien](https://github.com/samsonnolien)) | Lead, product, design, iPhone app |
| Dipo ([@dipo0x](https://github.com/dipo0x)), Collins Bethel ([@Devkol-11](https://github.com/Devkol-11)), Adeoti Israel ([@oluwaisrael](https://github.com/oluwaisrael)) | API and backend |
| Emmanuel ([@OyeyipoEmmanuel](https://github.com/OyeyipoEmmanuel)), [@Moonlight9990](https://github.com/Moonlight9990) | Web |
| Dapper ([@Dapperdavidd](https://github.com/Dapperdavidd)), James ([@jamesonchain](https://github.com/jamesonchain)), Aria ([@iamariya101](https://github.com/iamariya101)) | Smart contract |
| Sejiro ([@sejiro17](https://github.com/sejiro17)) | Analytics |

## Hackathon disclosure

- Baseline: the first commit is tagged `pre-hackathon`; the submission is tagged
  `hackathon-submission`. The hackathon work is the diff between them.
- No existing product on another chain.
- AI coding tools were used across the repository. The iPhone app is built with Claude Code,
  directed and reviewed by Frank.

## Libraries

| Library | Where | Why |
| --- | --- | --- |
| openapi-typescript | spec | Generate TypeScript types from the OpenAPI spec |
| @redocly/cli | spec | Lint the OpenAPI spec |
| ajv, ajv-formats, yaml | spec | Validate fixtures against the spec |
| tsx, vitest, typescript | services/api | Run and test the API |
| near-contract-standards | contracts/vault | Expose standard NEP-141 receiver and NEP-145 storage interfaces |
| near-sdk | contracts/vault | Build and test the NEAR USDC vault contract |
| fastify | services/api | HTTP server; validates requests against schemas built from the OpenAPI spec |
| prisma, @prisma/client | services/api | Database schema, migrations and typed queries on Postgres |
| near-api-js, borsh | services/api | NEAR transaction and delegate-action encoding, signing and verification for the relayer and account creation |
| @simplewebauthn/server | services/api | Verify passkey registration and sign-in (WebAuthn) |
| ioredis | services/api | Redis client for the atomic token-bucket rate limiter |
| qrcode-generator | apps/web | Draw scannable QR codes for deposit addresses in the wallet, with no runtime dependencies |
| three | apps/web | Render the rotating tile globe in the landing hero with WebGL, loaded only on the landing page |
| lenis | apps/web | Run the landing hero's scroll handoff as one eased, reversible scroll that native scrolling cannot interrupt |
| yaml | services/api | Read spec/openapi.yaml at startup to register routes |
| prettier | root | Formatting |
| Hugeicons free icons (SVG files, MIT) | apps/ios | The app's icon set, bundled as template vectors; notice in apps/ios/THIRD_PARTY_NOTICES.md |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents read [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
