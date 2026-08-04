# Local Development and Validation

MagicBlock applications span more than one runtime. A local Solana validator can validate ordinary
program logic, but it does not by itself prove delegation, ER routing, commits, PER privacy, VRF
callbacks, cranks, Magic Actions, or hosted payment services.

## Choose the environment by claim

| Claim to validate | Minimum useful environment |
|---|---|
| Pure instruction math and account constraints | Solana program test/LiteSVM/Mollusk where compatible |
| Base initialization and ordinary SPL behavior | Local Solana validator |
| Delegation, ER writes, commit, undelegate, Ephemeral Accounts | Local MagicBlock stack or Devnet |
| Router discovery and live multi-endpoint propagation | Devnet |
| Crank execution, VRF callback, Magic Action delivery | Environment running those services; Devnet for integration confidence |
| PER confidentiality/authorization boundary | TEE-backed PER environment |
| Hosted Private Payments API behavior | The actual API environment or its repository's supported local service setup |

Use the smallest environment that proves the current claim, then add a live integration test for the
cross-runtime behavior the product depends on.

## Local stack

The current package family includes `@magicblock-labs/ephemeral-validator`, with binaries such as
`mb-stack`, `mb-test-validator`, `ephemeral-validator`, `rpc-router`, and `vrf-oracle`. Names, versions,
and required configuration are version-sensitive: inspect the current package metadata and official
local-development guide before scripting them.

For the known-good `0.13.7` snapshot verified 2026-07-15, start the pinned package in a dedicated
terminal:

```bash
npx --yes --package=@magicblock-labs/ephemeral-validator@0.13.7 mb-stack
```

In that `0.13.7` snapshot, the defaults are base RPC `http://127.0.0.1:8899`, internal ER RPC
`http://127.0.0.1:7799`, and public query-filtering/ER entrypoint `http://127.0.0.1:6699`; websocket
ports are each HTTP port plus one. Override them with `MB_STACK_BASE_PORT`, `MB_STACK_ER_PORT`, and
`MB_STACK_PUBLIC_PORT`. Extra CLI arguments are forwarded to `mb-test-validator`, so base-validator
flags such as account/program loading belong after `mb-stack`. Use `MB_STACK_ER_REMOTES` only when the
ER must clone from/commit to a nonlocal base. Stop the supervisor with the terminal interrupt and
confirm its child processes exit.

Limitations:

- The stack does not build or deploy the user's program for them.
- Some service binaries require configuration and are not guaranteed to expose a harmless `--help`
  path. In particular, do not use `mb-stack --help` as a discovery probe because it can start services.
- A base validator plus ER does not automatically prove router, VRF, PER, or hosted API behavior.
- RPC URLs, validator identity, websocket URLs, and program deployments must agree across the test.

`@magicblock-labs/magicsvm` can be useful for fast in-process tests when the target repository has a
verified runnable setup. It is not evidence that live routing, service scheduling, TEE privacy, or
cross-layer propagation works.

## Repeatable workflow

1. Pin or record package, validator, SDK, Anchor, and Solana versions from the target repository.
2. Start only the services needed for the test claim.
3. Build and deploy the program to the base validator used by the stack.
4. Resolve the ER validator identity and route all delegation to the intended ER.
5. Use separate base, router, and ER connections; never reuse a base blockhash for an ER transaction.
6. Initialize on base, delegate on base, discover/verify the ER, operate on ER, then commit or
   undelegate and confirm propagation back on base.
7. Capture transaction signatures and logs from both runtimes.
8. Tear down processes deterministically and avoid fixed sleeps where state polling is possible.

## Test gates

At minimum, a product integration should include:

- a fast deterministic program-logic test;
- a local or Devnet delegation lifecycle test;
- endpoint/ownership assertions before and after delegation;
- one failure/retry test for cross-runtime propagation;
- service-specific tests for VRF, cranks, Magic Actions, oracle freshness, or payments when used;
- a production-like configuration check without committing credentials.

When local behavior differs from Devnet, verify versions, program IDs, cloned accounts, validator
identity, and service availability before changing application logic.

Sources: [MagicBlock local development docs](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development),
[ephemeral validator package](https://www.npmjs.com/package/@magicblock-labs/ephemeral-validator), and
[engine examples](https://github.com/magicblock-labs/magicblock-engine-examples).
