---
name: transaction-building
description: "Build efficient Solana transactions: legacy vs versioned (v0) transactions, Address Lookup Tables (create/extend/use to fit more accounts under the 1232-byte limit), instruction composition, measuring transaction size, and partial/offline/multisig/sponsor signing — with @solana/web3.js and @solana/kit. Use when a transaction is too large, when composing multiple instructions atomically, when using or managing Address Lookup Tables, or when assembling multisig/offline/fee-sponsored transactions."
---

# Building Solana Transactions

Constructing transactions well is the difference between an app that works and one that hits `Transaction too large` in production. This skill covers **fitting more accounts under the hard 1232-byte limit** (Address Lookup Tables + v0 transactions), **composing instructions atomically** across programs, and **assembling multisig / offline / fee-sponsored signatures** — with `@solana/web3.js` 1.98.4 (portable baseline) and `@solana/kit` 7.0.0 equivalents throughout.

## Overview — transaction anatomy

A Solana transaction on the wire is exactly two things:

```
transaction = [ compact-u16 count ][ 64-byte signatures... ][ compiled message ]
```

The **compiled message** carries a header, the ordered list of every account key the transaction touches, the recent blockhash (its lifetime), and the compiled instructions (program-id index + account indices + data). The **signatures array** is positional: `signatures[i]` belongs to `staticAccountKeys[i]`, and `signatures[0]` (the fee payer) *is* the transaction id.

The entire serialized packet must fit in **1232 bytes** (`PACKET_DATA_SIZE = 1280 − 40 − 8`, an IPv6-MTU-derived constant exported by web3.js). That budget is why construction matters:

- **Fit more accounts.** Every account key costs 32 bytes inline. A plain transaction tops out around **~35 account keys**. Address Lookup Tables (ALTs) replace a 32-byte key with a 1-byte index, letting a v0 transaction reference up to the runtime cap of **128 locked accounts** while staying under 1232 bytes.
- **Atomic multi-program composition.** One transaction = all-or-nothing execution across every instruction and every program. Order and compose instructions so partial state can never land.
- **Offline / sponsor / multisig signing.** Signatures are positional and independent, so parties can sign the identical message bytes at different times and places (air-gapped hardware, a relayer that pays fees, an N-of-M multisig).

This skill is about **CONSTRUCTION**. Getting a well-formed transaction **CONFIRMED** — priority fees, compute-budget pricing, retries/rebroadcast, Jito bundles, durable-nonce rebroadcast loops — lives in the **`transaction-landing`** skill. Build here; land there.

## Legacy vs Versioned (v0)

There are two transaction formats in `@solana/web3.js` 1.98.4: `Transaction` (legacy) and `VersionedTransaction` (`version: 'legacy' | 0`). Default to **v0** for app code — it is a strict superset of legacy (a v0 tx with zero lookups is the legacy tx plus a 1-byte prefix) and it is the *only* format that can use ALTs. Reach for legacy only for trivial one-off scripts or maximum wallet reach.

| Dimension | Legacy `Transaction` | v0 `VersionedTransaction` |
|---|---|---|
| Address Lookup Tables | **No** (runtime ignores lookups for legacy) | **Yes** — the whole point (`compileToV0Message([alt])`) |
| Practical account ceiling | ~**35** static keys (1232 B) | up to **128** locked accounts via ALTs (`MAX_TX_ACCOUNT_LOCKS`) |
| Build path | `new Transaction().add(...ixs)` (mutable) | `new TransactionMessage({...}).compileToV0Message()` → wrap |
| Sign call | `tx.sign(...signers)` **(variadic)** | `vtx.sign([signers])` **(array!)** |
| One-shot send+confirm | `sendAndConfirmTransaction(conn, tx, signers)` | none — pre-sign, then `sendTransaction(vtx)` + `confirmTransaction` |
| `sendTransaction` signers arg | yes (deprecated overload) | **no** — must be pre-signed |
| `serialize()` on oversize | **throws** `Transaction too large` | **silently returns** (does NOT throw — measure yourself) |
| Wallet support | universal | **gated** on `adapter.supportedTransactionVersions?.has(0)` |
| Wire prefix | first byte < 128 (no prefix) | first byte `0x80` |

