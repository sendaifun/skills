---
name: transaction-landing
description: Reliably land Solana transactions on mainnet: compute-unit budgeting and priority fees, accurate fee estimation (Helius getPriorityFeeEstimate, getRecentPrioritizationFees, QuickNode), fresh-blockhash + lastValidBlockHeight confirmation, manual rebroadcast with maxRetries:0, Jito bundles and tips, the Helius Sender endpoint, and durable nonces. Use when transactions are dropping, getting "blockhash not found"/"transaction expired", or when building bots/apps that must confirm under congestion.
---

# Landing Transactions on Solana

The single hardest operational problem on Solana is not writing a program — it is getting a transaction *confirmed* under load. Transactions silently drop, expire with "blockhash not found", or sit unconfirmed while a competitor's lands first. This skill is the field guide: a deterministic, copy-paste pipeline for budgeting compute, bidding priority fees, sending with the right flags, confirming against blockhash expiry, and escalating to Jito bundles, the Helius Sender, or durable nonces when the base path is not enough.

All TypeScript targets **`@solana/web3.js` 1.98.4** as the portable baseline (still the dominant client). Where the modern stack differs, inline notes point at **`@solana/kit` 7.0.0** + `@solana-program/*` equivalents. Node 20+.

## Overview — why transactions drop

A Solana transaction does not "fail to send" so much as it fails to be *included* by the right validator before it expires. Five mechanics drive every drop:

- **Leader schedule.** At any moment one validator is the *leader* and packs the block. Your RPC must forward your tx to the current/next leader's TPU port in time. If the leader rotates (every 4 slots ≈ 1.6 s) before your tx arrives, it waits for the next slot — or gets dropped from a full queue.
- **Write-lock contention.** Every account a tx writes is locked for the slot. Hot accounts (a popular AMM pool, a mint, a Jito tip account) serialize all writers. Under contention the scheduler picks the **highest priority fee** per locked account; underpriced txns are deferred and eventually dropped. This is why an under-fee'd tx "never lands" even though it is perfectly valid.
- **Priority ordering.** The leader orders pending txns by priority fee (price-per-CU × CU limit). You are bidding in a continuous auction. A static fee that worked yesterday loses during a launch or liquidation cascade.
- **Blockhash / `lastValidBlockHeight` expiry.** A tx carries a `recentBlockhash`. It is only valid until the chain's block height passes `lastValidBlockHeight` — about **150 slots ≈ 60–90 s**. Miss that window and the tx is permanently invalid; resending the same bytes does nothing. A stale blockhash also causes the "Blockhash not found" preflight error.
- **RPC vs validator forwarding.** A public RPC's default behavior (auto-rebroadcast on its own schedule) is opaque and untunable. Staked connections (SWQoS), Jito's block engine, and the Helius Sender forward directly to leaders with better inclusion odds. Relying on a generic RPC's retry loop is the most common reason a bot's txns evaporate under load.

The fix is to take control of every stage: size compute, bid a *live* fee, capture the expiry height, send with `skipPreflight` + `maxRetries: 0`, and rebroadcast yourself until confirmed or expired.

## The landing checklist

Run this ordered pipeline for every mainnet send. Each step links to the deep dive.

