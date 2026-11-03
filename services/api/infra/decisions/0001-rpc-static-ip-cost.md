# 0001. RPC providers, static outbound IP and cost (L17)

Date: 3 November 2026
Status: **PROPOSED** for Oladipo's approval. The account facts in "To confirm" must be checked before this is final.
Spec: architecture §17.5, §21, §22.2.

Every figure is marked **verified** (read on the provider's own page or measured on 3 November 2026), **estimate** (our arithmetic, assumptions stated) or **unknown**.

## Decisions proposed

| Chain | Provider | Sandbox (testnets) | Production (mainnets) |
| --- | --- | --- | --- |
| Base, Polygon | Alchemy, one app per environment | Free plan | Pay As You Go |
| Solana | Helius, one key per environment | Free plan (devnet) | Developer plan |
| NEAR | FASTNEAR, dRPC as fallback | Free endpoint | Paid key (price unknown) |

Not `rpc.mainnet.near.org`: NEAR deprecated its free endpoints in 2025 and the remaining limit is 30 requests per minute (verified, NEAR docs).

## Provider facts

| Provider | Plan | Fact | Status |
| --- | --- | --- | --- |
| Alchemy | Free | 30M compute units (CU) a month, 15 requests/s (300 CU/s) | verified |
| Alchemy | Pay As You Go | $0.52 per 1M CU, from 300 requests/s | verified |
| Alchemy | costs | `eth_blockNumber` 10 CU, `eth_getLogs` 75 CU; `eth_getBlockByNumber` not shown | verified / unknown |
| Alchemy | chains | Base, Polygon PoS and Solana supported | verified |
| Helius | Free | 1M credits a month, 10 requests/s | verified |
| Helius | Developer | $49 a month, 10M credits, 50 requests/s; extra credits $5 per 1M | verified |
| Helius | costs | 1 credit per standard call, including `getSignaturesForAddress` and `getTransaction` | verified |
| FASTNEAR | Free | Listed by NEAR as a free tier with a paid plan; no numeric limit published | verified / unknown |

## Request volume

From the watcher intervals in §10.2. One poll every 3 s is 864,000 polls in 30 days.

| Watcher | Calls per poll | Continuous monthly load | Status |
| --- | --- | --- | --- |
| Base or Polygon | `eth_blockNumber` + one `eth_getLogs` for USDC and USDT to all watched addresses, plus one block-hash read for reorg checks | at least 85 CU × 864,000 = 73.4M CU per chain | estimate |
| Solana | one `getSignaturesForAddress` per watched token account, one `getTransaction` per new signature | 864,000 credits per continuously watched account | estimate |
| NEAR (L10) | one status read per relayed transaction every 5 s while pending, plus vault event reads | small | estimate |

What that means:

- **Base and Polygon together, polled nonstop, need about 147M CU a month per environment.** Alchemy Free (30M) does not cover even one environment. Pay As You Go would be about **$76 a month** for production (estimate).
- **Solana's Free plan covers about one continuously watched account;** Developer covers about eleven. Free's 10 requests/s caps us at 30 accounts at a 3 s interval.

Proposed for L06 to cut this:
1. Poll a chain only while it has an open watch.
2. Poll watches that are past expiry (the 24-hour late-deposit window) every 60 s instead of 3 s.

If production has an open watch a quarter of the time, Base and Polygon fall to about 37M CU, roughly **$19 a month** (estimate; the share is an assumption to replace with the 7 November usage check).

## Cost against §21

| Item | §21 said | Now | Status |
| --- | --- | --- | --- |
| Railway Pro | $20 incl. $20 usage | $20 incl. $20 usage; RAM $10/GB-month, CPU $20/vCPU-month, volumes $0.15/GB-month, egress $0.05/GB | verified |
| Railway usage, 2 environments | $100 to $150 | unchanged until measured | estimate |
| Amazon MQ, 2 × `mq.t3.micro` | $50 to $70 | hourly rate for eu-central-1 not on the AWS pricing page | unknown |
| RPC | $0 | sandbox $0; production about $19 to $76 Alchemy plus $49 Helius, plus FASTNEAR paid plan | estimate |

**§21's "RPC $0" does not hold for production.** Budget about $70 to $130 a month for RPC, or accept Free-plan limits in production during judging.

## Railway static outbound IP and Amazon MQ (verified, Railway docs)

- Static outbound IPs are a **Pro plan** feature, enabled per service, IPv4, outbound only.
- They are tied to the service's region; moving region changes them.
- **They may be shared with other Railway customers.** An Amazon MQ security group that allows only those IPs keeps out the internet at large, but not every other Railway tenant on the same address.

Decision proposed for L01:
1. Enable static IPs on the services that connect to the broker (api and worker), per environment.
2. Allow only those IPs on port 5671 in each broker's security group.
3. Keep per-environment broker credentials and AMQPS as the real protection (§17.5).

If our plan is not Pro, the security group must allow 0.0.0.0/0 on 5671 and rely on credentials and TLS alone.

## RabbitMQ version (verified, Amazon MQ docs)

Amazon MQ runs RabbitMQ 4.2 and 4.3 only on `mq.m7g` instances; `mq.t3` instances run 3.13 only. Decision: 3.13 on `mq.t3.micro` for both environments. Local Docker Compose is pinned to 3.13 to match.

## 1Click findings for L07 (measured 3 November 2026, dry quotes, no funds moved)

- `GET /v0/tokens` is public: 215 tokens. USDC exists on Base, Polygon, Solana, Arbitrum, Ethereum and NEAR. USDT exists on Polygon, Solana, Tron, Ethereum and NEAR. **There is no USDT on Base.**
- Polygon assets route through the HOT Omni bridge (`nep245:v2_1.omni.hot.tg:137_...`), not the `omft` bridge used by Base, Solana and others.
- Exact-output Solana USDC to a Base address, 5 USDC out, 30 bps app fee, 50 bps slippage: 5.043182 in (minimum 5.017966), about 22 s. The same to a Polygon address: 5.047661 in, about 24 s. **Exact output to a provider-style address works on both chains.**
- Minimum for Solana USDC to Base USDC: 1 USDC is accepted. 0.1 USDC is refused with "Amount is too low for bridge, try at least 248761".
- A dry quote was accepted without an API key (HTTP 201). The assignment still requires a partner key from partners.near-intents.org for production.

## To confirm

1. Which Railway plan the team is on (decides static IPs).
2. Who creates the Alchemy, Helius and FASTNEAR accounts, with separate sandbox and production keys (§16.2), stored as sealed Railway variables.
3. The `mq.t3.micro` eu-central-1 hourly price, from the AWS pricing calculator.
4. Actual usage and cost on 7 November, replacing the estimates above.

## Sources

Railway static outbound IPs and plans (docs.railway.com); Alchemy pricing and compute units (alchemy.com/pricing, alchemy.com/docs/reference/compute-units); Helius plans and credits (helius.dev/docs/billing); NEAR RPC providers (docs.near.org/api/rpc/providers); Amazon MQ engine versions and pricing (docs.aws.amazon.com/amazon-mq, aws.amazon.com/amazon-mq/pricing); 1Click OpenAPI 0.1.10 and live API (1click.chaindefuser.com).
