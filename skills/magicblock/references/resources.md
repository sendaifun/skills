# Resources & Reference

## Environment Variables

```bash
# Devnet
SOLANA_RPC_ENDPOINT=https://rpc.magicblock.app/devnet
ROUTER_ENDPOINT=https://devnet-router.magicblock.app/
WS_ROUTER_ENDPOINT=wss://devnet-router.magicblock.app/

# Mainnet
SOLANA_RPC_ENDPOINT=https://rpc.magicblock.app/mainnet
ROUTER_ENDPOINT=https://router.magicblock.app/

# Set this from router getDelegationStatus result.fqdn for the account.
EPHEMERAL_PROVIDER_ENDPOINT=https://devnet-as.magicblock.app/
EPHEMERAL_WS_ENDPOINT=wss://devnet-as.magicblock.app/
```

## Status JSON API

- Source of truth: `https://status.magicblock.app/api/services`
- JSON path: `.environments[network].regions[region].servers[fqdn]`
- Network keys: `mainnet`, `devnet`
- Region keys: `asia`, `europe`, `usa`, `tee`
- Service IDs: `er`, `rpc_router`, `pricing_oracle`, `vrf_oracle`
- Live state: `.live_status[service]` (`true` = Operational, `false` = Down, missing = N/A)
- Downtime history: `.metrics[service]` minutes per day aligned with `.meta.days` in UTC

Current FQDNs are discoverable from the API. Common entries:

| Network | Region | Status API FQDN                 |
| ------- | ------ | ------------------------------- |
| Mainnet | Asia   | `as.magicblock.app`             |
| Mainnet | Europe | `eu.magicblock.app`             |
| Mainnet | USA    | `us.magicblock.app`             |
| Mainnet | TEE    | `mainnet-tee-as.magicblock.app` |
| Devnet  | Asia   | `devnet-as.magicblock.app`      |
| Devnet  | Europe | `devnet-eu.magicblock.app`      |
| Devnet  | USA    | `devnet-us.magicblock.app`      |
| Devnet  | TEE    | `devnet-tee-as.magicblock.app`  |

Example:

```bash
curl -sS https://status.magicblock.app/api/services \
  | jq '.environments.mainnet.regions.asia.servers["as.magicblock.app"].live_status'
```

## Version Policy

Keep exact versions only as known-good snapshots, compatibility tables, or
migration examples. Do not treat
versions in this skill as the latest recommendation. Before adding or changing
dependencies, inspect the target repo's `Cargo.toml`, `package.json`,
`rust-toolchain.toml`, lockfiles, and the relevant upstream manifests/docs.

Existing project manifests override this reference. Only change versions when
the user asked for an upgrade/migration or the current repo already establishes
that version line.

## Known-Good Example Snapshot

| Software | Version |
| -------- | ------- |
| Solana   | 3.1.9   |
| Rust     | 1.89.0  |
| Anchor   | 1.0.2 / 0.32.1 (example-dependent) |
| Node     | 24.10.0 |

> Active MagicBlock engine examples use mixed Anchor versions: examples such as
> root `counter/anchor`, `private-counter/anchor`, and
> `gachapon-example/programs/gachapon-example` use 1.0.2. Inspect the target example's `Cargo.toml` and
> preserve its version line unless the task explicitly requests a migration.

Example provenance verified at `magicblock-engine-examples` revision `1d11428` on **2026-07-16**:

| Exact example path | Rust SDK | TypeScript SDK |
|---|---:|---:|
| `spl-tokens/anchor` | `0.14.3` | root `0.14.3`; app `0.15.3` |
| `magic-actions/anchor` | `0.14.3` | `0.14.3` |
| `binary-prediction/anchor` | `=0.14.3` | `0.14.3` |
| `roll-dice/anchor` | `0.15.4` | app `0.14.3` |

These are working-example snapshots, not one mutually compatible version recommendation. The registry
latest was `0.16.0` on **2026-07-16**, while the code snippets in this skill intentionally use the
separately verified `0.15.5` SDK snapshot. Preserve a target repo's version line unless upgrading it
explicitly.

## Key Program IDs

| Program                  | Address                                        |
| ------------------------ | ---------------------------------------------- |
| Delegation Program       | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Magic Program            | `Magic11111111111111111111111111111111111111`  |
| Magic Context            | `MagicContext1111111111111111111111111111111`  |
| Session Key Program      | `KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5`  |
| Permission Program (PER) | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |
| VRF Program              | `Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz`  |
| Ephemeral SPL Token      | `SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2`  |
| Pricing Oracle           | `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`  |
| Localnet Validator       | `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`  |

Prefer the SDK constants over hardcoding these where available:
`ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID`,
`ephemeral_rollups_sdk::consts::ESPL_TOKEN_PROGRAM_ID`,
`ephemeral_rollups_sdk::vrf::consts::VRF_PROGRAM_ID` (and `DEFAULT_QUEUE`,
`DEFAULT_EPHEMERAL_QUEUE`).

## VRF Oracle Queues

