# ComputeBudget Program Reference

The ComputeBudget program lets a transaction declare how many compute units (CUs) it may use and how much it will pay per CU (the priority fee). It is a native program with no accounts of its own — its instructions only carry data.

## Program ID

```
ComputeBudget111111111111111111111111111111
```

Available in `@solana/web3.js` as `ComputeBudgetProgram.programId`.

## Defaults & limits

| Quantity | Value | Notes |
|----------|-------|-------|
| Default CU limit per instruction | 200,000 | Applied when no `setComputeUnitLimit` is present |
| Maximum CU limit per transaction | 1,400,000 | Hard cap; requests above this are clamped/rejected |
| Default CU price | 0 microLamports/CU | No priority fee unless you set one |
| Base (signature) fee | 5,000 lamports per signature | Separate from the priority fee |
| Max transaction size | 1,232 bytes | Use ALTs + v0 txs to stay under it |

When a transaction has no `setComputeUnitLimit` instruction, its budget is `200,000 × (number of instructions)`, capped at 1,400,000.

## Instructions

`@solana/web3.js` exposes these via static factory methods on `ComputeBudgetProgram`. Each returns a `TransactionInstruction`.

| Method | Params | Purpose |
|--------|--------|---------|
| `setComputeUnitLimit({ units })` | `units: number` | Cap CUs the transaction may consume |
| `setComputeUnitPrice({ microLamports })` | `microLamports: number \| bigint` | Price per CU = the priority fee |
| `requestHeapFrame({ bytes })` | `bytes: number` | Request a larger heap (multiples of 1 KiB, up to 256 KiB) |

```typescript
import { ComputeBudgetProgram } from '@solana/web3.js';

const limitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 });
const priceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 });
const heapIx  = ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 });
```

> `requestUnits` is **deprecated** — use `setComputeUnitLimit` + `setComputeUnitPrice` instead.

### Ordering

Place the ComputeBudget instructions **first** in the instruction list. The runtime reads them regardless of exact position, but convention (and clarity) is limit first, then price, then program instructions:

```typescript
const instructions = [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ...yourInstructions,
];
```

### At most one of each — duplicates FAIL

There must be **at most one** `setComputeUnitLimit` and **at most one** `setComputeUnitPrice` per transaction. A duplicate is **not** "last one wins" — the runtime rejects the whole transaction with a `DuplicateInstruction` error. This bites when a helper prepends its own compute-budget instructions to a list that already contains some (e.g. instructions returned by a swap/router SDK).

**Normalize before prepending:** strip only the caller-supplied `setComputeUnitLimit` / `setComputeUnitPrice` instructions, then add your own sized-by-simulation pair. Match them by program id **and** the first-byte discriminator of the instruction data — strip `0` (deprecated RequestUnits, runtime-rejected), `2` = SetComputeUnitLimit, and `3` = SetComputeUnitPrice — so you **preserve** `requestHeapFrame` (discriminator `1`), a distinct instruction you never duplicate:

```typescript
const computeBudgetId = ComputeBudgetProgram.programId;
const userInstructions = instructions.filter((ix) => {
  if (!ix.programId.equals(computeBudgetId)) return true;
  // Keep any non-limit/price ComputeBudget ix (e.g. requestHeapFrame).
  const discriminator = ix.data[0];
  return discriminator !== 0 && discriminator !== 2 && discriminator !== 3;
});

const finalInstructions = [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ...userInstructions,
];
```

(Alternatively, throw if a caller passes a limit/price instruction, forcing them to hand you a clean list.) The `templates/send-with-priority-fee.ts` helper applies exactly this discriminator-based filter in its `normalizeInstructions`.

## Fee math

A Solana transaction fee has two parts:

```
total fee = base fee + priority fee
```

- **Base fee** = `5,000 lamports × number of signatures`.
- **Priority fee** ≈ `(CU limit × CU price) / 1_000_000` lamports.

The CU price is expressed in **microLamports per CU** (1 microLamport = 1e-6 lamports), which is why the product is divided by 1,000,000.

### Worked example

CU limit = 50,000, CU price = 25,000 microLamports/CU:

```
total cost  = 50,000 × 25,000 = 1,250,000,000 microLamports
priority fee = 1,250,000,000 / 1,000,000 = 1,250 lamports
             = 0.00000125 SOL
```

(The `/ 1,000,000` converts microLamports to lamports — 1 lamport = 1e6 microLamports.)

With one signature, total fee = 5,000 + 1,250 = 6,250 lamports.

### Why sizing matters

The same CU price over a needlessly large limit costs far more:

| CU limit | CU price (µL/CU) | Priority fee (lamports) |
|----------|------------------|--------------------------|
| 200,000 (default) | 25,000 | 5,000 |
| 50,000 (simulated) | 25,000 | 1,250 |

Tightening the limit from the 200,000 default to the simulated 50,000 cuts the priority fee 4× and *raises* effective priority (validators favor transactions whose requested CUs are close to actual usage). Always size the limit from a simulation.

## How priority fees affect landing

- Validators order transactions partly by **fee per CU** — a higher CU price improves your position in the queue.
- A `0` CU price means no priority at all; under congestion such transactions are dropped first.
- During calm periods a small price (a few thousand microLamports) is plenty; during congestion (mints, popular launches) you may need tens or hundreds of thousands. Estimate from `getRecentPrioritizationFees` or Helius `getPriorityFeeEstimate` rather than guessing.
