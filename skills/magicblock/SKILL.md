---
name: magicblock
description: Design, implement, and debug MagicBlock applications on Solana. Covers Ephemeral Rollups with delegated state; ER/PER architecture and settlement; private payments and token flows; oracles and randomness; scheduling and temporary authority; security and local validation. Use for MagicBlock product selection, integration, cross-product design, or production troubleshooting.
---

# MagicBlock Development Skill

## Pair with the `solana-dev` skill

Use this skill for MagicBlock-specific concerns: ER/PER, delegation, oracles, Session Keys, cranks, VRF,
Magic Actions, eSPL, and private payments. For general Solana or Anchor work such as scaffolding, PDAs,
account layouts, SPL tokens, clients, wallets, or LiteSVM/Mollusk testing, also load `solana-dev`.

## Key Concepts

**Ephemeral Rollups** enable high-performance, low-latency transactions by locking a delegated
account on the base layer while an ER clone continues to execute under the account's original program
owner. They are useful for gaming, real-time apps, and fast transaction throughput.

**Ephemeral Accounts** are born, used, and closed only inside an ER. They are useful for temporary
high-frequency state, but they never commit to Solana and therefore cannot be the only copy of durable
ownership, balances, rewards, or settlement results.

**Delegation** temporarily assigns the base-layer account to the Delegation Program and clones it into
the ER with its original program owner. Normal program ownership, signer, authority, and account
constraints still apply on the ER; delegation status is a routing and lifecycle concern, not a new
application authorization rule.

**Delegation debugging invariant**: a properly delegated account looks owned by
the delegation program on base, owned by the original program on the ER endpoint
returned by router `getDelegationStatus`, and cloned into the ER with
`delegated=true`.

For the verified SDK v0.15.5 snapshot, use **MagicIntentBundleBuilder** to
schedule commit and commit-and-undelegate intents. Do not use the deprecated
free functions `commit_accounts` and `commit_and_undelegate_accounts`.

**Private Ephemeral Rollups (PER)** gate a delegated account inside a TEE-backed validator with an ER-local `EphemeralPermission`. Delegate only the data account on the base layer, then create, update, and close its permission on the ER with `CreateEphemeralPermissionCpi`, `UpdateEphemeralPermissionCpi`, and `CloseEphemeralPermissionCpi`. Do not create or delegate a separate base-layer permission account.

**Magic Actions** are base-layer instructions scheduled inside an ER transaction via
`MagicIntentBundleBuilder.add_post_commit_actions(...)`. Each attempted base-layer transaction applies
its commit and actions atomically. If any BaseAction fails, the committor removes every BaseAction in
that affected `TransactionStrategy` before retrying its remaining commit strategy; actions in other
transaction/finalize strategies are outside that removal scope. Observe and reconcile every originally
scheduled action: scheduling or eventual commit success alone does not prove that any of them ran.

**Commit sponsorship**: every delegated account gets 10 free commits to base layer by default. To lift
the cap, either re-delegate (refreshes the quota) or attach the validator-scoped `magic_fee_vault` PDA
and a delegated fee payer to the intent bundle. The delegated payer is debited; the fee vault is the
validated destination credited with that commit fee.

**Lamports top-up**: when a delegated account (e.g. a delegated fee payer) needs more lamports on the ER side, use `lamportsDelegatedTransferIx` from the SDK. The transaction is submitted on **base layer** — the Ephemeral SPL Token program creates a single-use lamports PDA, funds it, and delegates it so the ER credits the destination.

**Ephemeral SPL Token** has two surfaces. In the SDK lifecycle model, clients use
`delegateSpl`/`transferSpl`/`undelegateIx`/`withdrawSpl`, and the ER balance appears as a normal SPL token
account at the owner's canonical ATA address, so Anchor programs can use plain SPL Token CPI. In the
direct-program model, contracts use `ephemeral-spl-api` and explicitly work with the eATA/global-vault
PDAs; do not apply the canonical-ATA model to that raw surface.

**Pricing Oracle** republishes supported market feeds for Solana/ER consumers. A safe integration
verifies the expected feed identity, upstream publish-time freshness, value domain, exponent, checked
arithmetic, and user price bounds; successful deserialization alone is not price validation.

**Session Keys** authorize a temporary signer for constrained application actions. Session validity is
separate from SPL token authority: token spending also requires an explicit, bounded token delegate
allowance.

**Architecture**:
```
┌─────────────────┐     delegate      ┌─────────────────────┐
│   Base Layer    │ ───────────────►  │  Ephemeral Rollup   │
│    (Solana)     │                   │    (MagicBlock)     │
│                 │  ◄───────────────  │                     │
└─────────────────┘    undelegate     └─────────────────────┘
     ~400ms                                  ~10-50ms
```

