# Contract build record

The official release build is run from each crate with Rust 1.95.0 from the pinned `rust-toolchain.toml`:

```sh
cd contracts/vault && cargo near build non-reproducible-wasm --no-abi
cd contracts/mock_usdc && cargo near build non-reproducible-wasm --no-abi
```

Outputs:

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `contracts/vault/target/near/fliq_vault.wasm` | 259320 bytes | `dcde0eb1bd1f15a7945d52e2d34c4eace20663960e9c23fa8590d2240610a40f` |
| `contracts/mock_usdc/target/near/fliq_mock_usdc.wasm` | 162235 bytes | `6e14b97569bdeb389a59f84efc8fe97a2c7826356a9f30854f03ee9126759cce` |

Testnet uses NEAR protocol 88. The sandbox test requires a near-workspaces sandbox binary with protocol 88 support.
