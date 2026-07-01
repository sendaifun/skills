# Priority Fees & Compute Budget

Deep dive on the two `ComputeBudgetProgram` instructions, the fee math, sizing the CU
limit from simulation, and the three ways to estimate a live price. This is the long form
of **steps 2–3** of the landing checklist in `../SKILL.md`. Sending and confirming live in
`retries-and-confirmation.md`; Jito tips live in `jito-bundles.md`.

Baseline client: **`@solana/web3.js` 1.98.4**. Kit equivalents use **`@solana/kit` 7.0.0** +
**`@solana-program/compute-budget` 0.16.0**. Node 20+.

---

## 1. The two ComputeBudget instructions

A priority fee is **not a single field** — it is configured by two separate, independent
`ComputeBudgetProgram` instructions. You need **both**:

| Instruction | Param | Role |
|---|---|---|
| `setComputeUnitLimit` | `{ units }` (u32 CU) | Caps how many compute units the tx may consume. The **multiplier** in the fee formula; a smaller declared limit also frees block space and schedules more easily. |
| `setComputeUnitPrice` | `{ microLamports }` (u64) | Price paid **per compute unit**, in micro-lamports (1 lamport = 1,000,000 µLamports). This is what actually **bids** for priority. |

**Why both are mandatory:**

- **Limit only** → the price defaults to `0` → you pay no priority fee and get **no priority** at all.
- **Price only** → the limit defaults to `200,000 CU × (number of non-builtin instructions)`, clamped to 1,400,000 (see §3). You are then billed `price × (inflated default limit)` — you **over-pay**, sometimes by 5–7×, against CU you never used.
- **Both** → you pay exactly `price × (right-sized limit)`: the minimum bid that still reflects your true cost.

### web3.js 1.98.4

```ts
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js"; // 1.98.4

const units = 250_000;        // CU limit — from simulation + headroom (§3)
const microLamports = 50_000; // price per CU — from a live estimate (§4)

const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units });
const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

// v0 message (preferred — supports Address Lookup Tables). Convention: budget ixs first.
const msg = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [cuLimitIx, cuPriceIx, /* ...your instructions */],
}).compileToV0Message(/* [lookupTableAccount] */);
const vtx = new VersionedTransaction(msg);
```

**Placement does not matter for correctness.** The runtime scans the message for ComputeBudget
instructions at any index and applies them before execution. The idiomatic convention is to put
them **first** so they are obvious to readers and tools — but a budget ix at index 3 behaves
identically to one at index 0. There must be **at most one of each kind**; a second
`setComputeUnitLimit` or `setComputeUnitPrice` causes the tx to fail with a duplicate-instruction error.

### kit 7.0.0 equivalent

`@solana-program/compute-budget` 0.16.0 exports one builder per ComputeBudget instruction.
Verified exports: `getSetComputeUnitLimitInstruction`, `getSetComputeUnitPriceInstruction`,
`getRequestHeapFrameInstruction`, `getSetLoadedAccountsDataSizeLimitInstruction`, and the
legacy/deprecated `getRequestUnitsInstruction`.

```ts
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget"; // 0.16.0
import { appendTransactionMessageInstructions, pipe } from "@solana/kit"; // 7.0.0

const txMessage = pipe(
  baseMessage, // from createTransactionMessage / setTransactionMessageFeePayer / ...Lifetime
  (m) =>
    appendTransactionMessageInstructions(
      [
        getSetComputeUnitLimitInstruction({ units: 250_000 }),
        getSetComputeUnitPriceInstruction({ microLamports: 50_000 }),
      ],
      m,
    ),
);
```

Two ComputeBudget instructions you will rarely need but should know exist:

- `requestHeapFrame({ bytes })` / `getRequestHeapFrameInstruction` — raise the BPF heap above the
  32 KiB default, up to the 256 KiB max (`MAX_HEAP_FRAME_BYTES`). Heap requests cost extra CU.
- `setLoadedAccountsDataSizeLimit({ bytes })` / `getSetLoadedAccountsDataSizeLimitInstruction` —
  cap the total bytes of account data the tx may load. Lowering it can marginally improve
  scheduling for txns that touch many accounts; most senders leave it at the default.

---

## 2. CU defaults & caps