1. **Build a minimal tx + ALTs.** Fewer instructions and Address Lookup Tables (v0 `VersionedTransaction`) mean fewer write locks and smaller bytes — both improve scheduling.
2. **Set the compute unit LIMIT from simulation.** `simulateTransaction` → `value.unitsConsumed` → `limit = ceil(consumed × 1.1)`, clamped to 1,400,000. Never ship the 1.4M default — it inflates your fee and hurts scheduling. → `docs/priority-fees.md`
3. **Set the compute unit PRICE from a live estimate.** Pull µLamports/CU from Helius `getPriorityFeeEstimate` (pass the serialized tx), `getRecentPrioritizationFees` on your write-locked accounts, or QuickNode `qn_estimatePriorityFees`. → `docs/priority-fees.md`, `resources/api-reference.md`
4. **Fetch a fresh blockhash and capture `lastValidBlockHeight`.** `getLatestBlockhash("confirmed")` → `{ blockhash, lastValidBlockHeight }`. Hold both; `lastValidBlockHeight` is your hard timeout. → `docs/retries-and-confirmation.md`
5. **Sign.** Serialize the signed bytes once; you will rebroadcast these exact bytes.
6. **Send with `skipPreflight: true` + `maxRetries: 0`.** You own retransmission, not the RPC. (Simulate client-side first since preflight is off.) → `docs/retries-and-confirmation.md`
7. **Rebroadcast loop until confirmed or expired.** Re-send the same signed bytes every ~2 s; poll `getSignatureStatuses` for success; treat `getBlockHeight() > lastValidBlockHeight` as expired → rebuild from step 4. → `docs/retries-and-confirmation.md`, `templates/robust-sender.ts`
8. **Escalate when needed.** Atomic multi-tx or MEV/revert protection → **Jito bundle**. Maximum single-tx inclusion → **Helius Sender** (dual-routes to staked validators + Jito). Offline / long-lived / multisig signing → **durable nonce**. → `docs/jito-bundles.md`, `resources/jito-endpoints.md`

A complete, production-shaped implementation of steps 1–7 lives in `examples/robust-send-and-confirm.ts` and `templates/robust-sender.ts`.

## Compute budget & priority fees

A priority fee is **two separate `ComputeBudgetProgram` instructions** — you need both:

- `setComputeUnitLimit({ units })` caps CU consumption. It is the **multiplier** in the fee formula and frees block space (a smaller declared limit schedules more easily).
- `setComputeUnitPrice({ microLamports })` is the **price per CU** in micro-lamports (1 lamport = 1,000,000 µLamports). This is what actually bids for priority.

**Why both:** the priority fee paid = `price × limit`. Set only the *price* and your limit defaults to 200,000 CU **per non-builtin instruction** (clamped to 1.4M) — you over-pay against an inflated limit. Set only the *limit* and the price is 0 → no priority at all. Setting both lets you pay the minimum that still bids correctly.

```ts
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js"; // 1.98.4

const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 });   // from simulation (§ size)
const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }); // from estimate

// v0 message (preferred — supports Address Lookup Tables). Convention: budget ixs first.
const msg = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [cuLimitIx, cuPriceIx, /* ...your instructions */],
}).compileToV0Message(/* [lookupTableAccount] */);
const vtx = new VersionedTransaction(msg);
```

Placement does not matter for correctness (the runtime parses budget ixs at any index), but put them first by convention.

**The fee math** — priority fee in lamports, added on top of the base **5,000 lamports per signature**:

```
priorityFeeLamports = ceil( microLamportsPerCU * computeUnitLimit / 1_000_000 )
```

Worked example: price 50,000 µLamports/CU × limit 200,000 CU = `50_000 * 200_000 / 1_000_000 = 10_000` lamports priority (0.00001 SOL); total ≈ 5,000 base + 10,000 = 15,000 lamports. **Lowering the CU limit linearly lowers the fee for a given price** — which is exactly why step 2 sizes the limit from simulation instead of shipping 1.4M.

CU facts (verified from Anza agave `execution_budget.rs`): `MAX_COMPUTE_UNIT_LIMIT = 1_400_000` (hard per-tx cap), `DEFAULT_INSTRUCTION_COMPUTE_UNIT_LIMIT = 200_000` (per non-builtin ix when no limit ix is present), heap max 256 KiB. Full kit equivalents (`getSetComputeUnitLimitInstruction` / `getSetComputeUnitPriceInstruction` from `@solana-program/compute-budget` 0.16.0), the simulate-to-size procedure, and all fee math are in **`docs/priority-fees.md`**.

## Estimating the price

The price is the single biggest lever on whether you land. All three sources below return **micro-lamports per CU** — aggregate, then feed into `setComputeUnitPrice`.