> **Forward-looking note (do not build on this yet):** a new **transaction v1** format (SIMD-0296 "Larger Transactions" + SIMD-0385 "transaction-v1") raises the size limit to **4096 bytes** and moves priority-fee / compute-unit config into native message fields. It is **Review status and NOT activated on mainnet-beta**, and it **does not support Address Lookup Tables**. `@solana/kit` 7.0.0 already ships the plumbing (`TransactionVersion = 'legacy' | 0 | 1`, `V1_TRANSACTION_SIZE_LIMIT = 4096`) but `createTransactionMessage` only accepts `'legacy' | 0`. **Target v0 today.** Detail in `docs/versioned-transactions.md`.

## Build a v0 transaction

The v0 pipeline: build a `TransactionMessage`, compile it to a `MessageV0`, wrap it in a `VersionedTransaction`, **pre-sign it** (array arg), then send the already-signed transaction with **no signers argument**.

```ts
import {
  Connection, Keypair, SystemProgram, TransactionMessage,
  VersionedTransaction, clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const payer = Keypair.generate(); // fund on devnet first
const { blockhash } = await connection.getLatestBlockhash();

const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,     // fee payer → forced to account index 0
  recentBlockhash: blockhash,    // the transaction's lifetime
  instructions: [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
  ],
}).compileToV0Message(/* pass [lookupTableAccount, ...] here to use ALTs */);

const vtx = new VersionedTransaction(messageV0);
vtx.sign([payer]);                                  // ← ARRAY. MUST pre-sign before sending
const txid = await connection.sendTransaction(vtx); // ← NO signers arg (versioned overload)
await connection.confirmTransaction(txid, "confirmed");
```

Two footguns worth memorizing: legacy `tx.sign(a, b)` / `tx.add(a, b)` are **variadic**, but `vtx.sign([a, b])` takes an **array**; and `connection.sendTransaction(vtx)` has **no signers parameter** for the versioned overload — the vtx must already be signed (`sendAndConfirmTransaction` is typed to legacy only). Migrating a legacy tx to v0 changes only the assembly (`feePayer` → `payerKey`, `add(...)` → `instructions: [...]`, `.compileToV0Message()`, array `sign`); the `TransactionInstruction[]` objects are identical. Full API, `MessageV0` anatomy, and the migrate/inspect recipes: `docs/versioned-transactions.md` and `examples/build-v0-transaction.ts`.

## The 1232-byte limit

A serialized transaction spends its 1232 bytes on: 1 byte sig-count + **64 bytes per signature** + 3-byte header + (v0) 1-byte version prefix + **32 bytes per static account key** + 32-byte blockhash + program-id indices + per-instruction account-index arrays + instruction data. Rough budget: after ~105 bytes of fixed overhead for a one-signer tx, you get **~35 account keys** with zero instruction data — fewer once data is added. This is exactly why ALTs exist.

**CRITICAL gotcha:** `VersionedTransaction.serialize()` does **NOT** enforce 1232 and **never throws** — it allocates a 2048-byte scratch buffer and returns whatever fits, so an oversized v0 tx serializes "fine" and only gets rejected later by the RPC/leader. Legacy `Transaction.serialize()` *does* assert and throws `Transaction too large: N > 1232`. **You must measure v0 transactions yourself:**

```ts
import { PACKET_DATA_SIZE } from "@solana/web3.js";      // === 1232
const wire = vtx.serialize();                            // Uint8Array — does NOT throw on oversize
if (wire.length > PACKET_DATA_SIZE) throw new Error(`too big: ${wire.length} > 1232 — use ALTs / split`);
```

```ts
// @solana/kit 7.0.0 — first-class size helpers
import { getTransactionSize, isTransactionWithinSizeLimit } from "@solana/kit";
if (!isTransactionWithinSizeLimit(signedTx)) throw new Error(`too big: ${getTransactionSize(signedTx)} bytes`);
```