## Default stack

### Programs

Use Anchor with `ephemeral-rollups-sdk`; native and Pinocchio are also supported.

- Use the target repo's existing `ephemeral-rollups-sdk` / Anchor versions unless the task is an explicit upgrade
- The SDK feature flag selects the Anchor range: `anchor` for Anchor 1.x programs, or `anchor-compat` for Anchor >=0.28,<1.0 programs

**Required macros:**

- `#[ephemeral]` on the program module, **before** `#[program]` — injects the `process_undelegation` callback (the delegation program CPIs into it to return the account) and the commit/undelegate intent builders. Commit and undelegation require it; delegation itself does not. Include it on any program that delegates so its accounts can later be undelegated.
- `#[delegate]` and `#[commit]` on the respective delegation/commit account contexts.
- `#[vrf]` on a VRF *request* context **and** `#[vrf_callback]` on the VRF *callback* context — the
  callback macro authenticates fulfillment. Enable the `vrf` feature on `ephemeral-rollups-sdk`.
  SDK v0.15.5 re-exports VRF, so new Anchor code does not need a direct
  `ephemeral-vrf-sdk` dependency. See [vrf.md](references/vrf.md).

**Non-Anchor programs:** use the
`ephemeral-rollups-pinocchio` crate (delegation, commit, and VRF have Pinocchio equivalents). The
engine examples repo ships Anchor and Pinocchio variants of `roll-dice`; use Pinocchio when
the target program is native rather than Anchor.

Versions in this skill are known-good snapshots or compatibility markers. Before changing dependencies,
inspect the target repository's manifests, toolchain files, lockfiles, and relevant upstream sources.
See [resources.md](references/resources.md) for the dated snapshot and source links.

### Connections

- Base layer connection for initialization and delegation:
  `https://rpc.magicblock.app/devnet` or `https://rpc.magicblock.app/mainnet`
- Router connection for delegation status:
  `https://devnet-router.magicblock.app/` or `https://router.magicblock.app/`
- Ephemeral rollup connection for operations on delegated accounts:
  use the `fqdn` returned by router `getDelegationStatus`

### Transaction routing

- Delegate transactions → Base Layer
- Operations on delegated accounts → Ephemeral Rollup
- Undelegate/commit transactions → Ephemeral Rollup

## Operating procedure

### 0. Plan architecture when the design is not fixed

For a new application, integration design, migration, or implementation plan, read
[architecture-planning.md](references/architecture-planning.md) before writing code. Decide whether MagicBlock
is needed, select the smallest product set, map accounts and transaction routing, define settlement
and recovery, and choose validation environments. Ask at most three material questions per round;
otherwise proceed with explicit assumptions.

### 1. Classify the operation type

- Account initialization (base layer)
- Delegation (base layer)
- Operations on delegated accounts (ephemeral rollup)
- Commit state (ephemeral rollup)
- Undelegation (ephemeral rollup)
- ER-only Ephemeral Account lifecycle (ephemeral rollup; never commits)
- Asynchronous service work (VRF callback, crank, queued transfer, or Magic Action)
- Hosted API transaction construction followed by client signing/submission

### 2. Pick the right connection

- Base layer: `https://rpc.magicblock.app/devnet` or `https://rpc.magicblock.app/mainnet`
- Router: `https://devnet-router.magicblock.app/` or `https://router.magicblock.app/`
- Ephemeral rollup: the `fqdn` returned by router `getDelegationStatus` for the account

### 3. Implement with MagicBlock-specific correctness

For each implementation, record:
- Which connection to use for each transaction
- Router `getDelegationStatus` checks before operations
- PDA seeds matching between delegate call and account definition
- Preserving preflight for supported base transactions, and using `skipPreflight: true` only for an ER
  path with a known simulation incompatibility (document the reason and inspect execution logs)
- Waiting for state propagation after delegate/undelegate
- For Ephemeral SPL Token flows, selecting the deposit and withdrawal builders independently: use the
  default shuttle withdrawal, or explicitly run `undelegateIx`, wait for its base commit, and call the
  legacy `withdrawSpl(..., { idempotent: false })`; use `ephemeral-spl-api` exports (not copied bytes
  or guessed seeds) for direct CPI
- For oracle flows, feed identity, maximum age, numeric conversion, user limits, and stale-feed behavior
- For Session Keys, scope, expiry, optional one-time signer lamports top-up, revocation, application-
  enforced spending limits, and any separate SPL delegate allowance
- For asynchronous flows, the difference between acceptance/scheduling and completion, plus observation,
  idempotency, timeout, retry, refund, and reconciliation

