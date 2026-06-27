---
name: transaction-landing
description: Reliably land Solana transactions — right-size compute units, price priority fees, choose a transaction lifetime, rebroadcast safely, and confirm correctly. Provider-agnostic (works with any RPC) and built for AI agents that sign and send transactions autonomously. Covers ComputeBudgetProgram, getRecentPrioritizationFees, simulateTransaction CU estimation, blockhash expiry, durable nonces, Jito bundles, and the idempotency rules that stop agents from double-spending on retry.
---

# Transaction Landing — Get Solana Transactions Confirmed, Safely

You are an expert Solana engineer making transactions **land reliably** without overpaying or double-executing. This is the single most common production failure on Solana: a transaction is signed, sent, and then silently dropped during congestion — or worse, an agent "retries" by signing a *new* transaction and accidentally executes the action twice.

This skill is **provider-agnostic**: every technique here works against any standard RPC (`@solana/web3.js` or `@solana/kit`). For provider-accelerated sending, route to the [`helius`](../helius/) (Sender, Priority Fee API) or [`quicknode`](../quicknode/) skills — this skill is the universal layer underneath them.

## Overview

Landing a transaction is five decisions, in order. Get each right and a transaction lands on the next slot; get one wrong and it drops, overpays, or double-spends.

1. **Right-size compute** — simulate to get actual CUs, set a tight `setComputeUnitLimit`. Never ship the default 200k.
2. **Price the priority fee** — fetch a real-time estimate, never hardcode. Set `setComputeUnitPrice`.
3. **Choose a lifetime** — recent blockhash (fast, ~60s window) or durable nonce (long-lived, offline, retry-safe).
4. **Submit + rebroadcast** — sign **once**, then resend the **identical bytes** until it lands or the lifetime expires.
5. **Confirm correctly** — poll signature status against `lastValidBlockHeight`; a submitted signature is *not* a landed transaction.

> **The agentic trap (read first):** retrying a dropped transaction means **rebroadcasting the same signed bytes** — same signature, idempotent, safe. It does **not** mean signing a *fresh* transaction for the same action. A fresh transaction has a new signature the chain will execute again. This is the #1 way autonomous agents double-spend. See [Agentic Safety](#agentic-safety) — it is the most important section here.

## The Reliability Ladder

Start at the lowest rung that meets your need; climb only when transactions drop.

| Rung | Mechanism | Use when | Skill / API |
|------|-----------|----------|-------------|
| 0 | `sendRawTransaction` to a public RPC | devnet, low stakes, low congestion | base `@solana/web3.js` |
| 1 | + tight CU limit + real priority fee + rebroadcast loop | **mainnet default — covers ~95% of cases** | this skill |
| 2 | Staked / SWQOS routing (dual-routes to validators + Jito) | time-sensitive trading, mints | [`helius`](../helius/) Sender, [`quicknode`](../quicknode/) |
| 3 | Jito bundles (atomic, MEV-protected) | bundles that must land together / front-run protection | [escalation.md](references/escalation.md) |

**Most agents only need rung 1.** Reach for 2–3 when you see drops under congestion or need atomic/ordered execution.

## Quick Start

```bash
npm install @solana/web3.js   # v1.x — most widely deployed
# or: npm install @solana/kit @solana-program/compute-budget @solana-program/system
```

The complete, runnable reference implementation is in [`examples/send-and-confirm.ts`](examples/send-and-confirm.ts). The shape:

```typescript
import {
  Connection, ComputeBudgetProgram, TransactionMessage,
  VersionedTransaction, Keypair, TransactionInstruction,
} from '@solana/web3.js';

async function landTransaction(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
): Promise<string> {
  // 1. RIGHT-SIZE COMPUTE — simulate with a high cap, read actual usage
  const computeUnits = await estimateComputeUnits(connection, payer, instructions);

  // 2. PRICE THE FEE — real-time estimate, never hardcoded (see references/priority-fees.md)
  const microLamports = await estimatePriorityFee(connection, instructions);

  // 3. CHOOSE A LIFETIME — recent blockhash here; durable nonce for long windows
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  // Build: compute-budget instructions MUST come first
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...instructions,
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);                       // sign ONCE
  const raw = tx.serialize();             // these exact bytes get rebroadcast

  // 4 + 5. SUBMIT, REBROADCAST, CONFIRM (see references/confirmation.md)
  return await sendAndConfirm(connection, raw, lastValidBlockHeight, tx.signatures[0]);
}
```

## The Five Decisions

### 1. Right-size compute units
Every transaction has a CU limit. The default (200k) is almost always wrong: too low and the program runs out of CUs and **fails**; too high and you **overpay** the priority fee (which is `price × limit`) *and* lower your effective priority. Simulate first.

```typescript
const sim = await connection.simulateTransaction(testTx, {
  replaceRecentBlockhash: true,   // don't need a real one to simulate
  sigVerify: false,
});
const used = sim.value.unitsConsumed ?? 200_000;
const computeUnits = Math.min(1_400_000, Math.max(1_000, Math.ceil(used * 1.1)));
```
Full method, including the 1.4M-cap and per-instruction nuances: [references/compute-units.md](references/compute-units.md).

### 2. Price the priority fee
Priority fee (microLamports per CU) buys block-inclusion priority. **Never hardcode it** — network conditions shift by the slot. The provider-agnostic baseline is the `getRecentPrioritizationFees` RPC; provider APIs (Helius, QuickNode) give sharper estimates.

```typescript
const recent = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: writableAccountsYourTxTouches,
});
const fees = recent.map(r => r.prioritizationFee).filter(f => f > 0).sort((a, b) => a - b);
const p75 = fees[Math.floor(fees.length * 0.75)] ?? 10_000;   // 75th percentile
const microLamports = Math.ceil(p75 * 1.2);                    // +20% production buffer
```
Percentile strategy, provider APIs, and fee math: [references/priority-fees.md](references/priority-fees.md).