Strategies to fit more, in order of impact: (1) **ALTs** — move non-signer accounts to 1-byte indices; (2) fewer / deduplicated accounts; (3) split into multiple transactions; (4) shorter instruction data; (5) fewer signers (each costs 96 bytes — prefer PDA `invoke_signed` over extra keypairs). Byte-by-byte wire layout and the message-vs-transaction sizing math: `docs/transaction-size.md`.

## Address Lookup Tables

An **Address Lookup Table (ALT / LUT)** is an on-chain account storing up to **256** related addresses. A v0 transaction references any stored address by its **1-byte index** instead of embedding the 32-byte key — a ~31-byte saving per account. Only **non-signer, non-fee-payer, non-program** accounts are eligible; signers, the fee payer, and program IDs must stay in the static keys and cannot be sourced from a table.

**Lifecycle & timing:**

```
create ─► [warm up 1 slot] ─► extend (repeat, ~30 keys/ix, +1-slot warm-up each) ─► USE in v0 txns
   │                                                                                    │
deactivate ─► [cooldown ~513 slots] ─► close (reclaims rent)      (or) freeze ─► immutable forever
```

`AddressLookupTableProgram` (program `AddressLookupTab1e1111111111111111111111111`) exposes the builders. Note that `createLookupTable` returns a **tuple** `[instruction, lookupTableAddress]`:

```ts
import { AddressLookupTableProgram } from "@solana/web3.js";

const slot = await connection.getSlot();
const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
  authority: payer.publicKey,
  payer: payer.publicKey,
  recentSlot: slot - 1, // ← slot-1 gotcha (see below)
});

const extendIx = AddressLookupTableProgram.extendLookupTable({
  lookupTable: lookupTableAddress,
  authority: payer.publicKey,
  payer: payer.publicKey,
  addresses: [/* up to ~30 non-signer keys per extend ix */],
});
// send create+extend → wait ≥1 slot (warm-up) → fetch → compileToV0Message([lut])
const lut = (await connection.getAddressLookupTable(lookupTableAddress)).value!;
```

**Three facts that trip people up:**

- **Real per-tx cap is `MAX_TX_ACCOUNT_LOCKS = 128`** distinct locked accounts (static + all ALT-resolved), *not* the "64 addresses" some older docs still quote — that figure is **stale**. Cite 128.
- **`recentSlot: slot - 1`.** The table address is a PDA of `[authority, recentSlot]`. Passing the *absolute latest* `getSlot()` intermittently fails with `<slot> is not a recent slot` because the leader may be a slot behind your RPC read. Always pass `slot - 1`.
- **~1-slot warm-up.** A newly created table (and each newly extended address) is **not usable until the next slot**. Using it in the same slot fails `Transaction address table lookup uses an invalid index`.

Caps: **256 addresses/table**, **~30 addresses per extend ix** (size-bounded — loop to fill), **~513-slot cooldown** after `deactivate` before `close`, and `freeze` is **irreversible** (no extend/deactivate/close ever after). Full flow + kit path: `docs/address-lookup-tables.md` and `examples/lookup-table.ts`.

## Composing instructions

A transaction executes its instructions **in order, all-or-nothing** — if any instruction fails, the entire transaction reverts and no state changes land. This is Solana's atomicity primitive: compose a swap + a fee transfer + a memo in one transaction and they either all happen or none do. Ordering matters where instruction N depends on instruction N−1's effects (e.g. create an account, then initialize it).

```ts
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token"; // 0.4.14

// Idempotent ATA creation: safe whether or not the ATA already exists — no pre-flight
// "does it exist?" RPC round-trip, and it won't fail the whole tx if a race created it first.
const ataIx = createAssociatedTokenAccountIdempotentInstruction(
  payer.publicKey, // fee payer / funder
  ata,             // derived associated token address
  owner,           // token account owner
  mint,            // token mint
);

const instructions = [
  ataIx,           // 1. ensure the destination ATA exists (idempotent)
  transferIx,      // 2. then transfer into it — depends on (1)
];
```