For security-sensitive designs, reviews, and implementations, read [security.md](references/security.md). Separate
protocol guarantees from required integration validation, application policy, and ordinary Solana
security. Do not present an application recommendation as a MagicBlock protocol guarantee.

### 4. Debug live delegation/routing failures

For `InvalidWritableAccount`, missing private balances, validator mismatch, or
"account is delegated but ER rejects it" reports:
- Start from the exact signature or account pubkey.
- Query router `getDelegationStatus` and use its `fqdn` for ER reads/transactions.
- Compare base ownership, router status, ER ownership, and recent ER transaction logs.
- Treat base ownership by the delegation program as expected for a delegated account.
- See [debugging.md](references/debugging.md) for the full runbook.

### 5. Diagnose possible service-side failures

For unexpected RPC, routing, oracle, or transaction errors that could be service-side:
- Always fetch current data; do not answer from remembered status. Use the direct JSON API `https://status.magicblock.app/api/services` as the source of truth.
- Select the same network the code uses: JSON keys are `mainnet` and `devnet`.
- Match the affected endpoint to the right region/server and service:
  - Regions are `asia`, `europe`, `usa`, and `tee`.
  - Service IDs are listed in `.meta.services`; currently `er` (Ephemeral Rollup), `rpc_router`, `pricing_oracle`, and `vrf_oracle`.
  - Use the server entries under `.environments[network].regions[region].servers`; for mainnet Asia this includes `as.magicblock.app`.
- Interpret `.live_status[service]`: `true` = Operational, `false` = Down, missing/undefined = N/A.
- Interpret `.metrics[service]` as downtime minutes per day aligned with `.meta.days` in UTC.
- When reporting findings, include the network, region, endpoint, service status, and relevant date range. Distinguish live status from historical downtime.
- For direct ER RPC endpoints, optionally correlate with JSON-RPC `getHealth` or `getVersion`, but do not let a single RPC probe replace the status API.

### 6. Add appropriate features

- Cranks for recurring automated transactions
- VRF for verifiable randomness in games/lotteries
- Private payments API for private transfers and swaps
- Pricing Oracle for verified external market data
- Session Keys for repeated low-friction user actions
- Ephemeral Accounts for temporary state that is explicitly allowed to disappear

When combining products, read [composition-patterns.md](references/composition-patterns.md) and keep authority,
token control, oracle validity, ER execution, base settlement, and asynchronous completion as separate
guarantees.

### 7. Deliverables expectations

When you implement changes, provide:
- Exact files changed + diffs
- Commands to install/build/test
- Risk notes for anything touching delegation/signing/state commits

## Progressive disclosure (read when needed)

- Architecture planning, output templates, and validation-environment selection: [architecture-planning.md](references/architecture-planning.md)
- Cross-product selection and boundary design: [composition-patterns.md](references/composition-patterns.md)
- MagicBlock-specific security boundaries and source standards: [security.md](references/security.md)
- Debugging ER/delegation failures: [debugging.md](references/debugging.md)
- Core delegation patterns: [delegation.md](references/delegation.md)
- Ephemeral Accounts (ER-only temporary state): [ephemeral-accounts.md](references/ephemeral-accounts.md)
- Magic Actions (post-commit base-layer instructions): [magic-actions.md](references/magic-actions.md)
- Topping up a delegated account with lamports: [lamports-topup.md](references/lamports-topup.md)
- Ephemeral SPL Token lifecycle (deposit, transfer, app-program CPI, undelegate, withdraw): [ephemeral-spl-token.md](references/ephemeral-spl-token.md)
- TypeScript frontend setup: [typescript-setup.md](references/typescript-setup.md)
- Cranks (scheduled tasks): [cranks.md](references/cranks.md)
- VRF (randomness): [vrf.md](references/vrf.md)
- Pricing Oracle (feed identity, freshness, and safe consumption): [pricing-oracle.md](references/pricing-oracle.md)
- Session Keys (scoped temporary authority): [session-keys.md](references/session-keys.md)
- Private Payments API: [private-payments.md](references/private-payments.md)
- Local development and environment-specific validation: [local-development.md](references/local-development.md)
- Reference links & versions: [resources.md](references/resources.md)

## Terminal Self-Heal Proposal

Before the final response, review the entire run against this skill's intended workflow.

Check:
- expected vs actual user-visible outputs
- command, script, validation, and artifact results
- missed coverage or skipped workflow steps
- stale instructions or brittle wording
- unexpected script/output mismatches
- verification gaps
- fallback or impromptu behavior

If gaps are found, report them with evidence and request explicit approval for a separate maintenance
task. Treat installed skill files as read-only during normal execution.
