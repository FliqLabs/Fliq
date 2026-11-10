# @fliqlabs/mcp

An MCP server that lets an AI agent quote, pay and track fliq cash-outs: stablecoins out to a bank or mobile-money account. It speaks MCP over stdio, so Claude Code, Codex and Cursor start it with `npx`. Node 20 or newer.

It runs in one of two modes, picked at start from the environment:

- **Developer mode** (`FLIQ_API_KEY`): your app's agent pays any verified account, and the person funds each payout by sending stablecoins from base, polygon or solana to the deposit address it returns.
- **Agent mode** (`FLIQ_AGENT_ID` and a key): an agent pays from the fliq vault on NEAR of the person who connected it in the fliq app, within the daily and per-payout limits they set. No API key is involved: every request is signed with the agent's own NEAR key.

The agent variables win when both are set. With neither, the server stops at start and says what to set.

## Developer mode

```
claude mcp add fliq --env FLIQ_API_KEY=rt_test_... -- npx -y @fliqlabs/mcp
```

Or put this in `.mcp.json` (Claude Code) or `~/.cursor/mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "fliq": {
      "command": "npx",
      "args": ["-y", "@fliqlabs/mcp"],
      "env": { "FLIQ_API_KEY": "rt_test_...", "FLIQ_REFUND_ADDRESS": "0x..." }
    }
  }
}
```

| Tool                     | Does                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `cashout_quote`          | Prices a payout and returns the top three routes                                                                            |
| `cashout_verify_account` | Asks the bank for the name on an account                                                                                    |
| `cashout_pay`            | Creates the payout and returns where to send the deposit. **Refused unless the same account was verified in this session.** |
| `cashout_status`         | State, timeline, references and receipt link                                                                                |

A payout funded on base, polygon or solana needs a refund address on that chain, where the stablecoin goes back if the payout fails. `cashout_pay` takes it as `refund_address`, or uses `FLIQ_REFUND_ADDRESS` when that is an address on the quote's chain. Without either it answers `needs_refund_address`, and the model asks the person for one. `cashout_pay` always sends the name the bank confirmed, so the payout checks the same name.

An API key cannot pay a vault order (a payout funded from a fliq vault on NEAR). `cashout_pay` reports one as `blocked`: nothing moves, and the order lapses on its own. Vault payouts need agent mode.

## Agent mode

1. Make the agent's key. Only the public key is printed; the private key stays in the file.

   ```
   npx -y @fliqlabs/mcp keygen ~/.fliq/claude.key
   ```

2. In the fliq app, open Agents, connect an agent with that public key, and set its limits. The app shows the agent's NEAR account, for example `claude-frank.fliq.near`.

3. Add the server:

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

| Tool                 | Does                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cashout_limits`     | Caps, allowed currencies and what is left today                                                                            |
| `cashout_recipients` | The owner's saved accounts                                                                                                 |
| `cashout_quote`      | Prices a payout in NGN or KES from the vault                                                                               |
| `cashout_pay`        | Pays a quote to a saved account: fliq checks the limits, the agent signs the vault payout, fliq relays it and pays the gas |
| `cashout_status`     | State, timeline, references and receipt link                                                                               |

A payout over a limit is refused (`refused`) before anything is created, and the vault checks the caps again on chain. Requests go to `/v1/agent/*` with `X-Fliq-Agent`, `X-Fliq-Timestamp` and `X-Fliq-Signature`: an ed25519 signature over the method, the path with its query, the time and the SHA-256 of the body.

## Environment

| Variable                 | Mode      |                                                                                                                             |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `FLIQ_API_KEY`           | developer | A fliq API key, `rt_test_...` or `rt_live_...`.                                                                             |
| `FLIQ_SOURCE_CHAIN`      | developer | Optional. The chain quotes are funded from when the model doesn't say: `base` (default), `polygon` or `solana`.             |
| `FLIQ_REFUND_ADDRESS`    | developer | Optional. The default refund address, used for quotes on the chain it belongs to.                                           |
| `FLIQ_AGENT_ID`          | agent     | The agent's NEAR account, shown in the fliq app.                                                                            |
| `FLIQ_AGENT_KEY_FILE`    | agent     | A file holding the agent's `ed25519:...` secret key, as `keygen` writes it. Or:                                             |
| `FLIQ_AGENT_PRIVATE_KEY` | agent     | The same secret key inline.                                                                                                 |
| `FLIQ_NEAR_RPC_URL`      | agent     | Optional. The NEAR RPC used to read the key's nonce. Defaults to FastNEAR's mainnet RPC, or testnet for a `.testnet` agent. |
| `FLIQ_API_URL`           | both      | Optional. Overrides the API, which defaults to `https://api.fliq.cash/v1`. Include `/v1`.                                   |
| `FLIQ_RECEIPT_URL`       | both      | Optional. A link template with `{payout_id}`; without it `receipt_link` is null.                                            |

## Answers

Every tool returns the same envelope: `status`, a one-sentence `summary` the model can repeat, `provider_of_record`, `refund_address`, `receipt_link` and `data`. Full account numbers are never returned or logged; logs go to stderr and hold only tool names, outcomes and timings.

Which currencies can be paid depends on the payout providers live at the moment. When none can pay a currency, `cashout_quote` answers with the API's `no_route` error.

## Publishing

Publish by hand from `services/api/mcp` after `pnpm build`: `npm publish --access public`. npm provenance is not attached, because it can only be generated from a CI run, so the package page shows no provenance badge.
