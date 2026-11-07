# @fliq/mcp

An MCP server that lets an AI agent quote, verify, pay and track fliq cash-outs. It speaks MCP over stdio, so Claude Code, Codex and Cursor start it with `npx`. Node 20 or newer.

## Add it to Claude Code

```
claude mcp add fliq --env FLIQ_API_KEY=rt_test_... -- npx -y @fliq/mcp
```

Or put this in `.mcp.json` (Claude Code) or `~/.cursor/mcp.json` (Cursor):

```json
{
  "mcpServers": {
    "fliq": {
      "command": "npx",
      "args": ["-y", "@fliq/mcp"],
      "env": { "FLIQ_API_KEY": "rt_test_..." }
    }
  }
}
```

## Environment

| Variable                                                                                         |                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLIQ_API_KEY`                                                                                   | Required. A fliq API key.                                                                                                                                  |
| `FLIQ_API_URL`                                                                                   | Optional. Defaults to `https://api.fliq.cash/v1`.                                                                                                          |
| `FLIQ_RECEIPT_URL`                                                                               | Optional. A link template with `{payout_id}`; without it `receipt_link` is null.                                                                           |
| `FLIQ_AGENT_ACCOUNT_ID`, `FLIQ_AGENT_PRIVATE_KEY`, `FLIQ_NEAR_RPC_URL`, `FLIQ_VAULT_CONTRACT_ID` | Optional, all four together. The vault agent: a NEAR account the payer registered with `set_agent`, its `ed25519:` key, a NEAR RPC and the vault contract. |

## Tools

| Tool                     | Does                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `cashout_quote`          | Prices a payout and returns the top three routes                                                  |
| `cashout_verify_account` | Asks the bank for the name on an account                                                          |
| `cashout_pay`            | Creates the payout for a quote. **Refused unless the same account was verified in this session.** |
| `cashout_status`         | State, timeline, references and receipt link                                                      |

Every tool returns the same envelope: `status`, a one-sentence `summary` the model can repeat, `provider_of_record`, `refund_address`, `receipt_link` and `data`. Full account numbers are never returned or logged; logs go to stderr and hold only tool names, outcomes and timings.

Without an agent key, `cashout_pay` returns the deposit instructions, or, for a payout reserved in the vault, says the person approves it in the fliq app. With an agent key it signs the vault `payout` call and sends it through `POST /relays`. **Today the API answers 403 to that call from an API key**, so the tool reports `blocked` and nothing moves until the API accepts agent relays.

The tool definitions live in `src/tools/definitions.ts` so the hosted server can serve the same ones.
