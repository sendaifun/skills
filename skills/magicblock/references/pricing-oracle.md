# Pricing Oracle

Use the MagicBlock Pricing Oracle when an ER application needs low-latency market data close to its
execution state. It currently republishes supported Pyth Lazer and Stork feeds into Solana accounts
that can be consumed on Solana or cloned/delegated for ER-local reads.

## Contents

- [When it fits](#when-it-fits)
- [Trust and freshness model](#trust-and-freshness-model)
- [Integration workflow](#integration-workflow)
- [Consumer safety checklist](#consumer-safety-checklist)
- [Testing and operations](#testing-and-operations)

## When it fits

Use it for price-aware games, prediction markets, trading, collateral checks, dynamic pricing, or any
instruction whose result depends on an external price. Do not use it as a substitute for application
state: the oracle tells the program what a source reported, while the application still defines
position ownership, limits, settlement, and failure policy.

Choose the data path deliberately:

| Need | Placement |
|---|---|
| Occasional settlement or purchase on Solana | Read the feed on base layer |
| Repeated low-latency decisions in one ER | Make the feed available in that ER and read it there |
| Private application state | Keep application state in PER; treat the feed as public input |

An oracle feed and every account mutated by the same transaction must be visible to the same runtime.
Co-locate them before promising an atomic price-dependent operation.

## Trust and freshness model

Successful deserialization is insufficient. Verify:

1. **Address/source identity** — the configured provider, symbol, feed ID, and account address are the
   ones the product expects.
2. **Republisher trust** — use the typed SDK/receiver representation; do not parse hard-coded byte
   offsets. `VerificationLevel::Full` alone is not proof of a republisher update: initialization also
   sets `Full` while writing a zero-value placeholder with `posted_slot = 0`. The authenticated update
   path requires the fixed MagicBlock republisher and writes a nonzero local posting slot. Require the
   canonical provider/feed account, the expected feed ID and exponent, `posted_slot > 0`, a sensible
   value, and a fresh upstream publish time. The account has no separate onchain provenance field that
   identifies which transition wrote the current value. The consumer trusts the program's update
   authorization; it does not independently verify the upstream Pyth Lazer or Stork proof.
3. **Freshness** — compare the upstream publish timestamp with the current clock and reject data older
   than the product's explicit maximum age.
4. **Value domain** — reject non-positive values where they are nonsensical and define how confidence
   or uncertainty affects the product.
5. **Numeric conversion** — account for exponent/decimals and use checked integer arithmetic. Avoid
   floating-point arithmetic in the program.
6. **User protection** — price-based purchases and swaps should accept a user maximum/minimum or
   slippage bound so a valid but changed price cannot create an unwanted trade.

In the current oracle program, `publish_time` represents the upstream oracle timestamp, while the
locally posted slot is tracked separately. Use the publish time for staleness decisions.

## Integration workflow

1. Select provider and symbol from the current supported feed set.
2. Record the provider, symbol, upstream feed ID, expected price-account address, exponent policy, and
   maximum age in application configuration.
3. Decide whether the consuming instruction runs on base, a public ER, or PER.
4. Ensure the feed account is available in the same runtime as every account the instruction needs.
5. Deserialize with the current typed receiver SDK, verify identity and freshness, then apply business
   constraints with checked math.
6. Define the stale/missing-feed behavior before launch: reject, pause, use another verified source, or
   fall back to base-layer settlement. Never silently reuse an unbounded old value.

The current oracle program ID is
`PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd`. Treat addresses and package versions as
version-sensitive: verify them against the current oracle repository and target cluster before use.

## Consumer safety checklist

- Verify the account key or derived feed address, not only the data type.
- Verify the expected feed ID after deserialization.
- Never accept `VerificationLevel::Full` by itself: initialization sets it before a republisher update.
  Require the canonical account/feed/provider, expected feed ID and exponent, `posted_slot > 0`, a
  sensible value, and a fresh upstream publish timestamp. This is evidence consistent with the
  authenticated update path, not an onchain provenance field or independent upstream proof.
- Enforce a product-specific maximum age using the upstream publish timestamp.
- Reject impossible values and define a confidence policy.
- Normalize exponents with checked multiplication/division and explicit rounding.
- Prevent overflow in price × quantity calculations.
- Accept user price/slippage limits for value-changing instructions.
- Avoid storing a price indefinitely in app state without storing and checking its timestamp.
- Keep authorization independent from price validation: a valid price does not authorize a caller.

## Testing and operations

Test at least: correct feed, wrong feed ID, stale feed, zero/negative price, exponent conversion,
overflow boundary, user limit exceeded, missing ER clone, and provider outage. A local fixture proves
consumer logic; Devnet proves the live publisher/account path; production-like validation must also
exercise stale/fallback behavior and the intended ER placement.

Useful examples:

- `magicblock-engine-examples/oracle-priced-purchase/anchor` — minimal base-layer consumer.
- `magicblock-engine-examples/binary-prediction/anchor` — composition with ER, Session Keys, and eSPL.

Sources: [Pricing Oracle repository](https://github.com/magicblock-labs/real-time-pricing-oracle),
[Pricing Oracle docs](https://docs.magicblock.gg/pages/tools/oracle/introduction), and
[engine examples](https://github.com/magicblock-labs/magicblock-engine-examples).