| Source | Method | Scope it to | Best for |
|---|---|---|---|
| **Native RPC** | `getRecentPrioritizationFees(lockedWritableAccounts)` | Your **writable** accounts (≤128) over ~150 slots | Zero-dependency baseline; aggregate yourself (e.g. p75) |
| **Helius** | `getPriorityFeeEstimate` | Pass the **serialized tx** (exact write-locks) or `accountKeys` | Most accurate; built-in `priorityLevel` percentiles |
| **QuickNode** | `qn_estimatePriorityFees` | `account` + `last_n_blocks` (≤100) | `per_compute_unit` levels + `recommended` value |

`getRecentPrioritizationFees` returns raw per-slot samples (`{ slot, prioritizationFee }`) and does **no aggregation** — take a high percentile of the values for *your* locked accounts. Helius `getPriorityFeeEstimate` accepts a single options object with a `priorityLevel` enum — exact strings `Min` (p0), `Low` (p25), `Medium` (p50), `High` (p75), `VeryHigh` (p90+), `UnsafeMax` (p100, can drain a wallet — avoid). Returns `result.priorityFeeEstimate` (single number) or `result.priorityFeeLevels` (all levels) when `includeAllPriorityFeeLevels: true`. Passing the full serialized `transaction` is the most accurate because Helius reads your exact write-locked accounts.

```ts
// Native RPC: aggregate to a p75 over your write-locked accounts.
const fees = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: [writableAccountA, writableAccountB], // PublicKey[]
});
const samples = fees.map(f => f.prioritizationFee).filter(x => x > 0).sort((a, b) => a - b);
const microLamports = Math.max(samples[Math.floor(samples.length * 0.75)] ?? 0, 1);
```

```ts
// Helius: pass the serialized tx so the estimate reflects your exact write-locks.
const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: "1", method: "getPriorityFeeEstimate",
    params: [{
      transaction: bs58.encode(vtx.serialize()),       // OR { accountKeys: [...] }
      options: { priorityLevel: "High", transactionEncoding: "Base58" },
    }],
  }),
});
const { result } = await res.json();
const microLamports = Math.ceil(result.priorityFeeEstimate); // µLamports/CU
```

Full request/response shapes for all three providers, the QuickNode `per_compute_unit`/`per_transaction` distinction, `evaluateEmptySlotAsZero`, and aggregation strategy live in **`docs/priority-fees.md`** and **`resources/api-reference.md`**. A runnable end-to-end send is `examples/send-with-priority-fee.ts`.

## Sending & confirming

Two send flags put *you* in control of landing:

- **`skipPreflight: true`** — skip the RPC's preflight simulation. Faster and avoids a stale-blockhash preflight rejection. Trade-off: you lose the early error, so **simulate client-side first** (you did, to size CU).
- **`maxRetries: 0`** — disable the RPC node's automatic rebroadcast so your code controls resubmission timing. Without this the RPC rebroadcasts on an opaque schedule you cannot tune.

The **manual rebroadcast pattern**: send once, then re-send the *same signed bytes* every ~2 s until confirmed or the blockhash expires. Re-sending identical bytes is safe and idempotent — same signature, the network dedups.

```ts
const raw = signedTx.serialize();
await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

while (true) {
  const { value } = await connection.getSignatureStatuses([sig]);
  const s = value[0];
  if (s?.err) throw new Error("tx failed: " + JSON.stringify(s.err));
  if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") break;
  if ((await connection.getBlockHeight()) > lastValidBlockHeight) throw new Error("blockhash expired");
  await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); // rebroadcast
  await new Promise(r => setTimeout(r, 2000));
}
```

