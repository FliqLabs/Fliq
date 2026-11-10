# Contract build record

## The artifact that gets approved and deployed

The vault Wasm that two contract owners approve, and that is then deployed, is built reproducibly:

```sh
cd contracts/vault && cargo near build reproducible-wasm
```

The build environment is pinned by digest in `[package.metadata.near.reproducible_build]` in
`contracts/vault/Cargo.toml`:

| Field | Value |
| --- | --- |
| image | `sourcescan/cargo-near:0.22.0-rust-1.99.1` |
| digest | `sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb` (linux/amd64) |
| inner command | `cargo near build non-reproducible-wasm --locked --no-abi` |

The digest was verified against the live registry on 10 November 2026 and matches the default that
`cargo near new` generates for cargo-near 0.23.0. The tag is descriptive only; the image is identified by
the digest, which is what makes two owners building the same commit get the same bytes.

The inner command says `non-reproducible-wasm` on purpose: reproducibility comes from the pinned
container, not from the build that runs inside it.

The image carries Rust 1.99.1 while `rust-toolchain.toml` pins 1.95.0. That combination is intentional and
is what cargo-near's own project template ships; the toolchain file is honoured inside the container.

### Prerequisites

- `cargo-near` 0.23.0 or later (`cargo install cargo-near --locked`).
- A running Docker daemon that can reach `registry-1.docker.io`. On an arm64 Mac the amd64 image runs
  under emulation, which is slower but produces the same bytes.
- **A clean, committed working tree.** cargo-near clones the repository at `HEAD` into a temporary build
  site and discards uncommitted changes, so anything not committed is silently not in the artifact.
  Uncommitted changes are a warning when building and a hard error when deploying through Docker.
- `Cargo.lock` committed, because the inner command uses `--locked`.

## Approved artifact

Not yet built. Record the commit, size and SHA-256 of the reproducible build here at the Phase 2 approval
gate, and have both owners reproduce the hash from the same commit before they approve it.

| Artifact | Commit | Size | SHA-256 |
| --- | --- | ---: | --- |
| `contracts/vault/target/near/fliq_vault.wasm` | | | |

## Currently deployed on testnet

Measured from chain on 10 November 2026, kept as the rollback reference for the upgrade of
`fliq-vault.testnet`:

| Account | Size | SHA-256 |
| --- | ---: | --- |
| `fliq-vault.testnet` | 259320 bytes | `8d5e6be5d2569b892d472f333e53810484adf2b752edbaed13878c7db5aa41e2` |

That build exports neither `withdraw` nor `migrate`, so it predates the November review fixes.

## mock_usdc

`contracts/mock_usdc` is a testnet-only stand-in and is never deployed to mainnet, so it is not built
reproducibly and has no pinned build environment:

```sh
cd contracts/mock_usdc && cargo near build non-reproducible-wasm --no-abi
```

## Notes

Testnet uses NEAR protocol 88. The sandbox test requires a near-workspaces sandbox binary with protocol 88
support.

Earlier revisions of this file recorded `dcde0eb1bd1f15a7945d52e2d34c4eace20663960e9c23fa8590d2240610a40f`
for the vault from a `non-reproducible-wasm` build. That hash matches nothing currently deployed, and two
non-reproducible builds of one commit need not agree, which is why the approved artifact is now built in a
pinned container instead.
