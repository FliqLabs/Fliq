# Mainnet deploy runbook

Step-by-step for deploying the vault to NEAR mainnet. The contract team runs the commands. Frank holds the
Ledger and the money, so every step marked **Frank** needs him present with the device.

The plan is to deploy the exact bytes that passed the testnet acceptance run on 10 November 2026
(commit `2b0b385`, SHA-256 `38e1de4e948bb4a3ad194a864cadbaa62ef2ca09865f9042d1e2e3e248b0728c`, see
`BUILD.md` and `TESTNET_ACCEPTANCE.md`). `contracts/vault/src` has not changed since that commit.

## The four accounts

Mainnet mirrors testnet. Users get `<name>.<root>`, so the root name is what people see in their address.

| Role | Testnet today | Mainnet | Key | Holds |
| --- | --- | --- | --- | --- |
| Root and registration | `fliqaccount.testnet` | `fliqcash.near` | Hot key in Railway, Ledger key as backup | ~3 NEAR |
| Relayer gas | `relayer.fliqaccount.testnet` | `relayer.fliqcash.near` | Hot key pool in Railway | ~2 NEAR |
| Vault | `fliq-vault.testnet` | `vault.fliqcash.near` | **Ledger only** | ~3.2 NEAR |
| Owner | `fliq-owner.testnet` | `fliq-owner.near` | **Ledger only** | ~0.2 NEAR |

Why the keys sit where they do:

- **Owner and registration account are fixed at `new` and cannot be changed later.** There is no
  `set_owner`. Get the owner right the first time: it must be the Ledger account.
- **The vault's full-access key is the only way to upgrade the code.** There is no upgrade method on the
  contract. Keep that key on the Ledger, never on a laptop or server. Deleting it would freeze the code
  forever, including bug fixes.
- **Root and relayer sign automatically all day**, so their keys have to live in Railway. Keep little NEAR
  on them. If a hot key leaks, the Ledger backup key on `fliqcash.near` replaces it.

USDC on mainnet is `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, issued by Circle.

## Budget

About **8.5 NEAR** plus **$5 of USDC** for the first live payout. Names are free apart from storage
deposits; no registrar fee applies to `*.near` or its sub-accounts.

| Item | NEAR |
| --- | ---: |
| Vault code storage (270,648 bytes) | 2.71 |
| Vault state buffer and USDC registration | 0.5 |
| Root float (0.01 per new user, ~250 users) | 2.5 |
| Relayer gas float | 2 |
| Owner account | 0.2 |
| Account creation deposits and fees | 0.5 |

## Tools

- A Ledger with the NEAR app installed (Ledger Live, Manage apps, NEAR).
- `near` CLI (near-cli-rs) 0.20 or later, which signs with `sign-with-ledger`.
- `cargo-near` 0.23.0 and Docker, as in `BUILD.md`.

All commands below use `network-config mainnet`. Read each one aloud before Frank confirms it on the device.

## Steps

### 1. Fund the Ledger (Frank)

1. Open the NEAR app on the Ledger and run `near account import-account using-ledger network-config mainnet`
   to see its implicit account (64 hex characters).
2. Buy about 9 NEAR on an exchange and withdraw it to that implicit account.
3. Check it arrived: `near account view-account-summary <implicit> network-config mainnet now`.

### 2. Create the owner account (Frank)

```sh
near account create-account fund-myself fliq-owner.near '0.2 NEAR' \
  use-ledger sign-as <implicit> network-config mainnet sign-with-ledger send
```

`use-ledger` makes the Ledger key the account's only full-access key.

### 3. Create the root account (Frank, then the backend owner)

```sh
near account create-account fund-myself fliqcash.near '8.2 NEAR' \
  use-ledger sign-as <implicit> network-config mainnet sign-with-ledger send
```

8.2 NEAR because only a parent can create its sub-accounts: `fliqcash.near` passes 2 NEAR to the relayer
(step 4) and 3.2 NEAR to the vault (step 5), and keeps 3 NEAR for new users.

Then add the hot key the server will use. The backend owner generates it on their own machine, and only
the public key is shared:

```sh
near account add-key fliqcash.near grant-full-access use-manually-provided-public-key ed25519:<PUBLIC> \
  network-config mainnet sign-with-ledger send