Verified from Anza agave `program-runtime/src/execution_budget.rs`:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_COMPUTE_UNIT_LIMIT` | **1,400,000** | Hard max CU per **transaction**, and the largest a single `setComputeUnitLimit` can request. Requests above this are clamped. |
| `DEFAULT_INSTRUCTION_COMPUTE_UNIT_LIMIT` | **200,000** | Default CU budget **per non-builtin instruction** when no `setComputeUnitLimit` ix is present. |
| `MAX_BUILTIN_ALLOCATION_COMPUTE_UNIT_LIMIT` | **3,000** | CU charged per builtin instruction. |
| `MAX_HEAP_FRAME_BYTES` | **262,144** (256 KiB) | Max heap requestable via `requestHeapFrame`. |

**The default limit is the trap.** With **no** `setComputeUnitLimit` instruction, the tx's budget is:

```
defaultLimit = min(1_400_000, 200_000 * numberOfNonBuiltinInstructions)
```

- A 1-instruction tx defaults to **200,000 CU**.
- A 7+-instruction tx defaults to the **1,400,000 CU** ceiling.

If you set a price but no limit, your fee is computed against this default — not against what
you actually consumed. That is why §3 (sizing the limit) is non-optional for cost control.

Two more caps are enforced **validator-side**, not per-tx, so you cannot set them but must design
around them:

- **Block CU cap** — the leader can only pack so much work per block (a per-block CU limit in the tens of millions, raised over time via SIMDs). Treat it as finite, not a fixed number.
- **Per-account write-lock CU cap** — a single writable account can absorb only a fraction of a
  block's CU per slot. This is the mechanism behind hot-account contention: many writers to one
  popular account compete for that account's slice, and the leader takes the highest priority
  fee first. Scope your price estimate to those accounts (§4a, §4b).

---

## 3. Fee math

The **priority fee** (in lamports) is added on top of the base **5,000 lamports per signature**:

```
priorityFeeLamports = ceil( microLamportsPerCU * computeUnitLimit / 1_000_000 )
```

`1_000_000` is the number of micro-lamports per lamport. The result is rounded **up** to whole
lamports. Total tx fee = `5_000 * numberOfSignatures + priorityFeeLamports`.

### Worked examples

**A — price 50,000 µLamports/CU, limit 200,000 CU:**

```
50_000 * 200_000           = 10_000_000_000 µLamports
10_000_000_000 / 1_000_000 = 10_000 lamports        = 0.00001 SOL priority
total (1 sig)              = 5_000 + 10_000 = 15_000 lamports = 0.000015 SOL
```

**B — price 10,000 µLamports/CU, limit 1,400,000 CU (the max):**

```
10_000 * 1_400_000 / 1_000_000 = 14_000 lamports = 0.000014 SOL priority
```

**C — price 877,892 µLamports/CU (a provider "recommended" value), limit 300,000 CU:**

```
ceil(877_892 * 300_000 / 1_000_000) = ceil(263_367.6) = 263_368 lamports ≈ 0.000263 SOL priority
```

**Key takeaway:** for a fixed price, **the priority fee scales linearly with the CU limit**.
Shipping the 1.4M default at example C's price would cost
`ceil(877_892 * 1_400_000 / 1_000_000) = 1_229_049 lamports ≈ 0.00123 SOL` — roughly **4.7× more**
for the same work. Right-sizing the limit (§3 procedure below) is the cheapest reliability win
you have.

---

## 4. Sizing the CU limit via simulation

Set `setComputeUnitLimit` to **actual consumption + ~10% headroom**, never the 1.4M max.

### Procedure

1. Build the tx **with** a `setComputeUnitPrice` ix and a placeholder `setComputeUnitLimit`
   (the 1.4M max is fine as a placeholder) so simulation sees a representative, correctly shaped tx.
2. `simulateTransaction` → read `value.unitsConsumed`.
3. `units = min(1_400_000, ceil(unitsConsumed * 1.1))`.
4. Rebuild the tx with `setComputeUnitLimit({ units })`, then sign and send.

### web3.js 1.98.4

```ts
const sim = await connection.simulateTransaction(vtx, {
  replaceRecentBlockhash: true, // RPC swaps in a fresh blockhash for the sim only
  sigVerify: false,             // skip signature checks — the tx may be unsigned while sizing
});
if (sim.value.err) throw new Error("sim failed: " + JSON.stringify(sim.value.err));

