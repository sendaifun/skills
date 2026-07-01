# Transaction Size — the 1232-byte budget

The deep dive behind the size section in `../SKILL.md`: exactly **what** fills a transaction's
1232-byte budget, **how** to measure it (and the v0 serializer gotcha that silently hands you an
oversized transaction), and **how** to fit more into it. Baseline client: **`@solana/web3.js`
1.98.4**; **`@solana/kit` 7.0.0** equivalents throughout.

Related docs: `versioned-transactions.md` (legacy vs v0), `address-lookup-tables.md` (the biggest
size win), `signing-and-assembly.md` (signature bytes). Confirmation/retries live in the
**`transaction-landing`** skill — not here.

---

## The hard limit: 1232 bytes

A fully serialized transaction — **signatures + message, over the wire** — must fit in **1232
bytes**. This is a network constraint, not an arbitrary choice:

```
1280  IPv6 minimum MTU
 -40  IPv6 header
  -8  fragment header
=1232 bytes  ← the entire transaction packet
```

`@solana/web3.js` exports this as the public constant `PACKET_DATA_SIZE`:

```ts
import { PACKET_DATA_SIZE } from "@solana/web3.js"; // === 1232
```

The same number is `solana_packet::PACKET_DATA_SIZE = 1232` in the Agave validator. It applies to
**both legacy and v0** transactions — v0 does **not** raise the ceiling; it only lets you *reference*
more accounts cheaply via Address Lookup Tables (see below and `address-lookup-tables.md`).