### 3. Choose a transaction lifetime
- **Recent blockhash** (default): `getLatestBlockhash` → valid ~150 slots (~60–90s). Carries `lastValidBlockHeight`, your expiry signal.
- **Durable nonce**: a nonce account whose `nonceAdvance` is the first instruction. **Never expires** — sign now, land hours later. Essential for offline signing, multisig, and **agents that need a long retry window**. Details: [references/confirmation.md](references/confirmation.md#durable-nonces).

### 4 + 5. Submit, rebroadcast, confirm
This is where transactions are won or lost. The robust loop:

```
sign once → serialize → loop every ~2s {
    resend the SAME bytes (skipPreflight: true, maxRetries: 0)
    poll getSignatureStatuses([sig])
    if confirmed && err == null  → DONE (return signature)
    if "already processed"       → DONE (it landed — this is success, not an error)
    if blockHeight > lastValidBlockHeight → EXPIRED (rebuild from scratch; do NOT reuse the action blindly)
}
```
Why resend the same bytes: an RPC may accept a transaction and still drop it from the mempool under load. Rebroadcasting the **identical signature** is free and idempotent — the network dedupes it. Full implementation with the expiry guard: [references/confirmation.md](references/confirmation.md).

## Agentic Safety

These rules exist because an autonomous agent that "just retries" can double-execute real value transfers. (This skill's author proved exactly this class of bug in a live agentic routing API: an interrupted flow that re-built and re-broadcast a *funding* transaction funded a keeper account **twice**.) Treat them as invariants.

- **One logical action = one signed transaction = one signature.** To retry, rebroadcast the *identical* serialized bytes. Never sign a *new* transaction for the same action while the first could still land.
- **A signature is not a confirmation.** Never declare success — or chain the next action — until `getSignatureStatuses` shows `confirmationStatus` `confirmed`/`finalized` **and** `err == null`.
- **"Already processed" means it landed.** `sendRawTransaction` throwing `This transaction has already been processed` is a **success** signal. An agent that treats it as a failure and re-issues is how double-spends happen.
- **Before re-issuing a value transfer, check on-chain state.** If a transaction *might* have landed (timeout, ambiguous error), confirm via `getSignatureStatuses` or read the destination balance **before** building a replacement. Never replace blindly.
- **Application-layer idempotency keys do not protect the chain.** A new signature is a new transaction. Idempotency must live in the *signature*: rebroadcast the same bytes, or gate on on-chain state.
- **Use a durable nonce when an action needs a long retry window.** It lets you rebroadcast the *same* transaction for minutes/hours instead of rebuilding (and risking a double) after blockhash expiry.

Expanded with code (safe-retry wrapper, ambiguous-error handling): [references/confirmation.md](references/confirmation.md#agentic-safe-retry).

## Best Practices

- **Simulate before every send** — it catches CU sizing, missing signers, and program errors before you spend a lamport on fees.
- **Compute-budget instructions go first** — `setComputeUnitLimit` then `setComputeUnitPrice`, before your application instructions.
- **Add a fee buffer in production** (`×1.2`) — conditions shift between estimate and inclusion.
- **Refresh fees per transaction** for trading; every 10–20s is fine for ordinary apps.
- **Devnet ≠ mainnet** — devnet has near-zero priority fees and light congestion. A flow that "works on devnet" still needs rungs 1–3 on mainnet. Test landing under load before shipping.
- **Confirm with the lower commitment you'll act on** — `confirmed` is usually right for UX; require `finalized` only before irreversible downstream actions.

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Blockhash not found` / `block height exceeded` | Lifetime expired before inclusion | Rebuild with a fresh blockhash; or use a durable nonce |
| Transaction "succeeds" but never appears | Dropped from mempool under congestion | Rebroadcast same bytes + add/raise priority fee (rung 1→2) |
| `exceeded CUs` / program failed mid-run | CU limit too low | Simulate and raise the limit (step 1) |
| Fees far higher than expected | Default 200k CU limit × high price | Right-size the CU limit |
| Agent transferred funds twice | Re-signed a new tx instead of rebroadcasting | Apply [Agentic Safety](#agentic-safety) invariants |

Full catalog: [docs/troubleshooting.md](docs/troubleshooting.md).

## Resources

- [Solana Docs — Retrying Transactions](https://solana.com/docs/core/transactions/retry)
- [Solana Docs — Prioritization Fees](https://solana.com/developers/guides/advanced/how-to-use-priority-fees)
- [Solana Docs — Confirmation & Expiration](https://solana.com/docs/advanced/confirmation)
- [Jito — Bundles & Tips](https://docs.jito.wtf/)
- Constants (Jito tip accounts, tip-floor API, error strings): [resources/constants.md](resources/constants.md)

## Skill Structure

```
transaction-landing/
├── SKILL.md                       # This file — the five decisions + reliability ladder
├── references/
│   ├── compute-units.md           # Simulation-based CU sizing, instruction ordering
│   ├── priority-fees.md           # Fee estimation: getRecentPrioritizationFees + provider APIs
│   ├── confirmation.md            # Rebroadcast loop, expiry guard, durable nonces, safe-retry
│   └── escalation.md              # Rung 2–3: staked routing & Jito bundles
├── examples/
│   ├── send-and-confirm.ts        # Complete runnable reference implementation (web3.js v1)
│   └── jito-bundle.ts             # Land an atomic bundle via a Jito tip
├── resources/
│   └── constants.md               # Jito tip accounts, tip-floor + fee API endpoints, error strings
└── docs/
    └── troubleshooting.md         # Error → cause → fix catalog
```
