# Relayer (L11) and account creation (A3)

A private service that does two things for the API, and nothing else:

1. **Relays** a user-signed NEAR delegate action (NEP-366) and pays its gas, for an allowlisted call only.
2. **Creates** a user's named account (`<label>.<NEAR_ROOT_ACCOUNT>`) owned by the user's own key, and pays its storage registration on USDC (and the vault, once deployed).

It has no public domain. Only the API (and later the MCP server) calls it, on Railway's private network, with `Authorization: Bearer <RELAYER_AUTH_TOKEN>`. The API authenticates the user first.

```
pnpm --filter @fliq/api exec tsx apps/relayer/src/server.ts   # needs the variables below and Redis
```

## Configuration (packages/config)

| Variable | What |
| --- | --- |
| `NEAR_NETWORK`, `NEAR_RPC_URL` | Network and RPC |
| `VAULT_CONTRACT_ID`, `USDC_CONTRACT_ID` | The only receivers the relayer will pay for |
| `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEYS` | Gas account and its key pool: 5 to 10 full-access keys outside local; it should hold only gas money |
| `RELAYER_AUTH_TOKEN` (`_PREVIOUS` during rotation), `RELAYER_PORT` | Service auth and port |
| `NEAR_ROOT_ACCOUNT`, `NEAR_ROOT_PRIVATE_KEY` | The parent account that creates `<label>.<root>` accounts; a separate authority from the gas pool |
| `NEAR_ACCOUNT_FUNDING_YOCTO` | NEAR sent to each new account, 0 to 0.1 NEAR. `0` works: a one-key account is a zero-balance account |
| `REDIS_URL` | Rate limits, key leases, nonces and idempotency records |

## API

Errors always have the shape `{ "error": { "code": "...", "message": "..." } }`.

### POST /v1/relays

Body: `{ "signed_delegate": "<base64 Borsh SignedDelegate>" }`, signed by the user's key over `sha256(NEP-461 prefix ‖ borsh(DelegateAction))` (what near-api-js `signDelegateAction` produces).

Checks, in order: signature; allowlist; one relay per delegate (the delegate hash is the idempotency key); 30 relays per sender per hour; not expired and at most 1,200 blocks ahead; the key is on the sender's account with an unused nonce, and a function-call key may only make calls it allows. Then a free pool key is leased, the delegate is wrapped unchanged in a transaction to the sender, and the result is returned after FINAL.

Allowlist (exactly one call per delegate, at most 100 Tgas, at most 2 KB of arguments). A `payout` needs at least 50 Tgas, because the vault forwards 30 Tgas to the USDC transfer and 20 Tgas to its callback and refuses less; sign it with about 80 Tgas:

| Receiver | Method | Arguments | Deposit |
| --- | --- | --- | --- |
| `VAULT_CONTRACT_ID` | `payout`, `release_order` | `{ "order_id": "<1..64 chars>" }` | 0 |
| `VAULT_CONTRACT_ID` | `set_agent` | `{ "agent_id": "<NEAR account>", "per_payout_cap": "<positive integer>", "daily_cap": "<positive integer>", "corridors": null \| ["NG-NGN-bank", ...] }` | 0 |
| `VAULT_CONTRACT_ID` | `remove_agent` | `{ "agent_id": "<NEAR account>" }` | 0 |
| `USDC_CONTRACT_ID` | `ft_transfer_call` | `{ "receiver_id": VAULT_CONTRACT_ID, "amount": "<positive integer>", "msg": "" }` | 1 yoctoNEAR |

Response `200` (`succeeded` or `failed`) or `202` (`pending`: the outcome is not known yet; poll the lookup below). A repeat of the same delegate returns the same body and is never paid for twice. `failed` means the transaction ran and a call inside it failed; `failures` says why.

