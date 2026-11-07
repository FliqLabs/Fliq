#!/usr/bin/env sh
set -eu

: "${VAULT_ACCOUNT:?source contracts/vault/.env first}"
: "${OWNER_ACCOUNT:?source contracts/vault/.env first}"
: "${REGISTRATION_ACCOUNT:?source contracts/vault/.env first}"
: "${MOCK_USDC_ACCOUNT:?source contracts/vault/.env first}"

WASM="contracts/vault/target/wasm32-unknown-unknown/release/fliq_vault.wasm"
echo "Build: cargo build --manifest-path contracts/vault/Cargo.toml --target wasm32-unknown-unknown --release"
echo "SHA256:"
sha256sum "$WASM"
echo "Deploy mock USDC and vault with near-cli-rs 0.31.1 using network-config testnet."
echo "Initialize from the vault account itself, then register storage and run the demo steps in docs/DEPLOYMENT.md."
echo "No transaction is submitted by this preparation script."