The `oracle_queue` is a state account. Like every Solana account it lives on
Solana, but a delegated queue is directly writable only from inside an
ephemeral rollup, while a non-delegated queue is directly writable on the base
layer. Request randomness from the queue that matches where the transaction
runs. Prefer the `ephemeral_rollups_sdk::vrf::consts` constants over hardcoding
addresses.

| Constant                      | Network              | Queue                              | Address                                        |
| ----------------------------- | -------------------- | ---------------------------------- | ---------------------------------------------- |
| `DEFAULT_QUEUE`               | Mainnet / Devnet     | Base-layer queue                   | `Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh` |
| `DEFAULT_EPHEMERAL_QUEUE`     | Mainnet / Devnet     | Delegated queue (ephemeral rollup) | `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` |
| `DEFAULT_TEST_QUEUE`          | Localnet             | Base-layer queue                   | `GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb` |
| `DEFAULT_EPHEMERAL_TEST_QUEUE`| Localnet             | Delegated queue (ephemeral rollup) | `Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT` |

Mainnet and Devnet share the same default queue addresses — only the cluster
differs. Localnet uses dedicated test queues that the local validator clones
from Devnet.

## Rust Dependencies Snapshot

Snapshot verified **2026-07-13** against both package registries and the
`v0.15.5` SDK tag. Re-check before calling it latest:

```bash
cargo info ephemeral-rollups-sdk@0.15.5
npm view @magicblock-labs/ephemeral-rollups-sdk@0.15.5 version
git ls-remote --tags \
  https://github.com/magicblock-labs/ephemeral-rollups-sdk.git \
  refs/tags/v0.15.5
```

```toml
[dependencies]
anchor-lang = { version = "1.0.2", features = ["init-if-needed"] }
ephemeral-rollups-sdk = { version = "0.15.5", features = ["anchor"] }

# Feature flag picks the Anchor line:
#   "anchor"        → Anchor 1.x
#   "anchor-compat" → Anchor >=0.28,<1.0
# Add the access-control feature for Private Ephemeral Rollups (PER)
# ephemeral-rollups-sdk = { version = "0.15.5", features = ["anchor", "access-control"] }

# For cranks
magicblock-magic-program-api = { version = "0.10.1", default-features = false }
bincode = "^1.3"
sha2 = "0.10"

# For VRF, enable the SDK's scoped VRF API
# ephemeral-rollups-sdk = { version = "0.15.5", features = ["anchor", "vrf"] }
```

For a real repo, keep its existing compatible version line unless doing an
explicit migration.

## NPM Dependencies Snapshot

```json
{
  "dependencies": {
    "@coral-xyz/anchor": "0.32.1",
    "@magicblock-labs/ephemeral-rollups-sdk": "0.15.5"
  }
}
```

Additional product/tool snapshots verified **2026-07-15**; re-check before installation:

| Package | Snapshot | Context |
|---|---:|---|
| `@magicblock-labs/ephemeral-validator` | `0.13.7` | Local validator/stack binaries |
| `@magicblock-labs/magicsvm` | `0.1.1` | Fast in-process testing when the target repo has a verified setup |
| `@magicblock-labs/gum-sdk` | `^3.0.10` | Session Keys client in the current binary-prediction example |
| Rust `session-keys` | `=3.1.1` | Session token validation in the current binary-prediction example |

> The TypeScript `@coral-xyz/anchor` client stays on **0.32.1** even when the
> on-chain program is built with Anchor 1.0.2 — the IDL/client are compatible,
> so do not bump the npm Anchor package to 1.x.

## Documentation Links

- [MagicBlock Documentation](https://docs.magicblock.gg/)
- [Router getDelegationStatus](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/api-reference/er/getDelegationStatus)
- [MagicBlock Status API](https://status.magicblock.app/api/services)
- [MagicBlock Engine Examples](https://github.com/magicblock-labs/magicblock-engine-examples)
- [PER access-control guide — Ephemeral Permission lifecycle](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control#ephemeral-permission)
- [Anchor private-counter example](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/private-counter/anchor)
- [Ephemeral SPL Token](https://github.com/magicblock-labs/ephemeral-spl-token)
- [Pricing Oracle](https://github.com/magicblock-labs/real-time-pricing-oracle)
- [Pricing Oracle guide](https://docs.magicblock.gg/pages/tools/oracle/introduction)
- [Session Keys guide](https://docs.magicblock.gg/pages/tools/session-keys/introduction)
- [Ephemeral Accounts guide](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-accounts)
- [Local development guide](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development)
- [MagicBlock Validator](https://github.com/magicblock-labs/magicblock-validator)
- [Ephemeral Rollups SDK (Rust)](https://crates.io/crates/ephemeral-rollups-sdk)
- [Ephemeral Rollups SDK v0.15.5 source](https://github.com/magicblock-labs/ephemeral-rollups-sdk/tree/v0.15.5)
- [NPM Package](https://www.npmjs.com/package/@magicblock-labs/ephemeral-rollups-sdk)
- [Private Payments API Reference](https://payments.magicblock.app/reference)
- [Private Payments live OpenAPI document](https://payments.magicblock.app/doc) — mutable hosted
  contract; re-fetch before implementation rather than treating this skill's dated field tables as live