Real example from testnet (the vault is not deployed yet, so the call itself fails, while the chain verified the user's signature and the relayer paid the gas):

```json
{
  "status": "failed",
  "tx_hash": "5erVLWza9yXZnDm3hM8uPGdj5ASgcqScCskRgyqWXiht",
  "delegate_hash": "9b29f77af1c147b5fcda5a29287e448b62a108280ba4c85c084f26dfa1dc6387",
  "sender_id": "relaycheck1.fliq.testnet",
  "receiver_id": "fliq-vault.testnet",
  "failures": ["{\"ActionError\":{\"index\":0,\"kind\":{\"AccountDoesNotExist\":{\"account_id\":\"fliq-vault.testnet\"}}}}"]
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_delegate.malformed`, `invalid_delegate.bad_signature`, `invalid_delegate.unsupported_action` | Not a valid signed delegate, a wrong signature, or something other than function calls |
| 400 | `expired`, `validity_too_long`, `invalid_request` | Expired or too-long delegate, or a bad body (unknown fields are refused) |
| 401 | `unauthorized` | Missing or wrong relayer token |
| 403 | `not_allowed`, `unknown_key`, `key_not_allowed` | Outside the allowlist, a key that is not the sender's, or a function-call key used outside its permission |
| 409 | `nonce_used`, `in_progress` | Replayed nonce, or the same delegate is being relayed right now |
| 429 | `rate_limited` | 30 relays for this sender in the last hour |
| 502 | `rejected_by_chain` | The chain refused the transaction outright; nothing ran, retrying is safe |
| 503 | `no_key_available`, `rpc_unavailable` | Every pool key is busy, or the RPC is down; retry |

### GET /v1/relays/{delegate_hash}

The stored result for a delegate, refreshed from the chain while it is `pending`. `404` if unknown.

### POST /v1/accounts

Body: `{ "account_id": "<label>.<NEAR_ROOT_ACCOUNT>", "public_key": "ed25519:<base58>" }`.

Creates the account with `public_key` as its only, full-access key, so only the user's device can act for it, then registers its storage on USDC and the vault. Idempotent: if that key already controls the account it is linked and only missing storage is paid for. "Created" is reported only after the key is visible at FINAL.

`201` created, `200` linked, `202` pending (the outcome is unknown: call again with the same body, it finishes the job without creating twice). `400 invalid_name` / `invalid_key`, `409 taken` (the account exists under another key) / `in_progress`, `502 chain_failure`, `503 busy` / `rpc_unavailable`.

Real example from testnet:

```json
{
  "status": "created",
  "account_id": "relaycheck1.fliq.testnet",
  "public_key": "ed25519:Cc4KMcLBy6ZmSfLv35Y46akVWoemVjCrrekZNcvmieFe",
  "tx_hashes": ["A1gk23RGHes73CKE3aLenekmcnaQNqsjojUoXqonhzsR", "A8G3FfMA7K7qcvKAUZ6sD8kdCJMnyd3mhsRsywgY9jst"],
  "storage": {
    "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af": "registered",
    "fliq-vault.testnet": "not_deployed"
  }
}
```

### GET /v1/status

Balances of the relayer account and the account creator against the 5 NEAR target: `level` is `ok`, `warning` (below 2 NEAR), `critical` (below 1 NEAR) or `missing`.

### GET /health

Liveness, no token.

## Onboarding through the relayer

`POST /v1/me/name` creates the user's account here when the API has `RELAYER_URL` and `RELAYER_AUTH_TOKEN`; without them it falls back to `MockProvisioner`, which creates nothing on chain.

- **Spec (done):** `ClaimNameRequest` carries `public_key`, `ed25519:<base58>`. `202` (`ClaimPending`) means the account is still being made: the app sends the same request with the same Idempotency-Key until it gets `201`.
- **API (done):** `RelayerProvisioner` in `apps/api/src/accounts.ts` calls `POST /v1/accounts` between two short database transactions, never inside one. `created` and `linked` are saved; `pending` and `in_progress` answer `202` and save nothing; `taken` is `409`; an unreachable relayer is `503 chain_unavailable`.
- **API (done):** `POST /v1/relays` and `GET /v1/relays/{delegateHash}` (`apps/api/src/relay.ts`) forward to this service. The API refuses a delegate whose sender is not the signed-in user's account, and passes this service's own errors through unchanged.
- **iOS (Frank):** generate an ed25519 key on the device (CryptoKit `Curve25519.Signing`), keep the private key in the Keychain behind Face ID, never show a seed phrase, and send the public key with the claim. A passkey cannot be the NEAR key: passkeys are P-256 and NEAR access keys are ed25519 or secp256k1.
- **Contract team:** deploy the vault; storage registration on it then happens automatically, and calling `POST /v1/accounts` again for existing users registers what is missing.

## Deploying on Railway

A second service from this repository, private only (no public domain), started with `pnpm --filter @fliq/api start:relayer`.

1. Set `NEAR_NETWORK=testnet` and a testnet `NEAR_RPC_URL`.
2. `NEAR_ROOT_ACCOUNT=fliqaccount.testnet` with `NEAR_ROOT_PRIVATE_KEY` set to a full-access key of `fliqaccount.testnet` (in the NEAR CLI keychain on the machine that created it). The API service must use the same `NEAR_ROOT_ACCOUNT`: the API names the account `<label>.<NEAR_ROOT_ACCOUNT>` and this service refuses names under any other parent (`invalid_name`).
3. `RELAYER_ACCOUNT_ID` and `RELAYER_PRIVATE_KEYS`: a gas account holding only gas money, with 5 to 10 full-access keys.
4. `VAULT_CONTRACT_ID` and `USDC_CONTRACT_ID`, the same values as the API's. Until the vault is deployed, new accounts report it as `not_deployed`.
5. `RELAYER_AUTH_TOKEN` (at least 16 characters; use a long random one), `RELAYER_PORT`, `REDIS_URL`.
6. Fund `fliqaccount.testnet` (about 0.009 NEAR per new account) and the gas account; `GET /v1/status` reports both against the 5 NEAR target.
7. On the API service set `RELAYER_URL=http://<relayer service>.railway.internal:<RELAYER_PORT>` and the same `RELAYER_AUTH_TOKEN`.