Prefer `createAssociatedTokenAccountIdempotentInstruction` over the non-idempotent variant when you cannot be sure the ATA exists — it dedupes with any concurrent creator instead of aborting the transaction. To bound compute cost and set a priority fee, prepend `ComputeBudgetProgram.setComputeUnitLimit` / `setComputeUnitPrice` instructions — but **pricing, CU estimation, and fee math belong to the `transaction-landing` skill** (`docs/priority-fees.md`); this skill only notes *where* those instructions go (first, order-independent). More composition patterns: `examples/compose-instructions.ts`.

## Signing & assembly

Signatures are **positional and independent**: the runtime fixes the account order (writable-signers → readonly-signers → writable-non-signers → readonly-non-signers), the **fee payer is forced to index 0**, and `signatures[i]` maps to `staticAccountKeys[i]`. Because every signer signs the **identical message bytes**, parties can sign in any order, at any time, on any machine — as long as nobody mutates the message (fee payer, blockhash/nonce, instructions, account order) after the first signature.

- **Partial / multisig signing.** web3.js: `vtx.sign([subset])` fills only the provided signers' slots (v0); legacy `tx.partialSign(...signers)`. Serialize an incomplete legacy tx for hand-off with `tx.serialize({ requireAllSignatures: false, verifySignatures: false })`; a partially-signed v0 tx serializes fine (unsigned slots are 64 zero bytes). The next party `VersionedTransaction.deserialize(wire)` / `Transaction.from(wire)`, signs their slot, re-serializes.
- **Offline / air-gapped (hardware).** Inject an externally-produced 64-byte signature with `vtx.addSignature(pubkey, sig64)` (or legacy `tx.addSignature`) — no secret key in process.
- **Sponsor / relayer (fee payer ≠ user).** Set `payerKey = sponsor.publicKey` (fee payer at index 0) plus the user as an instruction signer. The user signs their slot and returns the partially-signed wire; the sponsor adds `vtx.sign([sponsor])` and submits. The sponsor pays the fee; `signatures[0]` (sponsor) is the tx id.
- **Long-lived / offline lifetimes.** Blockhashes expire in ~60–90 s — too short for air-gapped or multisig round-trips. Swap the blockhash lifetime for a **durable nonce** (first instruction must be `SystemProgram.nonceAdvance`). Durable-nonce creation, `getNonceAndContext`, and rebroadcast mechanics live in the **`transaction-landing`** skill (`docs/retries-and-confirmation.md`).

Full partial/offline/multisig/sponsor recipes with the deserialize→sign→combine handoff: `docs/signing-and-assembly.md` and `examples/offline-signing.ts`.

## The @solana/kit path

`@solana/kit` 7.0.0 has **no `Transaction` / `VersionedTransaction` class split** — one immutable `TransactionMessage` (`version: 'legacy' | 0`) built with `pipe()` + setters, where every setter returns a new, more-strongly-typed message:

```ts
import {
  pipe, createSolanaRpc, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
  signTransactionMessageWithSigners, getSignatureFromTransaction,
  getBase64EncodedWireTransaction, generateKeyPairSigner,
} from "@solana/kit"; // 7.0.0

const rpc = createSolanaRpc("https://api.devnet.solana.com");
const feePayer = await generateKeyPairSigner();
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send(); // lastValidBlockHeight is a bigint

const message = pipe(
  createTransactionMessage({ version: 0 }),                              // v0 (ALT-capable) default
  m => setTransactionMessageFeePayerSigner(feePayer, m),                 // fee payer AS a signer
  m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),  // pass .value straight in
  m => appendTransactionMessageInstructions(instructions, m),
);
const signedTx = await signTransactionMessageWithSigners(message);       // compiles + signs in one call
await rpc.sendTransaction(getBase64EncodedWireTransaction(signedTx), { encoding: "base64" }).send();
```

**ALT compression needs no extra dependency** to *read/use* tables — kit exports `fetchAddressesForLookupTables(addrs, rpc)` → `AddressesByLookupTableAddress`, then `compressTransactionMessageUsingAddressLookupTables(message, addressesByLut)` rewrites eligible accounts into lookups. Note the argument order: the **message is the FIRST arg** (opposite of most value-first APIs), and only v0 messages can be compressed.