const consumed = sim.value.unitsConsumed ?? 200_000; // fall back to the per-ix default
const units = Math.min(1_400_000, Math.ceil(consumed * 1.1));
// rebuild with ComputeBudgetProgram.setComputeUnitLimit({ units }), then sign & send
```

### The two simulation flags

- **`replaceRecentBlockhash: true`** — the RPC substitutes a currently-valid blockhash into the
  message **for simulation only**. This lets you size CU **before** fetching a blockhash and avoids
  a spurious "Blockhash not found" if your placeholder blockhash is stale.
- **`sigVerify: false`** — skip signature verification, required when the tx is unsigned or only
  partially signed during sizing.
- **Mutually exclusive:** do **not** pass both `sigVerify: true` and `replaceRecentBlockhash: true` —
  replacing the blockhash invalidates the existing signatures, so the RPC rejects the combination.
  While sizing, use `sigVerify: false` + `replaceRecentBlockhash: true`.

### Why re-simulation is not needed

Adding the final `setComputeUnitLimit` instruction changes the transaction **bytes** but does
**not** change CU consumption (a ComputeBudget ix is nearly free and deterministic). So you size
once, then sign — no second simulation. Always keep the ~10% headroom: real consumption drifts
slightly with account state (e.g. an account that becomes initialized, a `Vec` that grows), and a
tx that exceeds its declared limit fails with **"exceeded CUs meter"** mid-execution.

### kit 7.0.0

Kit ships a simulation-based estimator factory,
`estimateComputeUnitLimitFactory({ rpc })`, which returns a function that simulates a transaction
message and yields an estimated CU number; then append `getSetComputeUnitLimitInstruction({ units })`.
(In `@solana/kit` 7.0.0 `estimateComputeUnitLimitFactory` is marked `@deprecated` in favor of the
newer `estimateResourceLimitsFactory({ rpc })`, which sizes the CU limit and other resource limits together.)

---

## 5. Estimating the price

The CU **price** is the single biggest lever on whether you land. There are three sources. **All
three return micro-lamports per CU** (the one exception: QuickNode's `per_transaction` block, which
is total lamports). Pull a value, aggregate if needed, feed it straight into `setComputeUnitPrice`.

### Which estimator to use

| Estimator | Method | Scope it to | Aggregation | Best for |
|---|---|---|---|---|
| **Native RPC** | `getRecentPrioritizationFees` | Your **writable** accounts (≤128), ~150 slots | **You do it** (p75/p90/max) | Zero-dependency baseline on any RPC |
| **Helius** | `getPriorityFeeEstimate` | Serialized `transaction` (exact write-locks) or `accountKeys` | Built-in `priorityLevel` percentiles | Most accurate; one call returns a ready number |
| **QuickNode** | `qn_estimatePriorityFees` | `account` + `last_n_blocks` (≤100) | Built-in levels + `recommended` | QuickNode users; `per_compute_unit` levels |

Rule of thumb: **calm market** → `Medium`/p50 (or native p75). **Active market** (launch,
liquidation cascade, NFT mint) → `High`/p75 to `VeryHigh`/p90 and re-poll every few seconds. Never
hardcode a number that worked yesterday — priority is a continuous auction.

### 5a. Native RPC — `getRecentPrioritizationFees`

Standard Solana JSON-RPC. Input: an optional array of **up to 128** account addresses — pass the
**writable** accounts your tx will lock so the sample reflects contention on *those* accounts.
Returns raw per-slot samples over roughly the last **150 slots**; it does **no aggregation**.

```jsonc
// result: array of
{ "slot": 348125, "prioritizationFee": 1234 } // prioritizationFee is micro-lamports per CU
```

```ts
// web3.js 1.98.4 — config field is `lockedWritableAccounts`
const fees = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: [writableAccountA, writableAccountB], // PublicKey[]
});

// Aggregate yourself. p75 is a sane default; use max for must-land, p90 during congestion.
const samples = fees
  .map((f) => f.prioritizationFee)
  .filter((x) => x > 0)
  .sort((a, b) => a - b);
