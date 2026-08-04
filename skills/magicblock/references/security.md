# MagicBlock Security Boundaries

Use this guide for security reviews, architecture decisions, and implementation work involving one or
more MagicBlock products. Pair it with the relevant product guide and with a general Solana security
review. This file covers only MagicBlock-specific boundaries.

## Source standard

Classify every security statement before presenting it:

1. **Protocol guarantee** — enforced by current on-chain code or explicitly documented behavior.
2. **Integration validation** — a check the application must perform to use that guarantee safely.
3. **Application policy** — a product-specific limit, recovery rule, or risk decision.
4. **General Solana practice** — signer, owner, PDA, token-authority, arithmetic, and account-validation
   rules that apply whether MagicBlock is used or not.

Use pinned official program source first, then the matching SDK source, official documentation, and
published audits. Label inferences and application policies explicitly. Do not turn generic defensive
advice into a claimed MagicBlock protocol invariant.

## Delegation is not a new authorization boundary

During delegation, the base-layer account is locked under the Delegation Program while its ER clone
retains the original program owner. Code executing on the ER therefore uses the same application-level
ownership, signer, authority, PDA, and account constraints as the program uses on Solana.

- Use base owner, router `getDelegationStatus`, and ER owner as routing and lifecycle evidence.
- Do not authorize an application action merely because an account is delegated.
- Do not add a special ER ownership rule when the program's ordinary ownership validation already
  applies.
- Distinguish current ER state from state already committed to base. Require base-layer settlement only
  when the product outcome depends on base-layer visibility or composability.

