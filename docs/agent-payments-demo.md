# Agent payments testnet demo

Do not run these commands until the listed accounts and testnet USDC are ready.

## Accounts and setup

- A user/owner account with testnet USDC and enough vault USDC balance.
- An agent account with an ed25519 key; the agent holds no USDC.
- `fliqaccount.testnet`, the live vault registration account.
- A service pay-to NEAR account, registered for the approved USDC token.
- Testnet USDC source supplied by Oladipo or the testnet USDC owner.
- The live API with `AGENT_API_PAY_TO_ADDRESS` set to the service account.

## Configure the agent

Read the argument names from [contracts/vault/src/lib.rs](/Users/jamespeters/Documents/Fliq/contracts/vault/src/lib.rs). The policy needs a 1-cent per-payout cap and a daily cap chosen by the owner. This recording uses both at `10000`.

```sh
OWNER_ACCOUNT="<owner.testnet>"
AGENT_ACCOUNT="<agent.testnet>"
AGENT_PUBLIC_KEY="<ed25519:...>"
VAULT_ACCOUNT="fliq-vault.testnet"
EXPIRY_NS="$(($(date +%s) * 1000000000 + 86400000000000))"

near contract call-function as-transaction "$VAULT_ACCOUNT" set_agent \
  json-args "{\"public_key\":\"$AGENT_PUBLIC_KEY\",\"agent_id\":\"$AGENT_ACCOUNT\",\"per_payout_cap\":\"10000\",\"daily_cap\":\"10000\",\"corridors\":[\"API\"],\"cooldown_ns\":\"0\",\"expiry_ns\":\"$EXPIRY_NS\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' \
  sign-with-keychain send network-config testnet
```

Confirm the live policy:

```sh
near view "$VAULT_ACCOUNT" get_policy \
  json-args "{\"owner\":\"$OWNER_ACCOUNT\",\"agent_id\":\"$AGENT_ACCOUNT\"}" \
  network-config testnet
```

Register the service pay-to address on the USDC token:

```sh
USDC_CONTRACT="<approved-usdc-testnet-contract>"
SERVICE_PAY_TO="<service.testnet>"

near contract call-function as-transaction "$USDC_CONTRACT" storage_deposit \
  json-args "{\"account_id\":\"$SERVICE_PAY_TO\",\"registration_only\":false}" \
  prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
  sign-with-keychain send network-config testnet
```

## Fund and top up

The testnet USDC source and the owner account must provide at least `10000` base units for the normal call and enough for a second over-daily call. Transfer USDC to the owner and then add it to the vault through the normal Fliq top-up flow.

## Run the demo agent

Set placeholders in a shell-local environment and run the Node script:

```sh
export DEMO_API_URL="http://localhost:4000/v1/demo/rates/usdc/ngn"
export AGENT_ACCOUNT="<agent.testnet>"
export AGENT_PRIVATE_KEY="<private-key-placeholder>"
export NEAR_RPC_URL="https://rpc.testnet.near.org"
node docs/agent-payments-demo.mjs
```

The script:

1. Calls the API and signs the agent headers.
2. Reads `402` payment details.
3. Signs `payout(order_id, amount, deposit_address)` with 50 Tgas.
4. Retries with `x-fliq-payment: order_id`.
5. Registers the successful paid call in Activity.
6. Calls the endpoint again and attempts the second 10000-unit payout, which the live policy should refuse with `POLICY_DAILY_CAP`.

The script never prints `AGENT_PRIVATE_KEY`. It may print transaction hashes and public status only.

## Manual payout commands

After reading `order_id`, amount and address from the `402` response:

```sh
near contract call-function as-transaction "$VAULT_ACCOUNT" payout \
  json-args "{\"order_id\":\"<order_id>\",\"amount\":\"10000\",\"deposit_address\":\"<service.testnet>\"}" \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-with-keychain send network-config testnet
```

Retry:

```sh
curl -i -H "X-Fliq-Agent: $AGENT_ACCOUNT" \
  -H "X-Fliq-Timestamp: <timestamp>" \
  -H "X-Fliq-Signature: <agent-signature>" \
  -H "X-Fliq-Payment: <order_id>" \
  "$DEMO_API_URL"
```

## Recording checklist

- Show the live naira rate before and after payment.
- Show the first `402` response, including price `10000`, vault account and order ID.
- Show the owner balance, agent policy and payout transaction.
- Show the paid retry returning `200`.
- Show Activity: `Agent paid $0.01 to Live Naira Rate`.
- Show the second call and failed chain transaction for `POLICY_DAILY_CAP`.
- Show the owner still able to inspect the refusal in Activity.
- Record transaction hashes and an explorer link.
- Do not show private keys or environment values.

## People needed

- Testnet USDC source: Oladipo (backend).
- Service pay-to address and USDC storage registration: backend/service owner.
- iOS Activity change: Frank. The existing Activity `payout` row should display a paid API party and `$0.01`; iOS can remain unchanged until the owner adds it.
