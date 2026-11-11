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

## Deployed on mainnet

`fliq-vault.near`, 11 November 2026. The artifact was built at commit `2b0b385` and reproduced
independently on two machines before deployment, both reaching
`38e1de4e948bb4a3ad194a864cadbaa62ef2ca09865f9042d1e2e3e248b0728c`. The on-chain code hash matches it.

| Field | Value |
| --- | --- |
| Account | `fliq-vault.near` |
| Commit | `2b0b385` |
| Size | 270648 bytes |
| SHA-256 | `38e1de4e948bb4a3ad194a864cadbaa62ef2ca09865f9042d1e2e3e248b0728c` |
| On-chain code hash | `4q3bEW9AqiRgSeQb2RvXjiNh1b5D69bKXi6nEgEsq1RV` |

| Step | Transaction |
| --- | --- |
| Deploy and `new`, one transaction | `DPZugrNDkTCBNq8Dypu7gLWL7T9xo4QRmP8jsTuzccut` |
| `storage_deposit` registering the vault on USDC | `Hv6AZcYg18sZCeDhH6FEo9cnXerc6VyBFCbfxAPTThAZ` |
| Owner `set_payout_timeout` to 1 hour | `2mCsJncmf4zSRcbzcZGJSiNviNr9K2PzREVyi4NCqKbb` |

Live configuration, read back from `get_config`:

| Field | Value |
| --- | --- |
| `owner` | `fliq-owner.near` |
| `registration_account` | `fliqaccount.near` |
| `approved_usdc_token_contract` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| `max_expiry` | 86400000000000 ns, 24 hours |
| `payout_timeout` | 3600000000000 ns, 1 hour |

The first three are fixed at `new` and have no setter. `payout_timeout` initialized to the 10-minute
default and was moved to 1 hour by the owner immediately afterwards, which is why that transaction is part
of the deployment rather than an afterthought.

`contract_source_metadata` reports
`git+https://github.com/FliqLabs/Fliq?rev=2b0b3858124fa95f7e1f7e4fa7b5409f664e5b31`, so anyone can check
which source produced the deployed bytes.

Verified immediately after deployment: `get_liabilities` 0 against `ft_balance_of` 0 on the approved USDC
contract, the vault registered for USDC storage, `storage_balance_bounds` min equal to max at
1410000000000000000000 yoctoNEAR, an unknown order returning `null`, and an unregistered account reporting
a zero balance. The write path has not been exercised on mainnet yet; it needs real USDC.

Account balances at deployment: vault 3.598 NEAR, of which 2.711 is locked against 271,140 bytes of code
and state, leaving about 0.886 of order headroom. Owner 0.3. Registration 4.14.

## Currently deployed on testnet

`fliq-vault.testnet`, deployed 10 November 2026 with `migrate` in the same transaction
(`6Tt1o2EPzDSxPyJ6bW8vKx2ZLYd6pSUwkwwa3jd8r8VB`). The on-chain code hash was checked against the built
artifact and matches.

| Field | Value |
| --- | --- |
| Commit | `2b0b385` |
| Size | 270648 bytes |
| SHA-256 | `38e1de4e948bb4a3ad194a864cadbaa62ef2ca09865f9042d1e2e3e248b0728c` |
| bs58 | `4q3bEW9AqiRgSeQb2RvXjiNh1b5D69bKXi6nEgEsq1RV` |

Because the Wasm embeds its own commit in NEP-330 source metadata, the hash is bound to the commit: the
same tree built at a different commit produces a different artifact. An approved hash therefore belongs to
exactly one commit, and no commit may land between approval and deployment.

### Previous build, kept for rollback

| Size | SHA-256 |
| ---: | --- |
| 259320 bytes | `8d5e6be5d2569b892d472f333e53810484adf2b752edbaed13878c7db5aa41e2` |

That build exports neither `withdraw` nor `migrate`, so it predates the November review fixes. Redeploying
it restores the old code over old-layout state; it does not undo a migration that succeeded.

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