Sources: [transaction lifecycle](https://github.com/magicblock-labs/docs/blob/f1d1e0cc60b825e332ed4e897b7dffe3d811828b/pages/ephemeral-rollups-ers/introduction/transactions.mdx),
[SDK delegation resolver](https://github.com/magicblock-labs/ephemeral-rollups-sdk/blob/32c7f748e06387d422756bc2f6b874f0a0d165a6/rust/resolver/src/account.rs), and
[ER architecture](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup).

## Magic Action attempts are atomic, but retries may omit a strategy's actions

Within one attempted base-layer transaction, post-commit actions execute after the commit and an action
failure reverts that transaction. The committor can then remove all BaseActions in the affected
`TransactionStrategy` and retry that strategy's remaining commit work. Actions in other transaction or
finalize strategies are outside that removal scope. A later successful commit therefore does not prove
that any originally scheduled action in the affected strategy ran.

- Validate action discriminators, ordered account metas, writable flags, signer derivations, escrow
  funding, and per-action compute budgets.
- Treat the ER scheduling signature as intent acceptance, not proof that the base-layer transaction is
  already visible.
- Observe the base transaction and every originally scheduled effect before marking the product
  operation settled; reconcile even an action whose attempted execution was reverted before the whole
  strategy's BaseActions were removed, and treat commit-without-actions as a recoverable product state.
- Never retry the base action independently unless reconciliation proves the original action effect did
  not apply. Use a durable operation identity for economic effects.

Source: [Magic Actions troubleshooting and atomicity](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/magic-actions/troubleshooting).

## Session Keys require application-defined limits

The session token binds a temporary signer to a wallet authority, target program, and validity period.
The target program validates the token. Fine-grained instruction, value, or transaction-count limits
are application policy unless the application explicitly implements them.

- Validate the expected authority, session signer, target program, expiry, and revocation state on
  every session-enabled path.
- Keep recovery, withdrawals, permission changes, and other high-impact paths wallet-only unless the
  application deliberately authorizes them.
- Treat an SPL token delegate as a separate authority. Bound and revoke its allowance independently of
  the session token.
- Treat browser-held session secrets as temporary hot keys and minimize their lifetime and reach.

Sources: [Session Keys security](https://docs.magicblock.gg/pages/tools/session-keys/security),
[Session Keys lifecycle](https://docs.magicblock.gg/pages/tools/session-keys/how-do-session-keys-work), and
[session program source](https://github.com/magicblock-labs/session-keys/blob/91c631eef184afa5cbfe81ea478de46232bd6420/programs/gpl_session/src/lib.rs).

## VRF callbacks must be scoped and correlated

A successful VRF request is not fulfillment. The application outcome exists only after the callback.

- Use the current scoped callback identity for the consuming program. In Anchor, apply
  `#[vrf_callback]`; in native/Pinocchio code, validate `scoped_vrf_identity(program_id)`.
- Bind the callback to the expected request and application object, and consume each request once.
- Prevent user-controlled seed grinding when the result has economic value.
- Represent pending, fulfilled, timed-out, and superseded requests explicitly so a late callback cannot
  satisfy a newer request.

Sources: [VRF security](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/introduction/security),
[VRF best practices](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/best-practices),
[VRF program source](https://github.com/magicblock-labs/solana-vrf/blob/8397569bd47388f400e7f2f32360fbb5dcac165b/program/src/provide_randomness.rs), and
[scoped identity source](https://github.com/magicblock-labs/solana-vrf/blob/8397569bd47388f400e7f2f32360fbb5dcac165b/api/src/state/mod.rs).

## Pricing Oracle consumers validate identity and freshness

Successful deserialization does not establish that a price is the expected or current price.

- Validate the canonical provider/feed account, expected feed ID and exponent, typed receiver state,
  `posted_slot > 0`, a sensible value, and freshness. Initialization itself sets
  `VerificationLevel::Full` on a zero-value placeholder with `posted_slot = 0`, so `Full` alone does
  not prove the authenticated MagicBlock republisher posted the current value. The account exposes no
  separate provenance field; these checks establish consistency with the authorized update path, not
  independent verification of an upstream Pyth/Stork proof.
- Enforce maximum age using the upstream `publish_time`, not only the local posted slot.
- Validate the value domain and exponent with checked arithmetic.
- Treat confidence rules, price-deviation limits, slippage, and stale-feed fallback as explicit
  application policy.

Source: [current Pricing Oracle program](https://github.com/magicblock-labs/real-time-pricing-oracle/blob/81169435300c136c37fe9f991e24c4fc46159c53/program/ephemeral-oracle/programs/ephemeral-oracle/src/lib.rs).

## PER permissions and TEE trust are separate checks

- Grant only the required visibility and interaction flags, and retain at least one trusted permission
  authority so the application cannot lock itself out.
- Treat publishing a permissioned account as a confidentiality change, not a routine configuration
  update.
- `verifyTeeRpcIntegrity` verifies a fresh genuine TDX quote bound to its challenge, but it does not
  compare MRTD, RTMR, or configuration values to an expected workload allowlist. Perform that separate
  allowlist check when workload identity matters, and do not claim that the helper proves which code is
  running.
- Authenticate the client through the documented signed challenge flow before trusting a private
  endpoint.
- Keep application authorization independent from PER visibility. Permission to see or submit against
  private state does not by itself authorize a business action.

Sources: [PER access control](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control) and
[TEE client verification](https://docs.magicblock.gg/pages/tools/tee/client-implementation).

## Private Payments separate authentication, signing, and settlement

- Use the documented challenge-sign-login flow for private reads and routes, and scope the bearer token
  to the wallet that authenticated.
- Inspect the builder response, sign with every key listed in `requiredSigners`, and submit to its declared `sendTo`
  runtime or exact `sendRpcEndpoint`.
- Do not interpret source transaction confirmation as final settlement for a queued private transfer.
- Treat token storage, browser persistence, and log redaction as general credential-handling policy,
  not protocol guarantees supplied by the Payments API.

Sources: [Private Payments API](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/introduction) and
[challenge/login flow](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/login).

## Ephemeral SPL Token queues expose multiple completion states

Queued private and cross-runtime transfers separate source acceptance, scheduling, payout callback, and
refund/recovery. A queue item can be removed when its settlement action is scheduled, before the payout
result is known.

- Use the public SDK/API builders rather than copying discriminators, account order, or PDA seeds.
- Expose pending, settled, and refunded/failed states; do not use queue absence as payment proof.
- Correlate every split through its group/client reference and reconcile the full amount.
- Treat the eSPL queue tick's permissionless invocation as a property of that instruction, not a rule
  that all MagicBlock cranks are permissionless.

Sources: [enqueue transfer](https://github.com/magicblock-labs/ephemeral-spl-token/blob/c789b93850e206f185ed321140df1b5cb81eed5a/e-token/src/processor/deposit_and_queue_transfer.rs),
[queue tick](https://github.com/magicblock-labs/ephemeral-spl-token/blob/c789b93850e206f185ed321140df1b5cb81eed5a/e-token/src/processor/transfer_queue_tick.rs), and
[authenticated callback](https://github.com/magicblock-labs/ephemeral-spl-token/blob/c789b93850e206f185ed321140df1b5cb81eed5a/e-token/src/processor/execute_transfer_callback.rs).

## Do not generalize product-specific mechanics

- Verify a scheduler's authority, retry, and cancellation behavior from the pinned implementation; do
  not claim every crank is permissionless or exactly-once.
- Supplying `magic_fee_vault` changes commit-fee handling. Validate the canonical writable/delegated
  vault and delegated payer required by the current program. The payer is debited and the validator-
  scoped vault is credited; treat user budgets and spending caps as application/operator policy.
- Keep generic Solana signer, account-owner, PDA, executable-program, token-authority, and arithmetic
  checks in the Solana review. Repeat them here only when a MagicBlock product defines a specific
  identity or cross-runtime relationship.

Sources: [Magic Program fee handling](https://github.com/magicblock-labs/magicblock-validator/blob/efcebacf3b987a194430e4d7250273b7e9937ff0/programs/magicblock/src/schedule_transactions/mod.rs) and
[MagicBlock security audits](https://docs.magicblock.gg/pages/overview/additional-information/security-and-audits).

## Review output

For every finding or recommendation, report:

- the affected runtime: base, public ER, or PER;
- the relevant product and lifecycle state;
- its classification: protocol guarantee, integration validation, application policy, or general
  Solana practice;
- the exact pinned source or documentation page;
- the failure consequence and the test that demonstrates the expected behavior.
