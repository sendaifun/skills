---
name: priority-fees-and-transaction-building
description: Build reliable Solana transactions with @solana/web3.js — set a compute budget and priority fees, estimate compute units by simulation, compile versioned transactions with address lookup tables, and send/confirm/retry safely. Use when an agent needs transactions to land predictably without overpaying or hanging on expired blockhashes.
---

# Priority Fees & Transaction Building Guide

A practical guide to building Solana transactions that land reliably with `@solana/web3.js` (v1.x). Covers compute budgets, priority fees, compute-unit estimation via simulation, versioned (v0) transactions, address lookup tables, and robust send/confirm/retry.

## Overview

This skill provides:
- **Compute budget control** — set the per-transaction compute-unit (CU) limit and the priority fee (CU price) with the ComputeBudget program.
- **CU estimation by simulation** — measure real CU usage instead of paying for the 200,000 default.
- **Priority fee estimation** — read live network fees via `getRecentPrioritizationFees`, or use Helius `getPriorityFeeEstimate`.
- **Versioned transactions** — compile v0 messages with `TransactionMessage` + `VersionedTransaction`.
- **Address Lookup Tables (ALTs)** — compress account references to fit large transactions under the size limit.
- **Reliable send/confirm/retry** — confirm against `lastValidBlockHeight` and stop cleanly when a blockhash expires.

## Program IDs

| Program | Address |
|---------|---------|
| ComputeBudget | `ComputeBudget111111111111111111111111111111` |
| Address Lookup Table | `AddressLookupTab1e1111111111111111111111111` |
| System | `11111111111111111111111111111111` |

`ComputeBudgetProgram.programId` and `AddressLookupTableProgram.programId` expose these constants directly.

## Quick Start

### Installation

```bash
npm install @solana/web3.js
```

### Basic Setup

```typescript
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const payer = Keypair.generate(); // demo only — load a funded wallet in production

// Fund the throwaway payer on devnet so the send below actually lands.
// (Airdrops don't work on mainnet — load a funded wallet there. The examples'
// `loadOrAirdropPayer` helper in examples/_shared/util.ts does this for you.)
const airdropSig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
// Poll the airdrop's signature status. Don't confirm against a freshly-fetched
// blockhash — that isn't the airdrop tx's blockhash and races the wrong expiry.
const airdropDeadline = Date.now() + 30_000;
while (Date.now() < airdropDeadline) {
  const { confirmationStatus } = (await connection.getSignatureStatuses([airdropSig])).value[0] ?? {};
  if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') break;
  await new Promise((r) => setTimeout(r, 1_000));
}
if ((await connection.getBalance(payer.publicKey)) < LAMPORTS_PER_SOL) {
  throw new Error('Devnet airdrop failed (rate-limited) — retry or use a funded wallet');
}

// The instruction we want to run.
const transferIx = SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: Keypair.generate().publicKey,
  lamports: 1_000_000,
});

// Compute-budget instructions go FIRST: limit, then price.
const instructions = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  transferIx,
];

const { blockhash } = await connection.getLatestBlockhash();
const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message();

const tx = new VersionedTransaction(message);
tx.sign([payer]);

const signature = await connection.sendRawTransaction(tx.serialize());
console.log('Sent:', signature);
```

## Core Features

### Compute budget & CU limit

Every transaction has a compute-unit budget. The default is 200,000 CUs per instruction, capped at 1,400,000 CUs per transaction. Two ComputeBudget instructions control budget and fee:

```typescript
import { ComputeBudgetProgram } from '@solana/web3.js';

// Cap how many compute units the transaction may consume.
const limitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });

// Set the price per compute unit (this is the priority fee).
const priceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 });
```

The **priority fee paid** is approximately:

```
priority fee (lamports) ≈ (CU limit × microLamports) / 1_000_000
```

Always place `setComputeUnitLimit` and `setComputeUnitPrice` **first** in the instruction list. A tighter CU limit lowers cost for the same CU price and raises effective priority, so do not leave the 200,000 default — simulate to size it.

### Estimating CUs via simulation

Simulate the transaction **with a temporary maximum CU limit** prepended, read `unitsConsumed`, then set the real limit to that value × 1.1 for headroom, clamped to the 1,400,000 ceiling.