**Confirm against blockhash expiry, not a fixed timeout.** Drive *success* by signature status (`getSignatureStatuses` poll, or `signatureSubscribe` push) and *expiry* by block height: once `getBlockHeight() > lastValidBlockHeight`, the tx can never land — stop, rebuild with a fresh blockhash, re-fee, re-sign, resend. The blockhash-aware `connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")` resolves on either outcome and avoids an infinite hang. Commitment: `processed` (fast, rollback-able) → `confirmed` (good default) → `finalized` (irreversible). Full treatment of websocket-vs-poll trade-offs in **`docs/retries-and-confirmation.md`**; the complete loop is `examples/robust-send-and-confirm.ts` and `templates/robust-sender.ts`.

## Jito bundles

A **bundle** is a group of **up to 5 fully-signed transactions** executed **sequentially, atomically, all-or-nothing, within the same slot**. Use one when:

- You need **atomic multi-tx** execution (e.g. swap + repay that must both land or neither).
- You want **MEV / revert protection** — a single tx wrapped as a bundle (`bundleOnly=true`) only commits if it succeeds; reverts are not landed and cost nothing.
- You are competing for ordering in a hot event and a Jito tip auction beats a plain priority fee.

**Every bundle must include a tip** — a SOL transfer (`SystemProgram.transfer`) to **one of the 8 tip accounts**, conventionally in the **last** transaction (work executes before you commit the tip; the tip only lands if the whole bundle lands). Minimum **1,000 lamports**, but real competitive tips come from the tip-floor API:

- **Pick a tip account at random** from `getTipAccounts` per submission — all 8 are write-locked, so always hitting the same one serializes your bundles. Fetch them at runtime (they can rotate).
- **Size the tip from `GET https://bundles.jito.wtf/api/v1/bundles/tip_floor`** — percentile fields are in **SOL** (multiply by 1e9 for lamports). Baseline at `landed_tips_75th_percentile`; scale toward 95th/99th during launches and liquidations.

```ts
// Tip = LAST instruction of the LAST tx in the bundle.
SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: new PublicKey(tipAccount), // random of the 8 from getTipAccounts
  lamports: tipLamports,               // >= 1000; size from tip_floor
});
```

Submit JSON-RPC `sendBundle` to `https://<region>.mainnet.block-engine.jito.wtf/api/v1/bundles` with params `[[<base64 txns>], { "encoding": "base64" }]`; the result is a `bundle_id`. Poll `getInflightBundleStatuses` (live, 5-min window: `Invalid`/`Pending`/`Failed`/`Landed`) every ~1–2 s, then `getBundleStatuses` for final `confirmation_status`. **Always also enforce blockhash expiry** — bundles expire like any tx. Default rate limit is **1 request/second/IP/region**; fanning out to all regions naively trips 429s.

```ts
const ENGINE = "https://ny.mainnet.block-engine.jito.wtf/api/v1"; // pick the region nearest your server
const rpc = (method: string, params: unknown[]) =>
  fetch(`${ENGINE}/bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then(r => r.json());

// workTx + tipTx are fully signed; tip is the LAST tx. Encode base64.
const txs = [workTx, tipTx].map(t => Buffer.from(t.serialize()).toString("base64"));
const { result: bundleId } = await rpc("sendBundle", [txs, { encoding: "base64" }]);

// Poll until Landed/Failed, with lastValidBlockHeight as the hard stop.
for (;;) {
  const { result } = await rpc("getInflightBundleStatuses", [[bundleId]]);
  const status = result.value[0]?.status; // Invalid | Pending | Failed | Landed
  if (status === "Landed") break;
  if (status === "Failed" || status === "Invalid") throw new Error(`bundle ${status}`);
  if ((await connection.getBlockHeight()) > lastValidBlockHeight) throw new Error("bundle expired");
  await new Promise(r => setTimeout(r, 1500));
}
```

> **Devnet note:** there is **no Jito on devnet**. Test bundles on **testnet** (`https://<region>.testnet.block-engine.jito.wtf`) or mainnet.

Regions, the single-tx `sendTransaction` path (`/api/v1/transactions?bundleOnly=true`, which **force-skips preflight**), the `jito-js-rpc` 0.2.2 client, dual-submission caveats, and ShredStream are all in **`docs/jito-bundles.md`** and **`resources/jito-endpoints.md`**. Runnable: `examples/jito-bundle.ts`.