`@solana/kit` 7.0.0 encodes the same value internally as `LEGACY_TRANSACTION_SIZE_LIMIT = 1232`
(and the forthcoming `V1_TRANSACTION_SIZE_LIMIT = 4096`). Those raw symbols are **intentionally not
exported** from the package — use the runtime helpers in [Measuring](#measuring-transaction-size)
(`getTransactionSize`, `isTransactionWithinSizeLimit`, `getTransactionSizeLimit`) instead of
importing a magic number.

---

## Wire layout — what fills the 1232 bytes

A serialized transaction is `[ signatures ] ++ [ compiled message ]`:

| Segment | Size | Notes |
|---|---|---|
| signature count | 1 byte (compact-u16) | equals `numRequiredSignatures` (1 byte while `<128`) |
| **signatures** | **64 × numRequiredSignatures** | one Ed25519 signature per required signer |
| message header | **3 bytes** | `numRequiredSignatures`, `numReadonlySignedAccounts`, `numReadonlyUnsignedAccounts` (each u8) |
| (v0 only) version prefix | 1 byte | high bit set → `0x80` for v0; legacy has no prefix |
| static account keys count | 1–3 bytes (compact-u16) | |
| **static account keys** | **32 × N** | every pubkey the tx touches inline is 32 bytes |
| recent blockhash | 32 bytes | (or the nonce value for durable-nonce txs) |
| instructions count | 1–3 bytes (compact-u16) | |
| per instruction | `1 + (1..3 + accts) + (1..3 + dataLen)` | `programIdIndex` (1) + account-index array + data |
| (v0 only) address-table-lookups | 1 byte count + variable | per table: 32-byte table key + writable/readonly index arrays |

**compact-u16 ("ShortVec")** encodes counts: **1 byte** for 0–127, 2 bytes for 128–16383, 3 bytes
above. Every count field above (signatures, keys, instructions, per-instruction accounts/data) uses
it, so most fit in a single byte.

The two line items that dominate the budget are **signatures (64 B each)** and **account keys (32 B
each)**. Everything else — the 3-byte header, the 32-byte blockhash, the version prefix, the count
bytes, `programIdIndex` bytes — is small and fixed. This is why the two levers that matter are
**fewer signers** and **fewer inline account keys** (the latter is what ALTs address).

---

## Worked byte budget

For a **single-signer v0** transaction, the fixed overhead (everything except account keys and
instruction data) is roughly:

```
  1  signature count (compact-u16)
 64  fee-payer signature
  3  message header
  1  v0 version prefix (0x80)
  1  static-keys count
 32  recent blockhash
  1  instructions count
  1  address-table-lookups count (0 tables)
────
104  bytes fixed overhead
```

That leaves `1232 − 104 = 1128` bytes for account keys + instruction bodies. At **32 bytes per
inline account key**, a plain transaction with negligible instruction data tops out around

```
1128 / 32 ≈ 35 inline account keys
```

— and fewer once you add real instruction data (each program-id index, each account-index array,
and each data blob eats into the same 1128 bytes). **~35 inline accounts is the practical ceiling of
a legacy or ALT-free v0 transaction.** That single number is the reason Address Lookup Tables exist.

Other caps to know (independent of the 1232 bytes):

- **Runtime lock cap: `MAX_TX_ACCOUNT_LOCKS = 128`** distinct accounts locked per transaction
  (static keys **plus** every address resolved from every referenced ALT). This was **raised 64 →
  128** in Solana v1.14.17. Some older docs still quote **"64 addresses"** as the ALT ceiling — that
  figure is **stale**; cite **128**. ALTs let you *reference* many accounts cheaply, but you still
  cannot touch more than 128 in one transaction.
- **Static account keys: ≤ 256** (the compiler asserts `Max static account keys length exceeded`).
- **Signatures: ~19 theoretical max** (1232 ÷ 64) if nothing else were present — realistically a
  handful. Every signer is *also* a 32-byte static key, so each additional signer costs **96 bytes**
  (64 signature + 32 key).
- **Instructions: no fixed count** — bounded only by the 1232 bytes and the compute budget.

---

## Measuring transaction size

### The critical v0 gotcha — `serialize()` does NOT throw

| | Legacy `Transaction.serialize()` | v0 `VersionedTransaction.serialize()` |
|---|---|---|
| Scratch buffer | writes into a **1232-byte** buffer | allocates a **2048-byte** buffer |
| On oversize | **asserts and throws** `Transaction too large: N > 1232` | **silently returns** a `>1232`-byte array — **never throws** |
| Who catches the overflow | your local `serialize()` call | only the **RPC / leader**, at send time |

`VersionedTransaction.serialize()` returns `buffer.slice(0, length)` from a 2048-byte scratch buffer,
so an oversized v0 transaction serializes "successfully" and looks fine locally — then gets silently
dropped by the RPC/leader on send, with no clear client-side error. **You must measure v0
transactions yourself:**

```ts
import { VersionedTransaction, PACKET_DATA_SIZE } from "@solana/web3.js"; // PACKET_DATA_SIZE === 1232

const wire = vtx.serialize();                 // Uint8Array — does NOT throw on oversize
if (wire.length > PACKET_DATA_SIZE) {
  throw new Error(`tx too big: ${wire.length} > ${PACKET_DATA_SIZE} — use ALTs / split / dedupe`);
}
```

Legacy transactions throw locally, so you *can* rely on `serialize()` there — but to **size** a
not-yet-fully-signed legacy tx without tripping the signature checks, disable them:

```ts
const size = legacyTx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
```

### Measuring a v0 message *before* signing

To size a message before you have signatures, serialize the compiled `MessageV0` and add the
signature overhead (the message serializer *does* use a 1232-byte buffer, but adding the signatures
is how you get the true wire size):

```ts
const msgLen = messageV0.serialize().length;
const total  = 1 /* sig count */ + 64 * messageV0.header.numRequiredSignatures + msgLen;
```

Comparing `compileToV0Message()` vs `compileToV0Message([lut])` this way is the cleanest proof that
an ALT actually shrinks the transaction under 1232.

### `@solana/kit` 7.0.0 — first-class size helpers

Kit exposes real size helpers (no manual arithmetic, and they return the correct limit **per
version**):

```ts
import {
  getTransactionSize,                 // (tx) => number  (wire bytes)
  getTransactionSizeLimit,            // (tx) => 1232 | 4096  (per the tx's version)
  isTransactionWithinSizeLimit,       // (tx) => boolean  (type guard)
  assertIsTransactionWithinSizeLimit, // throws SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT
  getBase64EncodedWireTransaction,
} from "@solana/kit";

const bytes = getTransactionSize(signedTx);
if (!isTransactionWithinSizeLimit(signedTx)) {
  throw new Error(`tx too big: ${bytes} / ${getTransactionSizeLimit(signedTx)}`);
}

// Equivalent via the base64 wire string:
const wireBytes = Buffer.from(getBase64EncodedWireTransaction(signedTx), "base64").length; // === getTransactionSize(signedTx)
```

Message-level helpers let you check **before** compile/sign (they require a message that already has
a fee payer):

```ts
import {
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
  isTransactionMessageWithinSizeLimit,
  assertIsTransactionMessageWithinSizeLimit,
} from "@solana/kit";

if (!isTransactionMessageWithinSizeLimit(message)) { /* compress with ALTs / split */ }
```

Unlike web3.js, kit's `assertIsTransactionWithinSizeLimit` and the send path **do** raise a typed
error (`SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT`) — but the guard-first pattern above is still
the right habit, because `signTransactionMessageWithSigners` / `compileTransaction` themselves do not
block an oversized message.

---

## Strategies to fit more into 1232 bytes

In descending order of impact:

1. **Address Lookup Tables (the biggest win).** Any account that is **not a signer and not an
   invoked program** can move out of the 32-byte static-key list into an on-chain table and be
   referenced by a **1-byte index** — a **~31-byte saving per account**. One table holds up to **256**
   addresses; a v0 message may reference **several** tables. This is the difference between ~35 and
   up to 128 (`MAX_TX_ACCOUNT_LOCKS`) referenced accounts. Full lifecycle, timing, and the web3.js +
   kit APIs: `address-lookup-tables.md`.

2. **Fewer / deduplicated accounts.** The compiler dedupes a key used across multiple instructions
   into one static entry, so reuse the same account rather than passing distinct ones; drop optional
   accounts; hardcode well-known sysvars via on-chain program constants instead of passing them.

3. **Split into multiple transactions.** When the work decomposes, batch instructions across 2+
   transactions. If they must be ordered/long-lived, use a **durable nonce**
   (`signing-and-assembly.md`); if they must be **atomic**, a single transaction or a Jito bundle is
   the only option (bundles → `transaction-landing`).

4. **Shorter instruction data.** Trim oversized memos, pack arguments tightly, prefer indices over
   repeated pubkeys, and write large blobs to an account first rather than embedding them.

5. **Fewer signers.** Each signer costs **96 bytes** (64 signature + 32 key). Prefer a **PDA signed
   by the program via `invoke_signed`** over an extra keypair signer wherever the design allows.

---

## Forward-looking: transaction v1 / 4096 bytes (not yet on mainnet)

A new format raises the ceiling — **do not build on it for mainnet yet**:

- **SIMD-0296 "Larger Transactions"** raises the max payload **1232 → 4096 bytes** (enabled by QUIC).
- **SIMD-0385 "transaction-v1"** carries that larger size and adds native config fields (priority
  fee, compute-unit limit, requested heap, loaded-accounts-data-size limit) so ComputeBudget
  instructions are no longer needed. **v1 notably does *not* support Address Lookup Tables.**
- **Status: `Review` — NOT activated on mainnet-beta.** `@solana/kit` 7.0.0 already ships the
  plumbing (`TransactionVersion = 'legacy' | 0 | 1`, `V1_TRANSACTION_SIZE_LIMIT = 4096`,
  `getTransactionSizeLimit` returns `4096` for a v1 tx), but **`createTransactionMessage` only
  accepts `'legacy' | 0`** — you cannot build a v1 message with the public constructor. web3.js v1
  knows only `'legacy' | 0`.

**Guidance:** target **v0** today; treat 1232 as the real cap; watch the SIMD-0385 feature gate.

---

## Guidelines

**DO**
- **DO** measure v0 transactions explicitly (`vtx.serialize().length` vs `PACKET_DATA_SIZE`, or kit
  `isTransactionWithinSizeLimit`) — the v0 serializer will not warn you.
- **DO** compare `compileToV0Message()` vs `compileToV0Message([lut])` byte counts to prove an ALT
  actually helps before you rely on it.
- **DO** reach for ALTs the moment a v0 tx nears ~1150 bytes.
- **DO** prefer PDA `invoke_signed` over extra keypair signers (saves 96 bytes each).

**DON'T**
- **DON'T** assume `VersionedTransaction.serialize()` throws on oversize — it doesn't; only the RPC
  rejects it, silently.
- **DON'T** try to move a **signer**, the **fee payer**, or a **program id** into an ALT — only
  non-signer, non-invoked accounts are eligible (see `address-lookup-tables.md`).
- **DON'T** count on ALTs to exceed **128** referenced accounts (`MAX_TX_ACCOUNT_LOCKS`), regardless
  of how many tables you attach.
- **DON'T** hardcode `4096` / build v1 transactions for mainnet — SIMD-0385 is still `Review`.

---

## Common Errors

### Error: `Transaction too large: 1263 > 1232` (legacy only)
**Cause:** legacy `Transaction.serialize()`'s size assertion — the fully serialized tx exceeds
`PACKET_DATA_SIZE`.
**Solution:** switch to v0 + ALTs, dedupe/remove accounts, split the tx, or shorten instruction data.
(A v0 tx of the same size will **not** throw here — measure `serialize().length` yourself.)

### Error: a v0 transaction silently never lands (no client error)
**Cause:** the v0 tx is `>1232` bytes; `VersionedTransaction.serialize()` returned it without
throwing (2048-byte scratch buffer), and the RPC/leader dropped the oversized packet.
**Solution:** measure before sending (`wire.length > PACKET_DATA_SIZE`, or kit
`isTransactionWithinSizeLimit`); apply the fit-more strategies above.

### Error (kit): `SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT`
**Cause:** `assertIsTransactionWithinSizeLimit` / the send path — the compiled tx exceeds its
version's limit.
**Solution:** guard with `isTransactionWithinSizeLimit(tx)` first, then apply the same size-reduction
strategies (ALT compression via `compressTransactionMessageUsingAddressLookupTables`, split, dedupe).

### Error: `Max static account keys length exceeded`
**Cause:** more than **256** inline static account keys in one message.
**Solution:** move non-signer accounts into ALTs (they no longer count as static keys) or split the
transaction. Note you'll usually hit the 1232-byte or 128-lock limit long before 256 static keys.

---

## References

- **Transaction structure & the 1232-byte limit** — Solana docs:
  https://solana.com/docs/core/transactions/transaction-structure
- **`PACKET_DATA_SIZE = 1280 − 40 − 8`** — `@solana/web3.js` 1.98.4 source (public export).
- **`@solana/kit` size helpers** — `getTransactionSize` / `getTransactionSizeLimit` /
  `isTransactionWithinSizeLimit` / `assertIsTransactionWithinSizeLimit` (`@solana/transactions`
  7.0.0): https://www.solanakit.com/docs
- **`MAX_TX_ACCOUNT_LOCKS` 64 → 128 (v1.14.17)** — anza-xyz/solana-sdk `transaction/src/sanitized.rs`;
  forum note: https://forum.solana.com/t/feature-increased-tx-account-lock-limits-1-14-17/189
- **SIMD-0296 (Larger Transactions) / SIMD-0385 (transaction-v1)** — Review status, 4096 bytes, no
  ALTs: https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md
- **Related docs:** `address-lookup-tables.md` (fit-more #1) · `signing-and-assembly.md` (signature
  bytes) · `versioned-transactions.md` (legacy vs v0) · **`transaction-landing`** skill (confirmation).
</content>
</invoke>