Why the temporary max limit? If you simulate with no `setComputeUnitLimit` at all, the runtime budgets the simulation at the 200,000-per-instruction default. A genuinely heavy transaction then hits that cap mid-simulation and reports a **truncated** `unitsConsumed` (or fails) — so your estimate comes out too low and the real send dies with "exceeded CUs". Prepending the 1,400,000 max for the *simulation only* lets the transaction report its true consumption:

```typescript
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const MAX_CU_LIMIT = 1_400_000; // hard per-transaction ceiling

async function estimateComputeUnits(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();

  // Prepend a temporary MAX limit so a complex tx reports TRUE unitsConsumed
  // instead of being truncated at the 200k default.
  const simInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU_LIMIT }),
    ...instructions,
  ];

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: simInstructions,
  }).compileToV0Message();

  const sim = await connection.simulateTransaction(new VersionedTransaction(message), {
    replaceRecentBlockhash: true, // RPC supplies a valid blockhash
    sigVerify: false,             // unsigned simulation
  });

  if (sim.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }
  const consumed = sim.value.unitsConsumed ?? 200_000;
  const withHeadroom = Math.max(1_000, Math.ceil(consumed * 1.1)); // 10% headroom + floor

  // Clamp to the ceiling. If we're brushing it, the work can't fit in one tx.
  if (withHeadroom > MAX_CU_LIMIT) {
    throw new Error(
      `Estimated compute units (${withHeadroom}) exceed the ${MAX_CU_LIMIT} ` +
        'per-transaction maximum — split it across multiple transactions.',
    );
  }
  return withHeadroom;
}
```