## Decision table — how to submit

| Strategy | Latency | Atomic? | Revert protection | Cost model | Complexity | Use when |
|---|---|---|---|---|---|---|
| **Plain priority fee** (RPC + manual rebroadcast) | Low | No | No | Priority fee only | Low | Default for nearly all single, independent txns |
| **Jito bundle** (`sendBundle`) | Low–med | **Yes** (≤5 tx, same slot) | **Yes** (all-or-nothing) | Jito tip (priority fee irrelevant to inclusion) | Med | Atomic multi-tx; ordering-sensitive MEV plays |
| **Jito `sendTransaction`** (`/transactions`, `bundleOnly=true`) | Low | No (single tx) | **Yes** (tx-as-bundle) | ~70% priority fee / ~30% Jito tip | Med | One tx that must not land on revert; force-skips preflight |
| **Helius Sender** (`/fast`) | **Lowest** | No | Via Jito auction leg | Jito tip **≥0.001 SOL** + priority fee (both required) | Med | Max inclusion for a single tx under congestion |
| **Durable nonce** | N/A (tx never expires) | No | No | Nonce-account rent | Med–high | Offline / long-lived / multisig signing |

Notes: a Jito **bundle** ignores your priority fee for inclusion (only the tip matters); the Jito **single-tx** path wants both (~70/30). The **Helius Sender** dual-routes to staked SWQoS validators *and* the Jito auction in parallel and **requires both** a Jito tip (≥1,000,000 lamports = 0.001 SOL in dual-route mode, or 5,000 lamports = 0.000005 SOL with `?swqos_only=true`) **and** a `setComputeUnitPrice` priority fee, with `skipPreflight: true` and `maxRetries: 0` (you own retries). Endpoint `https://sender.helius-rpc.com/fast` (global, browser-safe), regional `http://<region>-sender.helius-rpc.com/fast`, ~50 TPS/region per Helius docs (verify current quota), 0 API credits.

```ts
// tx must already include: setComputeUnitLimit, setComputeUnitPrice, AND a transfer of
// >=1_000_000 lamports (0.001 SOL) to a Jito tip account — then be signed and base64-serialized.
await fetch("https://sender.helius-rpc.com/fast", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "sendTransaction",
    params: [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
  }),
});
```

Full request/response and the regional host list are in **`resources/api-reference.md`**.

## Durable nonce

A **durable nonce** replaces the recent blockhash with a stored, non-expiring value, so a signed tx **never expires**. Use it for offline signing, cold-wallet/multisig flows, and scheduled/queued txns where minutes or days may pass between signing and submission.

Mechanics: create and fund a rent-exempt **nonce account** (stores the current nonce + an authority); use the **stored nonce value as `recentBlockhash`**; and make the tx's **FIRST instruction `nonceAdvance`** — executing it consumes and rotates the nonce, making the tx valid exactly once (replay-proof). If `nonceAdvance` is not first (or absent), the tx is rejected or replayable.

```ts
const tx = new Transaction();
tx.add(
  SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey: payer.publicKey }), // MUST be first
  /* ...your real instructions... */
);
tx.recentBlockhash = nonceValue; // the durable nonce, NOT getLatestBlockhash
tx.feePayer = payer.publicKey;   // sign now or hand off offline; it will not expire until the nonce advances
```

Account creation (`SystemProgram.createNonceAccount`), reading the current value (`NonceAccount.fromAccountData`), and the kit split (`getCreateAccountInstruction` + `getInitializeNonceAccountInstruction` + `getAdvanceNonceAccountInstruction`, `setTransactionMessageLifetimeUsingDurableNonce`) are in **`docs/retries-and-confirmation.md`**. Runnable: `examples/durable-nonce.ts`.

## Guidelines

