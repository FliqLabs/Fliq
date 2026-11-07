# fliq MCP server

Lets an AI agent pay out from its owner's fliq vault, within the limits the owner set. It runs on the machine that runs the agent and holds the agent's key; fliq never sees it.

## Connect an agent

1. Make the agent's key. Only the public key is printed; the private key stays in the file.

   ```
   pnpm --filter @fliq/api mcp:keygen ~/.fliq/claude.key
   ```

2. In the app, open Agents › Connect an agent, paste or scan that public key, set the daily cap, per-payout cap, currencies and saved accounts only, and confirm with Face ID. The app shows the agent's account, for example `claude-frank.fliq.near`.

3. Add the server to the MCP host. For Claude Desktop, in `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "fliq": {
         "command": "pnpm",
         "args": ["--dir", "/path/to/Fliq/services/api", "mcp"],
         "env": {
           "FLIQ_API_URL": "https://fliq-yclq.onrender.com",
           "FLIQ_AGENT_ID": "claude-frank.fliq.near",
           "FLIQ_AGENT_KEY_FILE": "/Users/you/.fliq/claude.key",
           "NEAR_RPC_URL": "https://rpc.testnet.fastnear.com"
         }
       }
     }
   }
   ```

## Tools

| Tool | What it does |
| --- | --- |
| `fliq_limits` | Caps, allowed currencies, what is left today |
| `fliq_recipients` | The owner's saved accounts |
| `fliq_quote` | Price a payout in NGN or KES from the vault |
| `fliq_pay` | Pay a quote to a saved account: fliq checks the limits, the agent signs the vault payout, fliq pays the gas |
| `fliq_payout_status` | Where a payout is, with the bank reference once paid |

Every request is signed with the agent's key (`X-Fliq-Agent`, `X-Fliq-Timestamp`, `X-Fliq-Signature`; see `agentSignature` in `spec/openapi.yaml`). A payout over a limit is refused before anything is created and shows on the owner's Activity; the vault checks the caps again on chain.