Then prepend `setComputeUnitLimit({ units })` with the returned value as the first instruction of the **real** transaction (the simulation's max-limit instruction is discarded). Note that there must be **at most one** `setComputeUnitLimit` per transaction — see the normalizer below.

### Normalize ComputeBudget instructions (duplicates fail)

A transaction may carry **at most one** `setComputeUnitLimit` and **at most one** `setComputeUnitPrice`. A duplicate is **not** "last one wins" — the runtime rejects the whole transaction with a `DuplicateInstruction` error. This bites whenever you prepend your own compute-budget instructions to a list that already contains some (e.g. instructions from a swap/router SDK).

Strip only the caller-supplied `setComputeUnitLimit` / `setComputeUnitPrice` instructions before adding your own — and **preserve** `requestHeapFrame`, which is a distinct instruction you never duplicate. Identify the kind by the **first byte** of the instruction data (the u8 discriminator): `1` = RequestHeapFrame, `2` = SetComputeUnitLimit, `3` = SetComputeUnitPrice (`0` = deprecated RequestUnits, which the runtime rejects). Strip `0`, `2`, and `3` (preserve `1`):

```typescript
const computeBudgetId = ComputeBudgetProgram.programId;
const userInstructions = instructions.filter((ix) => {
  if (!ix.programId.equals(computeBudgetId)) return true;
  // Keep any non-limit/price ComputeBudget ix (e.g. requestHeapFrame).
  const discriminator = ix.data[0];
  return discriminator !== 0 && discriminator !== 2 && discriminator !== 3;
});

const finalInstructions = [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),  // sized by simulation
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ...userInstructions,
];
```

(Or throw if a caller passes a limit/price instruction, forcing a clean list.) `templates/send-with-priority-fee.ts` applies this filter automatically.

### Priority fee estimation

Read what recently landed for the writable accounts your transaction touches. **Include the fee payer** — it is always writable (its lamports are debited), and the fee market is per-writable-account, so leaving it out underestimates the contention you actually face:

```typescript
const fees = await connection.getRecentPrioritizationFees({
  // fee payer + every unique writable account the instructions touch
  lockedWritableAccounts: [payer.publicKey, recipient],
});

// fees: { slot: number; prioritizationFee: number }[]  (microLamports per CU)
const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
const microLamports = Math.max(1, sorted[Math.floor(sorted.length * 0.75)] ?? 0);
```

Use a high percentile (75th–90th) so the transaction is competitive without chasing outliers. Never use a `0` price — it gives the transaction no priority.

> **Devnet vs mainnet:** devnet prioritization fees are noisy and frequently `0`, and are **not** predictive of mainnet. Use devnet to validate the *mechanics*; set a real fee policy from a provider estimate (Helius `getPriorityFeeEstimate`) or live mainnet data.

**Helius option:** for a managed estimate, the `getPriorityFeeEstimate` RPC returns a fee tuned to a `priorityLevel` (`Min`/`Low`/`Medium`/`High`/`VeryHigh`/`UnsafeMax`):

```typescript
const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getPriorityFeeEstimate',
    params: [{ accountKeys: ['<your-program-id>'], options: { priorityLevel: 'High' } }],
  }),
});
const { result } = await res.json();
const microLamports = Math.ceil(result.priorityFeeEstimate); // microLamports per CU
```

### Versioned transactions

Versioned (v0) transactions support Address Lookup Tables and are the modern default. Build a `TransactionMessage`, compile it, wrap it, and sign:

```typescript
import {
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const { blockhash } = await connection.getLatestBlockhash();

const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions, // limit + price + your instructions
}).compileToV0Message(/* optional: [lookupTableAccount] */);

const tx = new VersionedTransaction(message);
tx.sign([payer]); // pass ALL required signers

const raw = tx.serialize(); // Uint8Array ready for sendRawTransaction
```

### Address Lookup Tables

ALTs let a v0 transaction reference accounts by index, shrinking wire size so large transactions fit under the ~1,232-byte limit. Create, extend, fetch, then pass into `compileToV0Message`:

```typescript
import { AddressLookupTableProgram } from '@solana/web3.js';

// 1. Create (derives from a recent slot; returns the ix + the ALT address).
const recentSlot = await connection.getSlot('finalized');
const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
  authority: payer.publicKey,
  payer: payer.publicKey,
  recentSlot,
});

// 2. Extend with the addresses to compress.
const extendIx = AddressLookupTableProgram.extendLookupTable({
  lookupTable: lookupTableAddress,
  authority: payer.publicKey,
  payer: payer.publicKey,
  addresses: [/* PublicKey, ... */],
});

// (send createIx, then extendIx, then poll for warm-up — see below)

// 3. Warm up DETERMINISTICALLY, then fetch and use. A freshly extended ALT is
// usable only one slot AFTER the extend confirms. Poll the slot rather than
// sleeping a fixed interval (a fixed sleep can fire too early under load):
const extendedAtSlot = await connection.getSlot('confirmed');
let lookupTableAccount: AddressLookupTableAccount | null = null;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  if ((await connection.getSlot('confirmed')) > extendedAtSlot) {
    const { value } = await connection.getAddressLookupTable(lookupTableAddress);
    if (value && value.state.addresses.length >= addresses.length) {
      lookupTableAccount = value;
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!lookupTableAccount) throw new Error('ALT did not warm up within 30s — retry');

const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message([lookupTableAccount]);
```

**ALT lifecycle caveats:**

- **Warm-up:** an ALT is usable only **one slot after** the extend confirms — poll (as above) before referencing it; don't create/extend and use in the same transaction.
- **~30 addresses per extend:** a single `extendLookupTable` instruction must fit the 1,232-byte tx limit (~30 addresses). Add more across multiple extend transactions.
- **Rent reclaim:** an ALT holds rent. To get it back, `deactivate` the table, wait the ~513-slot cooldown, then `close` it (`AddressLookupTableProgram.deactivate` / `.close`). Only the authority can do this.
- **Authority:** the `authority` controls extend/freeze/deactivate — guard it like a signing key.
- **When NOT to bother:** ALTs only pay off when a transaction references enough accounts to bust the ~1,232-byte limit. For small transactions the create+extend cost and one-slot warm-up outweigh the savings — just use a plain v0 transaction.

### Reliable send/confirm/retry

A blockhash is valid only until the chain passes `lastValidBlockHeight`. Poll signature status and stop once the blockhash expires, rebroadcasting in between so the transaction keeps getting gossiped:

```typescript
async function sendAndConfirm(
  connection: Connection,
  tx: VersionedTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: true, // already simulated
    maxRetries: 0,       // we own the rebroadcast loop
  });

  while (true) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status?.err) throw new Error(`Failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return signature;
    }

    if ((await connection.getBlockHeight()) > lastValidBlockHeight) {
      throw new Error('Blockhash expired before confirmation');
    }

    // Rebroadcast to keep the tx gossiped. A resend can throw transient errors
    // ("already processed", blockhash complaints) once the tx is in flight —
    // swallow them and keep polling the signature status (the source of truth)
    // until it confirms or the block height expires.
    try {
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (err) {
      console.warn('Rebroadcast failed (continuing to poll):', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
```

The built-in `connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')` does the expiry check for you but does not rebroadcast; the manual loop above is more robust under congestion.

## Best Practices

- **Always simulate to size the CU limit.** Paying for 200,000 CUs when you use 20,000 wastes money and lowers effective priority.
- **Put compute-budget instructions first** — `setComputeUnitLimit` then `setComputeUnitPrice`, before your program instructions.
- **Never hardcode priority fees.** Fetch live estimates and add a small buffer (10–25%) for congestion.
- **Never use a `0` CU price** — the transaction gets no priority and may never land under load.
- **Simulate under the max CU limit, then clamp.** Prepend a temporary 1,400,000-CU limit when simulating so heavy txs report true usage; clamp the final limit to 1,400,000 and split the work if you brush the ceiling.
- **Add headroom to the CU limit (~10%)** — simulation reflects current state; on-chain state can shift before your tx lands.
- **At most one of each ComputeBudget instruction.** Duplicate `setComputeUnitLimit`/`setComputeUnitPrice` make the tx FAIL — normalize (strip caller-supplied ones) before prepending your own.
- **Include the fee payer in the writable set** when fetching `getRecentPrioritizationFees`.
- **Confirm against `lastValidBlockHeight`** so a stuck transaction fails fast instead of hanging forever.
- **Rebroadcast while waiting** with `skipPreflight: true` and `maxRetries: 0` so you control retries; wrap each resend in try/catch and keep polling status.
- **Warm up ALTs deterministically** — poll the slot/account after extending instead of a fixed sleep; don't reference an ALT in the same tx that creates it.
- **Devnet fees aren't mainnet fees** — devnet prioritization fees are noisy/often zero; use a provider estimate or mainnet data for real fee policy.
- **Use a reliable RPC** for production (Helius, Triton, QuickNode); public endpoints are heavily rate-limited.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Blockhash not found` / block height exceeded | Blockhash expired before landing | Refresh blockhash, confirm against `lastValidBlockHeight`, rebroadcast |
| `Transaction too large` | Over 1,232 bytes (too many accounts) | Use a versioned tx + Address Lookup Table |
| `exceeded CUs` / "Computational budget exceeded" | CU limit set too low | Raise the limit; size it from simulation + headroom |
| `exceeded maximum number of instructions` | Too many instructions in one transaction (a distinct cap — *not* the CU budget) | Split the work across multiple transactions; raising the CU limit will **not** fix this |
| Transaction dropped / never confirms | Priority fee too low for congestion | Raise the CU price; use a higher fee percentile |
| `Lookup table not found` / invalid index | ALT not warmed up or wrong account | Wait one slot after extend; re-fetch the ALT account |
| `Simulation failed` with no logs | Missing signer or bad blockhash | Use `replaceRecentBlockhash: true, sigVerify: false` for CU estimation |

See `docs/troubleshooting.md` for detailed diagnosis and code.

## Resources

- [Solana Docs — How to Use Priority Fees](https://solana.com/developers/guides/advanced/how-to-use-priority-fees)
- [Solana Docs — Versioned Transactions](https://solana.com/docs/advanced/versions)
- [Solana Docs — Address Lookup Tables](https://solana.com/docs/advanced/lookup-tables)
- [Solana Docs — Retrying Transactions](https://solana.com/developers/guides/advanced/retry)
- [Compute Budget Program source](https://github.com/anza-xyz/agave/tree/master/programs/compute-budget)
- [@solana/web3.js reference](https://solana-labs.github.io/solana-web3.js/)
- [Helius — Priority Fee API](https://docs.helius.dev/solana-apis/priority-fee-api)

## Skill Structure

```
priority-fees-and-transaction-building/
├── SKILL.md                              # This file
├── resources/
│   └── compute-budget-reference.md       # ComputeBudget instructions, defaults, fee math
├── examples/
│   ├── priority-fee-transfer/
│   │   └── example.ts                    # Simulate → fee → send v0 → confirm
│   └── address-lookup-table/
│       └── example.ts                    # Create + extend ALT, build v0 tx with it
├── templates/
│   └── send-with-priority-fee.ts         # Reusable sendWithPriorityFee() helper
└── docs/
    └── troubleshooting.md                # Expiry, size, CU, dropped-tx, ALT warm-up
```
