# Priority Fees — Estimation Strategy

Priority fee is **microLamports per compute unit**, set with `ComputeBudgetProgram.setComputeUnitPrice`. It buys block-inclusion priority during congestion. The cardinal rule: **never hardcode it.** A fee that lands a transaction at 2am can be 50× too low during a mint. Estimate in real time, every send for trading.

## Baseline (provider-agnostic): `getRecentPrioritizationFees`

Available on any standard RPC — no API key, no provider lock-in. Returns the prioritization fee paid per slot over the recent window (up to 150 slots).

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

async function estimatePriorityFee(
  connection: Connection,
  writableAccounts: PublicKey[],  // the WRITABLE accounts your tx touches
  percentile = 0.75,              // 0.5 normal, 0.75 swaps/trades, 0.9 competitive
): Promise<number> {
  const recent = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: writableAccounts,
  });

  const fees = recent
    .map(r => r.prioritizationFee)
    .filter(f => f > 0)             // drop zero-fee slots; they skew the floor down
    .sort((a, b) => a - b);

  if (fees.length === 0) return 10_000;          // sane floor when the window is quiet
  const pick = fees[Math.min(fees.length - 1, Math.floor(fees.length * percentile))];
  return Math.ceil(pick * 1.2);                  // +20% production buffer
}
```

### Why pass `lockedWritableAccounts`
Congestion is **per-account**, not global. A transaction writing to a hot AMM pool competes with everyone else writing that pool — a global average underprices you. Pass the program/state accounts your instructions write to (the pool, your token accounts, the market) so the estimate reflects *your* contention. Passing nothing gives a network-wide average that is usually too low for hot paths.

### Percentile guidance

| Situation | Percentile | Rationale |
|-----------|-----------|-----------|
| Ordinary transfer, non-urgent | 0.50 | Median lands within a few slots |
| DEX swap, NFT purchase | 0.75 | Time-sensitive; next-slot likely |
| Arbitrage, liquidation, competitive mint | 0.90+ | Must win the slot |

Always add a buffer (`×1.2` shown) on top — the window is historical and conditions move forward.

## Sharper: provider fee APIs

Dedicated APIs analyze program-specific demand and return calibrated levels. Prefer them when available — route to the relevant skill rather than reimplementing:

- **Helius `getPriorityFeeEstimate`** — pass `accountKeys` or the serialized `transaction`; returns `priorityFeeEstimate` plus `min/low/medium/high/veryHigh/unsafeMax` levels. See the [`helius`](../../helius/) skill (`references/priority-fees.md`).
- **QuickNode `qn_estimatePriorityFees`** — per-program estimates with percentile breakdowns. See the [`quicknode`](../../quicknode/) skill.
- **Triton** and other stake-weighted providers expose similar endpoints.

These wrap the same underlying signal as `getRecentPrioritizationFees` with better filtering and freshness. Use the baseline when you want zero dependencies or are on a generic RPC; use a provider API when you're already on that provider.

## Fee math (so you can reason about cost)

```
priorityFeeLamports = ceil( microLamports × computeUnitLimit / 1_000_000 )
totalFeeLamports     = 5_000 (base, per signature) + priorityFeeLamports
```

Worked example — 50,000 CU at 75,000 microLamports/CU:
```
priority = 75_000 × 50_000 / 1_000_000 = 3_750 lamports
total    = 5_000 + 3_750 = 8_750 lamports ≈ 0.00000875 SOL
```

This is why [right-sizing the CU limit](compute-units.md) matters as much as the price: the fee is the product of the two. Halving an oversized limit halves the priority fee at the same price.

## Refresh frequency

| Workload | Refresh |
|----------|---------|
| Ordinary app | every 10–20 seconds |
| Trading / swaps | per transaction |
| HFT / MEV | every slot |

## Common mistakes

- **Hardcoding the fee** — guarantees you over- or under-pay; under-paying drops the transaction.
- **Estimating without `lockedWritableAccounts`** — underprices hot-account contention.
- **Pricing high but leaving the default CU limit** — you pay the high price across 200k CUs you don't use.
- **No buffer** — the estimate is historical; congestion can rise between estimate and submission.
- **Defaulting to `unsafeMax`/0.9+** — can cost 10–100× normal; reserve for genuinely competitive slots.