- **DO** simulate to size the CU limit (`unitsConsumed × 1.1`, clamp 1.4M). **DON'T** ship the 1.4M default — it inflates your fee and worsens scheduling.
- **DO** set a *live* CU price from `getPriorityFeeEstimate` / `getRecentPrioritizationFees`. **DON'T** set a blind huge price "to be safe" — `UnsafeMax`-style fees can drain the payer, and you still need the right CU limit.
- **DO** set **both** `setComputeUnitLimit` and `setComputeUnitPrice`. **DON'T** set only one (price-only over-pays; limit-only = zero priority).
- **DO** capture `lastValidBlockHeight` and treat it as the hard timeout. **DON'T** loop on a wall-clock timer — confirm against block height.
- **DO** refresh the blockhash and re-sign when it expires. **DON'T** resend the same expired bytes hoping it lands — it never will.
- **DO** send with `skipPreflight: true` + `maxRetries: 0` and rebroadcast yourself. **DON'T** rely on the RPC's auto-retry; it is opaque and untunable.
- **DO** randomize the Jito tip account per submission and fetch the set at runtime. **DON'T** hardcode one tip account — you serialize behind its write lock.
- **DO** put the Jito tip **inside the bundle** (last tx, `SystemProgram.transfer` ≥1,000 lamports, sized from `tip_floor`). **DON'T** send the tip as a separate non-bundled tx — it is not credited and the bundle drops.
- **DO** simulate client-side before any `skipPreflight` send (RPC, Jito `/transactions`, or Sender — all skip preflight). **DON'T** burn fees broadcasting a guaranteed-fail tx.
- **DO** design retries to be idempotent (bundles are all-or-nothing; partial execution never happens). **DON'T** assume a dropped tx definitely did not land — check the signature before resending a *different* tx.

## Common Errors

### Error: "Blockhash not found"
**Cause:** The tx's `recentBlockhash` is stale (already expired, or fetched from a lagging RPC), or preflight ran against a fork that has not seen it. Common when sign-to-send takes too long or the blockhash came from a different/behind node.
**Solution:** Fetch the blockhash with the **same commitment** you send with (`getLatestBlockhash("confirmed")`) immediately before signing; minimize the sign→send gap. During sizing simulation, pass `replaceRecentBlockhash: true` so the RPC swaps in a valid blockhash. If it expired mid-flight, rebuild from a fresh blockhash.

### Error: "Transaction was not confirmed in N seconds" / transaction expired
**Cause:** The chain's block height passed `lastValidBlockHeight` before the tx landed — it was underpriced, dropped before reaching the leader, or the RPC stopped rebroadcasting. The tx is now permanently invalid.
**Solution:** This is an *expiry*, not a failure — confirm it truly did not land (`getSignatureStatuses`), then rebuild with a fresh blockhash, a **higher CU price** from a live estimate, send with `maxRetries: 0`, and rebroadcast every ~2 s until confirmed or the new `lastValidBlockHeight`. Escalate to the Helius Sender or a Jito bundle under heavy congestion. See `docs/retries-and-confirmation.md`.

### Error: "Account in use" / write-lock contention (tx repeatedly deferred)
**Cause:** A hot account your tx writes (popular pool, mint, or always-the-same Jito tip account) is write-locked by higher-priority txns each slot, so yours is continuously deferred.
**Solution:** Raise the CU **price** specifically against those accounts — scope `getRecentPrioritizationFees`/`getPriorityFeeEstimate` to your write-locked accounts so the estimate reflects *their* contention. For Jito, **randomize the tip account**. Reduce the number of writable accounts (use ALTs, split work) where possible.

### Error: transaction never lands despite "success" on send
**Cause:** Under-priced priority fee. `sendRawTransaction` returning a signature only means the RPC accepted it for forwarding — not that a leader included it. With a fee below the live market, it is deferred and expires.
**Solution:** Pull a live estimate (p75/`High` or higher during events), set **both** CU limit and price, and confirm against `lastValidBlockHeight`. Treat a returned signature as "submitted", never "confirmed".

