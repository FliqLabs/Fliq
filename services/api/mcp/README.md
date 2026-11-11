# @fliqlabs/mcp

An **MCP server for fliq** that lets an AI agent (Claude, Cursor, Codex and any other MCP client) quote, check, pay and track **stablecoin cash-outs**: USDC or USDT out to a bank or mobile-money account in Nigeria, Kenya, Ghana, Indonesia and the Philippines.

```
npx -y @fliqlabs/mcp
```

MCP (Model Context Protocol) is the open standard AI apps use to call outside tools. This package is a small MCP server that runs on your own machine, speaks to your AI app over standard input and output (stdio), and calls the fliq API for it. It has no dependencies and needs Node 20 or newer.

## Contents

1. [Two modes](#two-modes)
2. [Developer mode: set up](#developer-mode-set-up)
3. [Developer mode: tools](#developer-mode-tools)
4. [Agent mode: set up](#agent-mode-set-up)
5. [Agent mode: tools](#agent-mode-tools)
6. [What a conversation looks like](#what-a-conversation-looks-like)
7. [Safety built in](#safety-built-in)
8. [Answers the tools give](#answers-the-tools-give)
9. [Environment variables](#environment-variables)
10. [Coverage](#coverage)
11. [Troubleshooting](#troubleshooting)

## Two modes

The server picks its mode when it starts, from the environment you give it:

| Mode               | You give it                         | Who it's for                                                                | How a payout is funded                                                                                                                                                  |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Developer mode** | `FLIQ_API_KEY`                      | Developers building on fliq. Your agent can pay any account it has checked. | The person sends stablecoins from Base, Polygon or Solana to the deposit address the payout returns.                                                                    |
| **Agent mode**     | `FLIQ_AGENT_ID` and the agent's key | People using the fliq app who connect an AI agent to their own fliq vault.  | The agent pays from the person's fliq vault on NEAR, **within the daily and per-payout limits they set in the app**. The vault contract enforces those limits on chain. |

If both are set, agent mode wins. With neither, the server stops at start and says what to set.

## Developer mode: set up

1. Sign in at [fliq.cash](https://fliq.cash), create a workspace and copy an API key from the dashboard (`rt_test_...` for the sandbox, `rt_live_...` for real payouts once your business is verified).
2. Add the server to your AI app.

**Claude Code**

```
claude mcp add fliq --env FLIQ_API_KEY=rt_test_... -- npx -y @fliqlabs/mcp
```

**Claude Desktop, Cursor, or any client with a JSON config** (`claude_desktop_config.json`, `.mcp.json`, `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "fliq": {
      "command": "npx",
      "args": ["-y", "@fliqlabs/mcp"],
      "env": {
        "FLIQ_API_KEY": "rt_test_...",
        "FLIQ_REFUND_ADDRESS": "0xYourBaseAddress"
      }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.fliq]
command = "npx"
args = ["-y", "@fliqlabs/mcp"]
env = { FLIQ_API_KEY = "rt_test_..." }
```

Restart the app and ask it something like: _"How much naira does 50 USDC get me right now?"_

## Developer mode: tools

| Tool                     | Inputs                                                                                                                                             | What it does                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cashout_quote`          | `amount`, `currency`, optional `token` (usdc/usdt), `source_chain` (base/polygon/solana), `payout_type` (bank/mobile_money), `mode` (send/receive) | Prices the payout across every live provider and returns the top three routes: what each pays, its fees, speed and on-time record, plus a `quote_id` and how long it holds.            |
| `cashout_verify_account` | `country`, `bank`, `number`, optional `account_name`                                                                                               | Asks the bank for the name on the account, so the agent can read it back to the person.                                                                                                |
| `cashout_pay`            | `quote_id`, `recipient` (`country`, `bank`, `number`), optional `refund_address`, `client_reference`, `provider`                                   | Creates the payout and returns exactly what to send, on which chain, to which address. **Refused unless that same account was checked with `cashout_verify_account` in this session.** |
| `cashout_status`         | `payout_id`                                                                                                                                        | Where the payout is: its state, timeline, the bank's reference once paid, and the refund if there was one.                                                                             |

**Refund address.** A payout funded from Base, Polygon or Solana needs an address on that chain where the stablecoin goes back if the payout fails. `cashout_pay` takes it as `refund_address`, or uses `FLIQ_REFUND_ADDRESS` when it fits the quote's chain. With neither, it answers `needs_refund_address` and the agent asks the person for one.

**Names the bank can't confirm.** Some banks and wallets can't return a name. Then `cashout_verify_account` answers `name_required`: the agent asks the person for the exact name and calls again with `account_name`.

**Vault payouts.** An API key can't pay from a fliq vault. Those need agent mode.

## Agent mode: set up

1. **Make the agent's key.** Only the public key is printed; the private key stays in the file.

   ```
   npx -y @fliqlabs/mcp keygen ~/.fliq/claude.key
   ```

2. **Connect the agent in the fliq app.** Open Agents, connect an agent with that public key, and set its limits: a daily cap, a per-payout cap, the currencies it may pay, and whether it may pay only your saved accounts. The app shows the agent's NEAR account, for example `claude-frank.fliq.near`.

3. **Add the server to your AI app:**

   ```json
   {
     "mcpServers": {
       "fliq": {
         "command": "npx",
         "args": ["-y", "@fliqlabs/mcp"],
         "env": {
           "FLIQ_AGENT_ID": "claude-frank.fliq.near",
           "FLIQ_AGENT_KEY_FILE": "/Users/you/.fliq/claude.key"
         }
       }
     }
   }
   ```

No API key is involved. Every request is signed with the agent's own key, and fliq pays the NEAR gas.

## Agent mode: tools

| Tool                 | Inputs                                | What it does                                                                                                       |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `cashout_limits`     | none                                  | The agent's caps, the currencies it may pay, what is left today, and whether only saved accounts may be paid.      |
| `cashout_recipients` | none                                  | The bank and mobile-money accounts the owner saved in fliq, each with a `recipient_id`.                            |
| `cashout_quote`      | `amount`, `currency`, optional `mode` | Prices a payout of USDC from the owner's vault and returns the top three routes and a `quote_id`.                  |
| `cashout_pay`        | `quote_id`, `recipient_id`            | Pays the quote to a saved account. fliq checks the limits first; the agent signs the vault payout; fliq relays it. |
| `cashout_status`     | `payout_id`                           | State, timeline, references and receipt link.                                                                      |

A payout over a limit is refused before anything is created, and the vault checks the caps again on chain, so even a misbehaving agent can't spend more than the owner allowed.

## What a conversation looks like

> **You:** Send 30,000 naira to Dara's GTBank account, 0123456789.
>
> **Agent:** _(calls `cashout_verify_account`)_ The account belongs to **DARA OKONKWO** at GTBank. Is that right?
>
> **You:** Yes.
>
> **Agent:** _(calls `cashout_quote` with `mode: receive`)_ Paycrest pays exactly ₦30,000 for 21.86 USDC, arriving in about 2 minutes. Shall I go ahead?
>
> **You:** Go.
>
> **Agent:** _(calls `cashout_pay`)_ Send **21.86 USDC on Base** to `0x7a3…`. I'll tell you when it lands. _(later, `cashout_status`)_ Settled: ₦30,000 reached Dara's account, bank reference 000013251029140213.

## Safety built in

- **Check before paying.** In developer mode, `cashout_pay` refuses any account that wasn't checked in the same session, so the person always hears the name before money moves.
- **One quote, one payout.** Each payout is sent with an idempotency key tied to its quote, so an agent that repeats itself gets the same payout back, never a second one.
- **Limits on chain.** In agent mode, the owner's caps are enforced by fliq and again by the vault contract.
- **Expired quotes are refused locally** with a request for a fresh quote.
- **No personal data in logs.** Full account numbers are never returned to the model or logged. Answers show the name and the last four digits; logs (on stderr) hold only tool names, outcomes and timings.

## Answers the tools give

Every tool returns the same envelope, so the agent always knows what happened:

```json
{
  "status": "awaiting_deposit",
  "summary": "Send 21.86 USDC on base to 0x7a3…; then 30,000 NGN goes to DARA OKONKWO through paycrest.",
  "provider_of_record": "paycrest",
  "refund_address": "0xYourBaseAddress",
  "receipt_link": null,
  "data": {
    "payout_id": "po_…",
    "state": "awaiting_deposit",
    "deposit": { "chain": "base", "address": "0x7a3…", "amount": "21.86" }
  }
}
```

| `status`               | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `ok`                   | Done. `summary` says what.                                              |
| `awaiting_deposit`     | The payout exists; send the deposit described in `data.deposit`.        |
| `pending`              | Accepted and in progress; check `cashout_status` shortly.               |
| `name_required`        | The bank can't confirm names: ask for the exact name and call again.    |
| `needs_refund_address` | Ask the person for their address on the quote's chain.                  |
| `not_found`            | No such account or payout.                                              |
| `refused`              | Refused before anything moved (a limit, or an unverified account).      |
| `blocked`              | This mode can't do it (for example a vault payout with an API key).     |
| `invalid_input`        | The arguments were wrong; nothing was sent to fliq.                     |
| `error`                | fliq answered with an error; `data.code` and `data.trace_id` say which. |

## Environment variables

| Variable                 | Mode      | Description                                                                                                             |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `FLIQ_API_KEY`           | developer | Your fliq API key, `rt_test_...` or `rt_live_...`.                                                                      |
| `FLIQ_SOURCE_CHAIN`      | developer | Optional. The chain quotes are funded from when the agent doesn't say: `base` (default), `polygon` or `solana`.         |
| `FLIQ_REFUND_ADDRESS`    | developer | Optional. Your default refund address, used for quotes on the chain it belongs to.                                      |
| `FLIQ_AGENT_ID`          | agent     | The agent's NEAR account, shown in the fliq app.                                                                        |
| `FLIQ_AGENT_KEY_FILE`    | agent     | The file holding the agent's `ed25519:...` secret key, as `keygen` writes it.                                           |
| `FLIQ_AGENT_PRIVATE_KEY` | agent     | Instead of the file: the same secret key inline.                                                                        |
| `FLIQ_NEAR_RPC_URL`      | agent     | Optional. The NEAR RPC used to read the key's nonce. Defaults to FastNEAR (mainnet, or testnet for a `.testnet` agent). |
| `FLIQ_API_URL`           | both      | Optional. The fliq API to call, including `/v1`. Defaults to `https://api-production-54e10.up.railway.app/v1`.          |
| `FLIQ_RECEIPT_URL`       | both      | Optional. A receipt link template containing `{payout_id}`; without it `receipt_link` is null.                          |

## Coverage

| Currency | Country     | Payout to              |
| -------- | ----------- | ---------------------- |
| NGN      | Nigeria     | Bank account           |
| KES      | Kenya       | Bank account, M-Pesa   |
| GHS      | Ghana       | Mobile money           |
| IDR      | Indonesia   | Bank account, e-wallet |
| PHP      | Philippines | Bank account, e-wallet |

Which currencies answer at a given moment depends on which payout providers are live. When none can pay a currency, `cashout_quote` says so (`no_route`) instead of guessing. Agent mode pays NGN and KES from the vault today.

## Troubleshooting

| Symptom                                  | Fix                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The server exits at start with a message | Set `FLIQ_API_KEY` (developer mode) or `FLIQ_AGENT_ID` plus a key (agent mode).                   |
| Every call fails with a network error    | Check `FLIQ_API_URL`; it must be reachable and end in `/v1`.                                      |
| `unauthorized` in agent mode             | The agent isn't connected in the fliq app yet, was revoked, or the key file is for another agent. |
| `needs_refund_address`                   | Give `refund_address`, or set `FLIQ_REFUND_ADDRESS` to an address on the quote's chain.           |
| `no_route`                               | No live provider pays that currency right now. Try another currency or later.                     |
| An `ExperimentalWarning` about Ed25519   | Harmless. Node prints it on stderr in agent mode; MCP only reads stdout.                          |

## Links

- Website and dashboard: [fliq.cash](https://fliq.cash)
- Source: [github.com/FliqLabs/Fliq](https://github.com/FliqLabs/Fliq/tree/main/services/api/mcp)
- For your own code: [`@fliqlabs/sdk`](https://www.npmjs.com/package/@fliqlabs/sdk), the TypeScript client this server is built on.

MIT licence.