const p75 = samples[Math.floor(samples.length * 0.75)] ?? 0;
const microLamports = Math.max(p75, 1); // never 0 if you want any priority
```

Aggregation choices: **max** = most aggressive (you outbid everything in the window);
**p90** = strong inclusion during congestion; **p75** = balanced default; **median/p50** =
cost-optimized for calm periods. Filtering out `0` samples avoids a window full of empty/low slots
dragging your estimate to nothing.

### 5b. Helius — `getPriorityFeeEstimate`

JSON-RPC method `getPriorityFeeEstimate`, sent to your Helius RPC URL
(`https://mainnet.helius-rpc.com/?api-key=...`). Pass a **single options object** in `params`.
Provide **either** `transaction` (preferred — Helius reads your exact write-locks) **or**
`accountKeys`.

```jsonc
{
  "jsonrpc": "2.0", "id": "1", "method": "getPriorityFeeEstimate",
  "params": [{
    // EITHER a fully-built serialized tx (preferred):
    "transaction": "<base58-or-base64 serialized tx>",
    // OR just the accounts:
    "accountKeys": ["JUP6Lk...", "..."],
    "options": {
      "transactionEncoding": "Base64",       // "Base58" (default) | "Base64"
      "priorityLevel": "High",                // Min | Low | Medium | High | VeryHigh | UnsafeMax
      "includeAllPriorityFeeLevels": false,   // true -> return every level in one object
      "lookbackSlots": 150,                   // 1..150
      "includeVote": true,                    // include vote txns in the sample
      "recommended": false,                   // true -> a single congestion-adjusted value (~Medium/p50)
      "evaluateEmptySlotAsZero": false        // count empty slots as 0-fee (lowers estimate in calm periods)
    }
  }]
}
```

**`priorityLevel` enum (exact strings → percentile):**

| Level | Percentile |
|---|---|
| `Min` | p0 |
| `Low` | p25 |
| `Medium` | p50 |
| `High` | p75 |
| `VeryHigh` | p90+ (≈p95) |
| `UnsafeMax` | p100 — **dangerous, can drain the payer; avoid** |

**Response shapes:**

```jsonc
// With priorityLevel or recommended -> single number (µLamports/CU):
{ "result": { "priorityFeeEstimate": 1200.0 } }

// With includeAllPriorityFeeLevels: true -> every level at once:
{ "result": { "priorityFeeLevels": {
  "min": 0, "low": 2, "medium": 10071, "high": 100000, "veryHigh": 1000000, "unsafeMax": 50000000
} } }
```

```ts
import bs58 from "bs58";

const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: "1", method: "getPriorityFeeEstimate",
    params: [{
      transaction: bs58.encode(vtx.serialize()),  // OR { accountKeys: [...] }
      options: { priorityLevel: "High", transactionEncoding: "Base58" },
    }],
  }),
});
const { result } = await res.json();
const microLamports = Math.ceil(result.priorityFeeEstimate); // µLamports/CU
```

Notes: `recommended: true` returns a single value at roughly Medium/p50. Passing the full
serialized `transaction` is the most accurate input because Helius computes the estimate from your
exact write-locked accounts rather than a generic sample. `evaluateEmptySlotAsZero: true` treats
empty slots as zero-fee, which **lowers** the estimate during calm periods (use it to save fees
when you are not in a hurry).

### 5c. QuickNode — `qn_estimatePriorityFees`