```

### 4. Create the relayer account

```sh
near account create-account fund-myself relayer.fliqcash.near '2 NEAR' \
  use-manually-provided-public-key ed25519:<RELAYER_PUBLIC> sign-as fliqcash.near \
  network-config mainnet sign-with-ledger send
```

Add the rest of the relayer key pool (5 to 10 keys, see `services/api/apps/relayer/README.md`) the same way.

### 5. Create the vault account (Frank)

```sh
near account create-account fund-myself vault.fliqcash.near '3.2 NEAR' \
  use-ledger sign-as fliqcash.near network-config mainnet sign-with-ledger send
```

### 6. Build and agree the artifact (contract team)

Both contract owners, on their own machines:

```sh
git checkout 2b0b385
cd contracts/vault && cargo near build reproducible-wasm
shasum -a 256 target/near/fliq_vault.wasm
```

Both must get `38e1de4e948bb4a3ad194a864cadbaa62ef2ca09865f9042d1e2e3e248b0728c`. If either differs,
stop.

### 7. Deploy and initialise in one transaction (Frank signs)

```sh
USDC=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
ARGS=$(jq -nc --arg usdc "$USDC" '{owner: "fliq-owner.near", registration_account: "fliqcash.near", approved_usdc_token_contract: $usdc}')
near contract deploy vault.fliqcash.near use-file target/near/fliq_vault.wasm \
  with-init-call new json-args "$ARGS" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config mainnet sign-with-ledger send
```

`new` only accepts a call from the vault account itself, and a failed `new` rolls the deploy back.

### 8. Register the vault on USDC

```sh
near contract call-function as-transaction 17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 \
  storage_deposit json-args '{"account_id":"vault.fliqcash.near","registration_only":true}' \
  prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as fliqcash.near \
  network-config mainnet sign-with-ledger send
```

## Checks

Each check must pass before the next step. Record the transaction hashes in `BUILD.md` under a new
"Deployed on mainnet" section.

| Check | Command | Must show |
| --- | --- | --- |
| Code is the approved build | `near account view-account-summary vault.fliqcash.near network-config mainnet now` | code hash `4q3bEW9AqiRgSeQb2RvXjiNh1b5D69bKXi6nEgEsq1RV` |
| Config is right | `near contract call-function as-read-only vault.fliqcash.near get_config json-args {} network-config mainnet now` | owner `fliq-owner.near`, registration `fliqcash.near`, the USDC id above |
| Only Ledger keys on vault and owner | `near account list-keys vault.fliqcash.near network-config mainnet now` (and `fliq-owner.near`) | one full-access key each, the Ledger's |
| Vault can receive USDC | `storage_balance_of` on the USDC contract for `vault.fliqcash.near` | not `null` |
| Solvent at zero | `get_liabilities` on the vault and `ft_balance_of` on USDC for the vault | both `0` |

## After the contract (backend owner)

Railway gets a separate `mainnet` environment; testnet keeps running. Variables that change:
`NEAR_NETWORK`, `NEAR_RPC_URL`, `NEAR_ROOT_ACCOUNT`, `NEAR_ROOT_PRIVATE_KEY`, `NEAR_REGISTRATION_ACCOUNT_ID`,
`NEAR_REGISTRATION_PRIVATE_KEY`, `NEAR_STORAGE_PAYER_ACCOUNT_ID`, `RELAYER_ACCOUNT_ID`,
`RELAYER_PRIVATE_KEYS`, `VAULT_CONTRACT_ID`, `VAULT_ACCOUNT`, `USDC_CONTRACT_ID`, and the live Paycrest key.
Private keys are pasted into Railway by their owner directly, never into chat, a PR or a file.

Then the first live test: top up $5 of USDC, pay out $1 to $2 to Frank's bank account, and check
`get_liabilities` against `ft_balance_of` again.

## Never

- Never put the owner or vault key on a laptop, server or password manager.
- Never deploy a build whose hash both contract owners have not reproduced.
- Never deploy in two transactions (deploy, then `new` separately). Between them the vault runs with no
  state and every call fails, and a typo in the second call is not rolled back with the deploy.