### Error: Jito bundle not landing
**Cause:** One of — tip below the live floor (1,000 lamports is the *minimum*, not a competitive amount); tip placed in a separate non-bundled tx (not credited); tip not in the last tx; bundle simulation failed; stale blockhash; or >5 txns.
**Solution:** Put the tip **inside the bundle's last tx**, sized from `tip_floor` (≥75th percentile during congestion); randomize the tip account; keep ≤5 fully-signed txns with a fresh blockhash; poll `getInflightBundleStatuses` and fall back to a fresh bundle on `Failed`/expiry. See `docs/jito-bundles.md`.

### Error: durable-nonce tx rejected / replayed
**Cause:** `nonceAdvance` is not the **first** instruction (or is missing), or the tx used `getLatestBlockhash` instead of the stored nonce value as `recentBlockhash`.
**Solution:** Prepend `SystemProgram.nonceAdvance(...)` as instruction index 0 and set `recentBlockhash` to the current `NonceAccount.nonce` value. See `docs/retries-and-confirmation.md`.

## Files in This Skill

```
transaction-landing/
├── SKILL.md                          # This file — landing pipeline, decision table, errors
├── docs/
│   ├── priority-fees.md              # ComputeBudget ixs, fee math, simulate-to-size, all 3 fee estimators
│   ├── jito-bundles.md               # Bundles, tips, tip_floor, regions, sendBundle/status, sendTransaction, ShredStream
│   ├── retries-and-confirmation.md   # skipPreflight/maxRetries:0, rebroadcast, blockhash expiry, durable nonce
│   └── troubleshooting.md            # Expanded error catalog with diagnoses and fixes
├── resources/
│   ├── jito-endpoints.md             # Block-engine URLs (all regions), tip accounts, tip-floor/status endpoints, rate limits
│   └── api-reference.md              # Helius Sender + getPriorityFeeEstimate, QuickNode, getRecentPrioritizationFees, ComputeBudget ix ref
├── examples/
│   ├── send-with-priority-fee.ts     # Build → simulate-size CU → live price → send → confirm (web3.js + kit notes)
│   ├── jito-bundle.ts                # Fetch tip accounts, build tip tx, sendBundle, poll status
│   ├── robust-send-and-confirm.ts    # Full manual-rebroadcast + blockhash-expiry loop
│   └── durable-nonce.ts              # Create nonce account, build & sign a non-expiring tx
└── templates/
    └── robust-sender.ts              # Drop-in production sender: size CU, fee, send, rebroadcast, confirm
```

## References

- Solana Docs — Transactions & confirmation: https://solana.com/docs/core/transactions
- Solana Docs — Retrying transactions: https://solana.com/docs/core/transactions/retry
- Solana Docs — `getLatestBlockhash` / `lastValidBlockHeight`: https://solana.com/docs/rpc/http/getlatestblockhash
- Solana Cookbook — Durable nonces / offline transactions: https://solana.com/developers/cookbook/transactions/offline-transactions
- Helius — Priority fees & `getPriorityFeeEstimate`: https://www.helius.dev/docs/sending-transactions/priority-fees
- Helius — Sender (ultra-low-latency submission): https://www.helius.dev/docs/sending-transactions/sender
- Helius Blog — How to best send Solana transactions under congestion: https://www.helius.dev/blog/solana-congestion-how-to-best-send-solana-transactions
- QuickNode — `qn_estimatePriorityFees`: https://www.quicknode.com/docs/solana/qn_estimatePriorityFees
- Jito — Low-Latency Transaction Send (bundles, tips, status, regions): https://docs.jito.wtf/lowlatencytxnsend/
- Jito — Tip-floor API: https://bundles.jito.wtf/api/v1/bundles/tip_floor
- Anza agave — compute budget constants (`execution_budget.rs`): https://github.com/anza-xyz/agave/blob/master/program-runtime/src/execution_budget.rs
