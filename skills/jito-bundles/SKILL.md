---
name: jito-bundles
description: Land atomic, all-or-nothing transaction bundles on Solana via the Jito Block Engine with @solana/web3.js — fetch tip accounts, size the tip from the tip-floor feed, build versioned transactions, send via JSON-RPC, and poll bundle status to confirmation. Use when an agent needs MEV protection, guaranteed transaction ordering, or several transactions to execute together in one slot or not at all.
---

# Jito Bundles Development Guide

Land **bundles** — ordered groups of up to 5 transactions that execute
**atomically in a single slot** — on Solana through the Jito Block Engine. Bundles
give you guaranteed ordering, all-or-nothing execution, and MEV protection that
ordinary `sendTransaction` cannot.

## Overview

A bundle is a list of **1–5 fully-signed transactions** submitted together. The
Jito Block Engine either lands **all of them, in order, in the same slot**, or
**none** of them. To be considered, a bundle must include a **tip** — a SOL
transfer to one of Jito's tip accounts — and the tip (not the Solana priority
fee) is what wins the auction.

Use this skill when you need to:
- execute multiple dependent transactions atomically (e.g. setup → action → settle),
- guarantee transaction ordering within a slot,
- protect a transaction from front-running / sandwiching (MEV protection),
- or improve landing odds during congestion by paying a Jito tip.

The Block Engine is **plain JSON-RPC over HTTPS** — for `@solana/web3.js` v1.x you
need **no Jito SDK**, just `fetch`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `sendBundle` | `/api/v1/bundles` | submit 1–5 signed txns |
| `getInflightBundleStatuses` | `/api/v1/getInflightBundleStatuses` | fast status (5-min window) |
| `getBundleStatuses` | `/api/v1/getBundleStatuses` | on-chain confirmation + signatures |
| `getTipAccounts` | `/api/v1/getTipAccounts` | the 8 tip accounts |

Base URL `https://mainnet.block-engine.jito.wtf` (regional hosts:
`amsterdam`, `dublin`, `frankfurt`, `london`, `ny`, `slc`, `singapore`, `tokyo`
— `.mainnet.block-engine.jito.wtf`). Full reference: `resources/block-engine-reference.md`.

## Quick Start

### Installation

```bash
npm install @solana/web3.js   # v1.95+ for stable VersionedTransaction support. No Jito SDK needed.
```

### Send a bundle (raw JSON-RPC)

```ts
import { Connection, SystemProgram, PublicKey } from "@solana/web3.js";
import {
  getTipAccounts, pickTipAccount, fetchTipLamports,
  buildV0Tx, encodeBase64, jitoRpc, tipInstruction, waitForBundle,
} from "./examples/_shared/util";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// 1. tip account (random of 8) + competitive tip (tip-floor-derived, SOL->lamports handled)
const tipAccount = pickTipAccount(await getTipAccounts());
const tipLamports = await fetchTipLamports();

// 2. all txns share ONE recent blockhash (single-slot execution)
const { blockhash } = await connection.getLatestBlockhash("confirmed");
const work = buildV0Tx(payer.publicKey, blockhash, [/* your instructions */], [payer]);
const last = buildV0Tx(payer.publicKey, blockhash,
  [/* more instructions */, tipInstruction(payer.publicKey, tipAccount, tipLamports)], [payer]);

// 3. base64-encode and send — {encoding:'base64'} is REQUIRED (legacy default is base58)
const bundleId = await jitoRpc<string>("sendBundle", [[work, last].map(encodeBase64), { encoding: "base64" }]);

// 4. a bundle_id means RECEIVED, not LANDED — poll until terminal
const status = await waitForBundle(bundleId);
console.log("landed in slot", status.slot, status.confirmation_status, status.transactions);
```

See `templates/send-jito-bundle.ts` for a reusable `sendJitoBundle()` that does
tip injection, encoding, sending, and polling in one call.

## Core Features

### Atomic, ordered execution
Up to 5 transactions land **all-or-nothing**, **in order**, in **one slot**. If
any transaction fails, the entire bundle is rejected and nothing commits. Budget
one of the 5 slots for the tip if you tip in a standalone transaction.

### Tips (how bundles win)
The tip is a `SystemProgram.transfer` to a tip account, in the **last**
transaction (ideally folded into your real work so a failed strategy never pays).
Size it from the **tip-floor feed** — and remember those values are in **SOL**,
so convert with `× LAMPORTS_PER_SOL`. For `sendBundle`, **only the tip** decides
landing; the priority fee does not. Details: `resources/tip-accounts.md`.

### Confirmation
`getInflightBundleStatuses` gives a fast `Pending|Landed|Failed|Invalid` within a
5-minute window; once `Landed`, `getBundleStatuses` returns the real on-chain
signatures, slot, and `confirmation_status`.

### Examples
- `examples/send-bundle/` — two transfers, atomic, send + confirm.
- `examples/tip-floor-and-confirm/` — size the tip from the live feed and confirm to finality.

## Best Practices

- **Always pass `{ encoding: "base64" }`** to `sendBundle` — the default is the deprecated base58.
- **Never trust the `bundle_id` as success** — poll status to a terminal state.
- **Fetch tip accounts at runtime** (`getTipAccounts`) and pick one **at random** to avoid write-lock contention.
- **Size the tip from `tip_floor`** (50th–75th percentile), not the 1,000-lamport minimum, and convert **SOL → lamports**.
- **Build & sign as late as possible** — blockhashes expire in ~60–90s; a stale one means the bundle won't land.
- **Respect the rate limit** — 1 req/sec per IP per region; sleep ≥1s in poll loops or use regional hosts.
- **Fold the tip into a real transaction** rather than a standalone tip tx (saves a slot, reduces "uncle bandit" exposure).

## Common Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| Bundle "succeeds" but never lands | `bundle_id` ≠ landed | poll `getInflightBundleStatuses` / `getBundleStatuses` |
| Stays `Pending` → `Invalid` | tip too low / uncled | size tip off `tip_floor` (50–75th pct) |
| Tip ~1e9× too small | tip_floor is SOL, not lamports | `× LAMPORTS_PER_SOL` |
| "failed to deserialize" | base64 without `{encoding:"base64"}` | pass the encoding object |
| Status poll never lands | result read as a bare array | result is `{ context, value: [...] }` — read `.value` |
| Status fields `undefined` | wrong field name | response is snake_case (`confirmation_status`, `bundle_id`, `landed_slot`) |
| HTTP 429 | >1 req/sec/region | back off ≥1s / use regions |
| `simulateBundle` not found | it's an RPC-node method | call a Jito-Solana RPC, not the block engine |

Full guide: `docs/troubleshooting.md`.

## Resources

- `resources/block-engine-reference.md` — endpoints, methods, params/responses, limits.
- `resources/tip-accounts.md` — tip accounts, tip-floor sizing, the SOL/lamports trap.
- `docs/troubleshooting.md` — symptom-first failure modes.
- `templates/send-jito-bundle.ts` — reusable bundle sender.
- Official docs: <https://docs.jito.wtf/lowlatencytxnsend/>

## Skill Structure

```
jito-bundles/
├── SKILL.md
├── docs/
│   └── troubleshooting.md
├── examples/
│   ├── _shared/util.ts
│   ├── send-bundle/example.ts
│   └── tip-floor-and-confirm/example.ts
├── resources/
│   ├── block-engine-reference.md
│   └── tip-accounts.md
└── templates/
    └── send-jito-bundle.ts
```