> **Peer-skew caveat (managing tables in kit):** to *create/extend/deactivate/close* tables you need `@solana-program/address-lookup-table` **0.12.1**, which declares `peerDependencies: { "@solana/kit": "^6.4.0" }`. Installed against kit **7.0.0** it emits an unmet-peer-dep / `ERESOLVE` warning (it works at runtime — ABI-stable codecs). Mitigate with `npm i --legacy-peer-deps`, or pin kit `^6.4.0` for that package, or avoid it entirely for the read/compress path (kit-native `fetchAddressesForLookupTables` has no skew). A 0.12.2+/0.13 widening the range to `^7` is likely imminent — **re-check `npm view @solana-program/address-lookup-table peerDependencies` at build time.**

Signers, partial signing (`partiallySignTransactionMessageWithSigners`), size helpers, and the full compress→sign→send pipeline: `examples/kit-build.ts` and the docs referenced above.

## Guidelines

**DO**
- **DO** default new app code to **v0** (`compileToV0Message` / kit `version: 0`) — it is a superset of legacy and unlocks ALTs.
- **DO measure v0 size yourself** (`vtx.serialize().length` vs 1232, or kit `isTransactionWithinSizeLimit`) — the v0 serializer does NOT throw on oversize.
- **DO** pass `recentSlot: slot - 1` to `createLookupTable`, and **wait ≥1 slot** (warm-up) after create/extend before referencing the table.
- **DO** reuse a long-lived shared ALT for common accounts (your program IDs, token/ATA programs, well-known mints) — rent is paid once, every future tx benefits.
- **DO freeze account order** (fee payer, blockhash/nonce, instructions, metas) before **any** party signs — reordering changes the positional signature slots.
- **DO** pre-sign a `VersionedTransaction` before `connection.sendTransaction(vtx)` — the versioned overload has no signers argument.

**DON'T**
- **DON'T** assume every wallet supports v0 — gate on `wallet.adapter.supportedTransactionVersions?.has(0)` (see the `wallet-adapter` skill) and fall back to legacy.
- **DON'T** put **signers, the fee payer, or program IDs** in an ALT expecting index resolution — those must stay in static keys.
- **DON'T** use an ALT (or a just-extended address) in the **same slot** you created/extended it.
- **DON'T** `close` an ALT before its **~513-slot cooldown** finishes after `deactivate`, and **DON'T** `freeze` unless the contents are final (freezing is irreversible).
- **DON'T** call `sendAndConfirmTransaction` with a `VersionedTransaction` — it is typed to legacy; use `sendTransaction(vtx)` + `confirmTransaction`.
- **DON'T** mutate a message after signing — it invalidates every signature.
- **DON'T** build **v1** transactions for mainnet — SIMD-0385 is still `Review` and unsupported by the public constructor.

## Common Errors

### Error: "Transaction too large: N > 1232" (legacy) / silent RPC reject (v0)
**Cause:** too many static account keys / too much instruction data. Legacy `Transaction.serialize()` asserts and throws locally; v0 `VersionedTransaction.serialize()` does NOT throw — the RPC/leader silently rejects the oversized packet on send.
**Solution:** measure v0 explicitly (`serialize().length` vs `PACKET_DATA_SIZE`); move non-signer accounts into an ALT and `compileToV0Message([alt])` (~31 bytes saved each), dedupe accounts, split the tx, or shorten instruction data.

### Error: "<slot> is not a recent slot"
**Cause:** the `recentSlot` passed to `createLookupTable` is ahead of the leader's view (you used the absolute latest `getSlot()`).
**Solution:** use `recentSlot: slot - 1`.

### Error: "Transaction address table lookup uses an invalid index"
**Cause:** the ALT (or a just-extended address) was referenced before its ~1-slot warm-up completed, or an index past `state.addresses.length`.
**Solution:** wait ≥1 slot after create/extend; re-`getAddressLookupTable` and confirm the address is present before referencing it.

### Error: "Cannot sign with non signer key <pubkey>" / "unknown signer"
**Cause:** signing with (or `addSignature` for) a key that is not among the required signers — not the fee payer and not marked `isSigner` in any instruction.
**Solution:** mark the account as a signer in an instruction (or set it as fee payer) before compiling; verify you are signing the correct, frozen message.