JSON-RPC method `qn_estimatePriorityFees` (QuickNode's Solana Priority Fee add-on). Params:

- `last_n_blocks` (optional, default & **max 100**) — blocks to analyze.
- `account` (optional) — program/account to scope the estimate to (its contention).
- `api_version` (optional) — set to `2` for more accurately weighted data.

```jsonc
{ "result": {
  "context": { "slot": 335501774 },
  "per_compute_unit": {                       // micro-lamports per CU  <-- use these
    "extreme": 1432990, "high": 615532, "medium": 89430, "low": 36050,
    "percentiles": { /* 5% buckets */ }
  },
  "per_transaction": {                        // total lamports (NOT µL/CU)
    "extreme": 309996858926, "high": 78616978104, "medium": 19888064000, "low": 4999945143,
    "percentiles": {}
  },
  "recommended": 877892                        // congestion-adjusted suggestion, µL/CU
}}
```

Level → percentile mapping: `low`/`medium`/`high`/`extreme` ≈ **25th / 50th / 75th / 90th**.
Use `per_compute_unit.<level>` or `recommended` as your `microLamports`. **Do not** feed
`per_transaction` into `setComputeUnitPrice` — those are total-lamport figures, not per-CU.

### 5d. Triton One & other providers

Triton One and most other RPC providers also expose the native
`getRecentPrioritizationFees` and may offer custom percentile add-ons. Treat **every** provider
estimate as **micro-lamports per CU** unless a field is explicitly labeled `per_transaction`
(total lamports).

---

## Guidelines

- **DO** set both `setComputeUnitLimit` and `setComputeUnitPrice`. **DON'T** ship one without the other (limit-only = zero priority; price-only over-pays against the default limit).
- **DO** size the limit from `simulateTransaction` → `unitsConsumed × 1.1`, clamped to 1.4M. **DON'T** ship the 1.4M default — it multiplies your fee and worsens scheduling.
- **DO** pull a **live** price from an estimator and scope it to your write-locked accounts. **DON'T** hardcode a price; the auction moves every slot.
- **DO** keep ~10% CU headroom — consumption drifts with account state. **DON'T** set the limit to exactly `unitsConsumed`; a small overshoot fails with "exceeded CUs meter".
- **DO** simulate with `replaceRecentBlockhash: true` + `sigVerify: false` while sizing. **DON'T** combine `sigVerify: true` with `replaceRecentBlockhash: true` — the RPC rejects it.
- **DO** avoid `UnsafeMax`/p100 prices. **DON'T** bid "a huge number to be safe" — `UnsafeMax` can drain the payer, and you still need a right-sized limit.

---

## Common Errors

### Error: "exceeded CUs meter" / transaction failed mid-execution
**Cause:** Real CU consumption exceeded the declared `setComputeUnitLimit`. Either you sized with
no headroom, or account state changed between sizing and sending (an account got initialized, a
collection grew), pushing consumption above the limit.
**Solution:** Re-simulate close to send time and keep the `× 1.1` headroom; clamp to 1,400,000.
If a single instruction legitimately needs more than 1.4M CU, split the work across instructions
or transactions — 1.4M is a hard per-tx ceiling.

### Error: `unitsConsumed` is `null` after `simulateTransaction`
**Cause:** The simulation itself failed (returned `value.err`), so the runtime never reported
consumption — commonly a stale blockhash, an unsigned tx without `sigVerify: false`, or a genuine
program error.
**Solution:** Check `sim.value.err` first and surface it. Pass
`{ replaceRecentBlockhash: true, sigVerify: false }` while sizing. Only fall back to a default
(e.g. 200,000) when the error is benign; never paper over a real program error with a default limit.

### Error: priority fee far higher than expected
**Cause:** A price was set without a `setComputeUnitLimit`, so the fee was billed against the
default limit (`200,000 × non-builtin ix count`, up to 1.4M) instead of actual consumption.
**Solution:** Always pair the price with a simulation-sized limit (§3, §4). Verify with the fee math
(§3): `ceil(price × limit / 1_000_000)`.

### Error: estimate is `0` / tx gets no priority despite calling an estimator
**Cause:** A calm-market sample window (or `evaluateEmptySlotAsZero: true`, or unfiltered `0`
samples in `getRecentPrioritizationFees`) yielded a zero price.
**Solution:** Floor the price at `1` µLamport/CU (`Math.max(estimate, 1)`); filter `0` samples
before taking a percentile; raise the `priorityLevel` to `High`/`VeryHigh` during contention.

A broader catalog (drops, expiry, contention, Jito) is in `troubleshooting.md`.

---

## References

- Solana Docs — Transaction fees & prioritization: https://solana.com/docs/core/fees
- Solana Docs — `getRecentPrioritizationFees` (RPC): https://solana.com/docs/rpc/http/getrecentprioritizationfees
- Helius — Priority fees & `getPriorityFeeEstimate`: https://www.helius.dev/docs/sending-transactions/priority-fees
- Helius API Reference — `getPriorityFeeEstimate` (params, options, enum, response): https://helius.mintlify.app/api-reference/priority-fee/getpriorityfeeestimate
- QuickNode — `qn_estimatePriorityFees`: https://www.quicknode.com/docs/solana/qn_estimatePriorityFees
- QuickNode — How to use priority fees / optimize transactions: https://www.quicknode.com/guides/solana-development/transactions/how-to-use-priority-fees
- Anza agave — compute budget constants (`execution_budget.rs`): https://github.com/anza-xyz/agave/blob/master/program-runtime/src/execution_budget.rs
- `@solana-program/compute-budget` (kit builders): https://www.npmjs.com/package/@solana-program/compute-budget
