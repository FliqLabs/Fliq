# Testnet deployment preparation

The installed CLI is `near-cli-rs 0.31.1`. These commands are a preparation only; they require the operator's testnet credentials and spend NEAR, so they were not run by this review.

```sh
set -a; . contracts/vault/.env; set +a
cargo build --manifest-path contracts/vault/Cargo.toml --target wasm32-unknown-unknown --release
sha256sum contracts/vault/target/wasm32-unknown-unknown/release/fliq_vault.wasm

near contract deploy "$MOCK_USDC_ACCOUNT" use-file contracts/mock_usdc/target/wasm32-unknown-unknown/release/mock_usdc.wasm without-init-call network-config testnet sign-with-keychain send
near contract deploy "$VAULT_ACCOUNT" use-file contracts/vault/target/wasm32-unknown-unknown/release/fliq_vault.wasm without-init-call network-config testnet sign-with-keychain send
near contract call-function as-transaction "$VAULT_ACCOUNT" new json-args "{\"owner\":\"$OWNER_ACCOUNT\",\"registration_account\":\"$REGISTRATION_ACCOUNT\",\"approved_usdc_token_contract\":\"$MOCK_USDC_ACCOUNT\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-with-keychain send network-config testnet
near contract call-function as-transaction "$MOCK_USDC_ACCOUNT" storage_deposit json-args "{\"account_id\":\"$VAULT_ACCOUNT\"}" prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-with-keychain send network-config testnet
near contract call-function as-transaction "$MOCK_USDC_ACCOUNT" storage_deposit json-args "{\"account_id\":\"$VAULT_ACCOUNT\"}" prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-with-keychain send network-config testnet
```

The exact mock-token method names must be confirmed after the sandbox mock is completed. The vault initializer must be sent by `VAULT_ACCOUNT` itself. Do not put a credential, private key or seed phrase in `.env.example`, scripts, docs or handoff files.

The final demo must print transaction links for: deployments, vault initialization, storage registration, minting, top-up, order registration, policy creation, payout, callback outcome, release/recredit and balance checks.