### Error: wallet fails to sign — "unsupported transaction version"
**Cause:** the connected wallet/adapter does not advertise v0 (`supportedTransactionVersions` is `undefined` or lacks `0`).
**Solution:** feature-gate on `wallet.adapter.supportedTransactionVersions?.has(0)` and fall back to a legacy `Transaction` (see the `wallet-adapter` skill).

### Error: sent a `VersionedTransaction` but it never lands / "signature verification failed"
**Cause:** the vtx was sent unsigned (or partially signed) — `connection.sendTransaction(vtx)` does not sign for you, and passing signers as a second arg is a type error on the versioned overload.
**Solution:** `vtx.sign([...allRequiredSigners])` (array!) before sending; for handoffs, collect every required signature (positional slots) before submitting.

### Error: "Table cannot be closed until it's fully deactivated in N blocks"
**Cause:** `closeLookupTable` called before the ~513-slot cooldown after `deactivate`.
**Solution:** poll `getSlot()` until `currentSlot - deactivationSlot > 513`, then close.

## Files in This Skill

```
transaction-building/
├── SKILL.md                          # This file — the authoritative entry point
├── docs/
│   ├── versioned-transactions.md     # Legacy vs v0 full API, MessageV0 anatomy, migrate/inspect, v1 outlook
│   ├── address-lookup-tables.md      # ALT lifecycle, timing, web3.js + kit management, MAX_TX_ACCOUNT_LOCKS
│   ├── transaction-size.md           # 1232-byte wire layout, measuring (web3.js + kit), fit-more strategies
│   ├── signing-and-assembly.md       # numRequiredSignatures, partial/offline/multisig/sponsor, durable nonce
│   └── troubleshooting.md            # Expanded error catalog (Cause / Solution)
├── resources/
│   └── api-reference.md              # web3.js ↔ kit export map, program IDs, constants, version matrix
├── examples/
│   ├── build-v0-transaction.ts       # Build → measure → sign → send a v0 tx (+ legacy migration)
│   ├── lookup-table.ts               # Create → extend → warm up → use → deactivate → close an ALT
│   ├── compose-instructions.ts       # Atomic multi-program composition, idempotent ATA, ordering
│   ├── offline-signing.ts            # Partial / multisig / sponsor / air-gapped signing + handoff
│   └── kit-build.ts                  # Full @solana/kit 7 pipe pipeline + ALT compression
└── templates/
    └── tx-builder.ts                 # Reusable buildV0Transaction() helper (measure + optional ALTs)
```

## References

- **Versioned transactions (v0)** — Solana docs, Advanced › Versions: https://solana.com/docs/advanced/versions
- **Address Lookup Tables** — Solana docs, Advanced › Lookup Tables: https://solana.com/docs/advanced/lookup-tables
- **Transaction structure & the 1232-byte limit** — Solana docs: https://solana.com/docs/core/transactions/transaction-structure
- **`MAX_TX_ACCOUNT_LOCKS` 64 → 128** — anza-xyz/solana-sdk `transaction/src/sanitized.rs`; Solana forum feature note: https://forum.solana.com/t/feature-increased-tx-account-lock-limits-1-14-17/189
- **SIMD-0296 (Larger Transactions) / SIMD-0385 (transaction-v1)** — Review status, 4096 bytes, no ALTs: https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md
- **`@solana/web3.js` 1.98.4** — https://www.npmjs.com/package/@solana/web3.js
- **`@solana/kit` 7.0.0** (transactions guide) — https://www.solanakit.com/docs/advanced-guides/transactions
- **`@solana-program/address-lookup-table` 0.12.1** (kit codama client; note the `^6.4.0` peer range) — https://www.npmjs.com/package/@solana-program/address-lookup-table
- **Related skills:** `transaction-landing` (priority fees, confirmation, retries, Jito, durable-nonce rebroadcast) · `wallet-adapter` (v0 gating, wallet signing) · `token-2022` (Token-2022 instructions to compose).
