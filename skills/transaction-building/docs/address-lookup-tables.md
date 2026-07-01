# Address Lookup Tables (ALTs) — lifecycle deep dive

The long form of SKILL.md's **"Address Lookup Tables"** section. It covers *why* an ALT saves size,
the exact `AddressLookupTableProgram` API and its param shapes, the full
**create → extend → warm-up → use → deactivate → close** (or **freeze**) lifecycle with its real
timing constants, the true per-transaction account cap, and both the `@solana/web3.js` and
`@solana/kit` paths for reading, using, and managing tables.

Baseline client: **`@solana/web3.js` 1.98.4**. Kit path uses **`@solana/kit` 7.0.0** and, for
*managing* tables, **`@solana-program/address-lookup-table` 0.12.1**. Node 20+.

> ALTs only matter in the context of the 1232-byte limit and v0 transactions. This doc assumes you
> know the [legacy-vs-v0 formats](./versioned-transactions.md) and the
> [size limit](./transaction-size.md). The single copy-paste-runnable lifecycle script is
> [`../examples/lookup-table.ts`](../examples/lookup-table.ts) — this doc explains each phase; the
> example is the file you run.

---

## 1. What an ALT is and why it saves size

Every Solana transaction must list **every account it touches** in its message. In a legacy
(unversioned) transaction each account occupies a full **32-byte** public key in the message, and the
whole serialized packet must fit in **1232 bytes** (`PACKET_DATA_SIZE`). That effectively caps a legacy
transaction at ~**35 accounts** before it stops fitting.

An **Address Lookup Table (ALT / "lookup table" / "LUT")** is an on-chain account that stores a list of
up to **256** related addresses. Once stored, a **v0 (versioned) transaction** can reference any of
those addresses by its **1-byte index** into the table instead of embedding the 32-byte key.

> "This lookup method effectively 'compresses' a 32-byte address into a 1-byte index value."
> — Solana docs, *Advanced › Lookup Tables*

**Byte math.** Each account moved into a table and referenced by index saves `32 − 1 = 31` bytes in the
message (the 32-byte key is replaced by a 1-byte index; the table's own 32-byte address plus its lookup
metadata is amortized across every index it serves). That is what lets a v0 transaction reference far
more accounts — up to the runtime lock cap — while still fitting under 1232 bytes.

**Only these accounts are eligible.** ALTs move **non-signer, non-fee-payer, non-program** accounts to
1-byte indices. **Signers, the fee payer, and any account used as a program ID must stay in the static
keys** — they can never be sourced from a lookup table.

**Rules:**

- ALTs only work inside **v0 `VersionedTransaction`s**. A legacy `Transaction` cannot use lookups — the
  runtime only resolves table lookups for v0 messages. (You *can* create/extend a table using either
  legacy or v0 transactions; you can only *use* the addresses from a v0 tx.)
- A single v0 tx can reference **multiple** lookup tables: `compileToV0Message([alt1, alt2, ...])`.

---

## 2. The constants (source-verified)

| Constant | Value | Meaning |
|---|---|---|
| Max addresses per table | **256** (`LOOKUP_TABLE_MAX_ADDRESSES`) | hard cap on a single table's `addresses[]` |
| Addresses per `extend` ix | **~30** | bounded by the 1232-byte tx that carries the extend ix — loop to fill |
| Warm-up after create/extend | **1 slot** | a new table (and each newly added address) is usable only *next* slot |
| Deactivation cooldown before close | **513 slots** (`MAX_ENTRIES + 1`, `MAX_ENTRIES = 512`) | must elapse after `deactivate` before `close` |
| Table meta size | `LOOKUP_TABLE_META_SIZE = 56` bytes | fixed header before the address list |
| **Max account LOCKS per tx** | **128** (`MAX_TX_ACCOUNT_LOCKS = 128`) | **the true per-tx cap** on total distinct accounts |
| SVM max accounts per tx | `MAX_ACCOUNTS_PER_TRANSACTION = 256` | absolute SVM ceiling (rarely the binding limit) |
| Raw packet limit (context) | `PACKET_DATA_SIZE = 1232` bytes | the size budget ALTs help you stay under |
| Table index width | **1 byte** (u8) | why a 32-byte key compresses to 1 byte |

> **The real cap is 128, not 64.** Older docs still say ALTs "raise the limit to 64 addresses per
> transaction." **That figure is stale/conservative.** The real runtime cap is
> `MAX_TX_ACCOUNT_LOCKS = 128` distinct accounts *locked* per transaction — counting the static keys
> **plus** every address resolved from every referenced table. Design to **128**. Attaching more tables
> never raises this ceiling; it only helps you pack more of your ≤128 accounts under 1232 bytes.

---

## 3. `AddressLookupTableProgram` — the exact API

Program ID: **`AddressLookupTab1e1111111111111111111111111`**. Verified from `@solana/web3.js@1.98.4`.

```ts
declare class AddressLookupTableProgram {
  static programId: PublicKey;
  static createLookupTable(params: CreateLookupTableParams): [TransactionInstruction, PublicKey];
  static freezeLookupTable(params: FreezeLookupTableParams): TransactionInstruction;
  static extendLookupTable(params: ExtendLookupTableParams): TransactionInstruction;
  static deactivateLookupTable(params: DeactivateLookupTableParams): TransactionInstruction;
  static closeLookupTable(params: CloseLookupTableParams): TransactionInstruction;
}
```

> **`createLookupTable` returns a TUPLE** `[instruction, lookupTableAddress]`, not a bare instruction.
> Destructure both. The table address is a **PDA derived from `[authority, recentSlot]`**, which is why
> you pass a recent slot (§5).

**Param types (exact field names):**

```ts
type CreateLookupTableParams = {
  authority: PublicKey;         // account that controls the new table (must sign)
  payer: PublicKey;             // funds the new table account
  recentSlot: bigint | number;  // a recent slot; part of the PDA derivation
};
// createLookupTable RETURNS: [instruction, lookupTableAddress]

type ExtendLookupTableParams = {
  lookupTable: PublicKey;       // table to extend
  authority: PublicKey;         // current authority (must sign)
  payer?: PublicKey;            // funds the realloc; optional if already funded
  addresses: Array<PublicKey>;  // keys to append (~30 max per ix)
};

type DeactivateLookupTableParams = {
  lookupTable: PublicKey;
  authority: PublicKey;         // must sign
};

type CloseLookupTableParams = {
  lookupTable: PublicKey;
  authority: PublicKey;         // must sign
  recipient: PublicKey;         // receives the reclaimed rent lamports
};

type FreezeLookupTableParams = {
  lookupTable: PublicKey;
  authority: PublicKey;         // must sign
};
```

**The account you read back:**

```ts
type AddressLookupTableState = {
  deactivationSlot: bigint;          // u64::MAX while active
  lastExtendedSlot: number;
  lastExtendedSlotStartIndex: number;
  authority?: PublicKey;             // undefined once frozen
  addresses: Array<PublicKey>;       // the stored keys; array index = the on-wire lookup index
};
declare class AddressLookupTableAccount {
  key: PublicKey;
  state: AddressLookupTableState;
  constructor(args: { key: PublicKey; state: AddressLookupTableState });
  isActive(): boolean;
  static deserialize(accountData: Uint8Array): AddressLookupTableState;
}
```

**Fetch + compile:**

```ts
// Connection
getSlot(commitmentOrConfig?: Commitment | GetSlotConfig): Promise<number>;
getAddressLookupTable(
  accountKey: PublicKey,
  config?: GetAccountInfoConfig,
): Promise<RpcResponseAndContext<AddressLookupTableAccount | null>>; // read .value

// TransactionMessage
compileToV0Message(addressLookupTableAccounts?: AddressLookupTableAccount[]): MessageV0;
```

---

## 4. Lifecycle at a glance

```
create  ──►  [warm up 1 slot]  ──►  extend (repeat, ~30 keys/ix, +1-slot warm-up each)
   │                                        │
   │                                        ▼
   │                                   USE in v0 txns  (compileToV0Message([lut]) — indices resolve)
   ▼
deactivate  ──►  [cooldown ~513 slots]  ──►  close (reclaims rent to `recipient`)
                                   (or)  freeze  ──►  immutable forever (no extend / deactivate / close)
```

1. **Create** — `createLookupTable({authority, payer, recentSlot})` → `[instruction, lookupTableAddress]`.
   The address is a PDA of `[authority, recentSlot]`, so you must pass a genuinely recent slot. **Use
   `recentSlot: slot − 1`** (§5).
2. **Warm-up (1 slot)** — a newly created table, and any newly *extended* address, is **not usable until
   the next slot**. Referencing it in the same slot fails
   `Transaction address table lookup uses an invalid index`.
3. **Extend** — `extendLookupTable({lookupTable, authority, payer, addresses})`. Each extend ix rides in
   its own transaction, bounded by 1232 bytes → **~30 addresses per extend ix**; loop with multiple
   transactions to reach the **256** max.
4. **Use** — build a `TransactionMessage` and call `.compileToV0Message([altAccount, ...])`.
5. **Deactivate** — `deactivateLookupTable({lookupTable, authority})`. The table stays usable through a
   **cooldown of ~513 slots** (`remaining_blocks = MAX_ENTRIES + 1`, `MAX_ENTRIES = 512`). This window
   blocks a censorship trick where an authority deactivates-and-recreates within one slot.
6. **Close** — `closeLookupTable({lookupTable, authority, recipient})` reclaims rent. Closing before the
   cooldown elapses fails `Table cannot be closed until it's fully deactivated in N blocks`.
7. **Freeze (optional)** — `freezeLookupTable({lookupTable, authority})` makes the table **immutable**:
   it can no longer be extended, deactivated, or closed, and `state.authority` becomes `undefined`. Only
   freeze a table whose contents are final — **freezing is irreversible.**

---

## 5. Walking the lifecycle in code (`@solana/web3.js` 1.98.4)

Each phase is shown as a focused snippet; the complete single-file, copy-paste-runnable script is
[`../examples/lookup-table.ts`](../examples/lookup-table.ts).

### Create + extend

```ts
import {
  AddressLookupTableProgram, SystemProgram, PublicKey,
} from "@solana/web3.js";

// 1. CREATE — recentSlot MUST be recent; slot-1 avoids "is not a recent slot"
const slot = await connection.getSlot();
const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
  authority: payer.publicKey,
  payer: payer.publicKey,
  recentSlot: slot - 1,          // ← the slot-1 gotcha (below)
});

// 2. EXTEND — append up to ~30 non-signer keys per ix (loop for more, up to 256 total)
const addresses: PublicKey[] = [
  SystemProgram.programId,
  // ...more accounts you touch repeatedly. DEDUPE. Do NOT include signers/fee-payer/program-of-record
  // if you want them index-resolved — they must stay in static keys anyway.
];
const extendIx = AddressLookupTableProgram.extendLookupTable({
  lookupTable: lookupTableAddress,
  authority: payer.publicKey,
  payer: payer.publicKey,
  addresses,
});
// Send [createIx, extendIx] together (both fit here) with a normal v0 tx — the table isn't warm yet,
// so DO NOT attach it to compileToV0Message on this transaction.
```

> **The `recentSlot: slot − 1` gotcha.** The table address is a PDA of `[authority, recentSlot]`.
> Passing the *absolute latest* `getSlot()` intermittently fails with `<slot> is not a recent slot`,
> because the leader may be a slot behind the RPC node you read from. Always pass `slot − 1`.

### Warm-up wait

```ts
// 3. WARM-UP — wait at least one slot before using the table (or newly added addresses)
const start = await connection.getSlot();
while ((await connection.getSlot()) <= start) {
  await new Promise((r) => setTimeout(r, 400)); // ~1 slot at mainnet cadence
}
```

### Fetch + use

```ts
// 4. FETCH — read .value; it's null until the create tx has propagated to this RPC
const lut = (await connection.getAddressLookupTable(lookupTableAddress)).value;
if (!lut) throw new Error("LUT not found / not yet propagated");
console.log("stored addresses:", lut.state.addresses.map((a) => a.toBase58()));

// 5. USE — pass the AddressLookupTableAccount(s) to compileToV0Message
const { blockhash } = await connection.getLatestBlockhash();
const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [/* ... your instructions touching accounts stored in the table ... */],
}).compileToV0Message([lut]);   // ← the array of tables

const vtx = new VersionedTransaction(messageV0);
vtx.sign([payer]);              // v0 must be pre-signed (array arg)
```

### Prove the savings

Because `VersionedTransaction.serialize()` does **not** throw on oversize (see
[`transaction-size.md`](./transaction-size.md)), measure explicitly — and compile the *same*
instructions with and without `[lut]` to see the byte delta:

```ts
const withoutAlt = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions })
  .compileToV0Message();          // no tables
const withAlt = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions })
  .compileToV0Message([lut]);     // tables attached
console.log(
  "saved bytes:",
  new VersionedTransaction(withoutAlt).serialize().length -
  new VersionedTransaction(withAlt).serialize().length,
); // ≈ 31 × (number of accounts moved into the table)
```

### Deactivate → cooldown → close

```ts
// DEACTIVATE
const deactivateIx = AddressLookupTableProgram.deactivateLookupTable({
  lookupTable: lookupTableAddress,
  authority: payer.publicKey,
});
// ...send it...

// ...wait ~513 slots (~3–4 min on mainnet at ~400ms/slot). Poll until:
//    currentSlot - Number(lut.state.deactivationSlot) > 513

// CLOSE — reclaim rent to `recipient`
const closeIx = AddressLookupTableProgram.closeLookupTable({
  lookupTable: lookupTableAddress,
  authority: payer.publicKey,
  recipient: payer.publicKey,
});
// ...send it...
```

---

## 6. The `@solana/kit` 7.0.0 path

Kit splits the concern into two independent pieces. Keep them separate:

### A. Read + use existing tables — **no extra dependency**

Reading a table and compressing a v0 message needs only `@solana/kit` itself — no
`@solana-program/address-lookup-table`, so **no peer-dep skew**. Kit exposes an RPC helper to build the
lookup map and a compile-time primitive to rewrite eligible accounts into lookups:

```ts
import {
  pipe, address,
  createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables, fetchAddressesForLookupTables,
  signTransactionMessageWithSigners,
  type AddressesByLookupTableAddress,
} from "@solana/kit"; // 7.0.0

const lut = address("4QwSwNriKPrz8DLW4ju5uxC2TN5cksJx6tPUPj7DGLAW");

// Build { [lutAddress]: Address[] } straight from the RPC (batched getMultipleAccounts)
const addressesByLut: AddressesByLookupTableAddress = await fetchAddressesForLookupTables([lut], rpc);

const compressed = pipe(
  createTransactionMessage({ version: 0 }),
  m => setTransactionMessageFeePayerSigner(feePayer, m),
  m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  m => appendTransactionMessageInstructions(manyIxs, m),
  m => compressTransactionMessageUsingAddressLookupTables(m, addressesByLut), // ← (message, map)
);
const signed = await signTransactionMessageWithSigners(compressed);
```

> **`compressTransactionMessageUsingAddressLookupTables(message, map)` takes the message FIRST** — the
> opposite of most value-first APIs, and easy to swap by mistake. Only **v0** messages can be compressed
> (the type is `TransactionMessageNotLegacy`); passing a legacy message is a type error. Only non-signer
> accounts get moved into a lookup — the fee payer and any signer stay inline automatically.

To inspect someone else's compiled v0 message,
`decompileTransactionMessageFetchingLookupTables(compiledMessage, rpc)` rebuilds a full
`TransactionMessage`, fetching any referenced tables for you.

### B. Create / extend / manage tables — `@solana-program/address-lookup-table` 0.12.1

The Codama-generated client provides the instruction builders and the PDA/account helpers. Verified
exports:

```ts
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,        // Address<"AddressLookupTab1e1111111111111111111111111">
  findAddressLookupTablePda,                   // PDA of [authority, recentSlot]
  getCreateLookupTableInstructionAsync,        // async: derives the PDA for you
  getCreateLookupTableInstruction,             // sync: you pass the derived address
  getExtendLookupTableInstruction,
  getDeactivateLookupTableInstruction,
  getCloseLookupTableInstruction,
  getFreezeLookupTableInstruction,
  fetchAddressLookupTable,                     // -> Account<AddressLookupTable> (data under .data)
  fetchMaybeAddressLookupTable,
} from "@solana-program/address-lookup-table"; // 0.12.1

const { value: recentSlot } = await rpc.getSlot({ commitment: "finalized" }).send();
const [lutAddress] = await findAddressLookupTablePda({ authority: authority.address, recentSlot });

const createIx = await getCreateLookupTableInstructionAsync({ authority, payer: authority, recentSlot });
const extendIx = getExtendLookupTableInstruction({
  address: lutAddress, authority, payer: authority,
  addresses: [addrA, addrB /* ... up to 256 total, ~30 per ix */],
});

// Reading a single table's addresses (Codama wraps decoded data under .data):
const { data: { addresses } } = await fetchAddressLookupTable(rpc, lutAddress); // addresses: Address[]
```

> **Peer-skew caveat (time-sensitive — re-verify at build time).**
> `@solana-program/address-lookup-table@0.12.1` declares `peerDependencies: { "@solana/kit": "^6.4.0" }`.
> Installed alongside **kit 7.0.0** it emits an unmet-peer-dependency / `ERESOLVE` warning. It works at
> runtime (the codecs are ABI-stable and it only imports stable kit primitives), but to install cleanly
> either run `npm i --legacy-peer-deps`, or pin `@solana/kit` to `^6.4.0` for this package, or **avoid
> the dependency entirely for the read/compress path** by using kit-native `fetchAddressesForLookupTables`
> (path A) — that has no skew. A 0.12.2+/0.13 widening the range to `^7` is likely imminent; re-check with
> `npm view @solana-program/address-lookup-table peerDependencies` before you build.

---

## 7. Guidelines (DO / DON'T)

**DO**

- **DO** reuse a long-lived, shared ALT for accounts you touch repeatedly (your program IDs, the token /
  ATA programs, well-known mints, market accounts). Rent is paid once; every future tx benefits.
- **DO** `getSlot()` and pass `recentSlot: slot − 1` to `createLookupTable`.
- **DO** wait **≥1 slot** after create/extend before referencing the table (warm-up).
- **DO** dedupe addresses before extending — duplicates waste table space and rent.
- **DO** measure with `serialize().length` (web3.js) or `isTransactionWithinSizeLimit` (kit) to confirm
  you land under **1232** bytes, and compare with/without `[lut]` to prove the savings.

**DON'T**

- **DON'T** put **signers, the fee payer, or program IDs** in a table expecting index resolution — those
  must stay in static keys.
- **DON'T** use a table (or a just-extended address) in the **same slot** you created/extended it.
- **DON'T** `close` before the **~513-slot cooldown** finishes after `deactivate`.
- **DON'T** `freeze` unless the contents are final — freezing is **irreversible** (no extend / deactivate
  / close ever again).
- **DON'T** exceed **256** addresses per table, or **~30** per single `extend` instruction.
- **DON'T** expect a v0 tx to reference more than **128** distinct accounts total (`MAX_TX_ACCOUNT_LOCKS`),
  no matter how many tables you attach.

## 8. Common Errors

### Error: `<slot> is not a recent slot`
**Cause:** the `recentSlot` passed to `createLookupTable` is ahead of the leader's view (you used the
absolute latest `getSlot()`).
**Solution:** use `recentSlot: slot − 1`.

### Error: `Transaction address table lookup uses an invalid index`
**Cause:** using the table (or a just-extended address) before its 1-slot warm-up completed, or an index
past `state.addresses.length`.
**Solution:** wait ≥1 slot after create/extend; re-`getAddressLookupTable` and verify the address is
present before referencing it.

### Error: `Table cannot be closed until it's fully deactivated in N blocks`
**Cause:** calling `closeLookupTable` before the ~513-slot cooldown after `deactivate`.
**Solution:** poll `getSlot()` until `currentSlot − Number(state.deactivationSlot) > 513`, then close.

### Error: `Transaction too large` / packet exceeds 1232 bytes
**Cause:** too many static account keys. (Legacy throws locally; v0 is silently rejected on send —
measure yourself.)
**Solution:** move non-signer accounts into an ALT and `compileToV0Message([alt])` (~31 bytes saved per
moved key); also dedupe, split the tx, or shorten instruction data. See
[`transaction-size.md`](./transaction-size.md).

### Error: `getAddressLookupTable(...).value === null`
**Cause:** the create tx hasn't propagated to the RPC you're reading, or you have the wrong address.
**Solution:** confirm the create tx first, then fetch; on a fresh table allow for propagation delay, and
double-check the destructured `lookupTableAddress` from the create tuple.

### Error (kit install): `ERESOLVE` / unmet peer `@solana/kit`
**Cause:** `@solana-program/address-lookup-table@0.12.1` pins `@solana/kit ^6.4.0` but you have kit 7.
**Solution:** `npm i --legacy-peer-deps`, or pin kit `^6.4.0` for that package, or use kit-native
`fetchAddressesForLookupTables` (no dependency) for the read/compress path. Re-verify the peer range at
build time.

More cross-cutting build errors are catalogued in [`troubleshooting.md`](./troubleshooting.md).

## References

- **Address Lookup Tables** — Solana docs, *Advanced › Lookup Tables* (create/extend/use, "compresses
  32-byte → 1-byte index", 256/table, v0-only): https://solana.com/docs/advanced/lookup-tables
- **`recentSlot: slot − 1`, ~30/extend, 1-slot warm-up, ~513-slot cooldown** — Solana developer-content
  course, *Program Optimization › Lookup Tables*:
  https://github.com/solana-foundation/developer-content/blob/main/content/courses/program-optimization/lookup-tables.md
- **`LOOKUP_TABLE_MAX_ADDRESSES = 256`, `LOOKUP_TABLE_META_SIZE = 56`, cooldown `MAX_ENTRIES + 1`** —
  anza-xyz/solana-sdk `address-lookup-table-interface/src/state.rs`
- **`MAX_TX_ACCOUNT_LOCKS = 128`** (the true per-tx account cap; supersedes the docs' stale "64") —
  anza-xyz/solana-sdk `transaction/src/sanitized.rs`
- **`@solana/kit` 7.0.0** (`fetchAddressesForLookupTables`, `compressTransactionMessageUsingAddressLookupTables`) —
  https://www.solanakit.com/docs/advanced-guides/transactions
- **`@solana-program/address-lookup-table` 0.12.1** (kit codama client; note the `^6.4.0` peer range) —
  https://www.npmjs.com/package/@solana-program/address-lookup-table
- **Related docs:** [`versioned-transactions.md`](./versioned-transactions.md) ·
  [`transaction-size.md`](./transaction-size.md) · [`troubleshooting.md`](./troubleshooting.md) ·
  runnable script [`../examples/lookup-table.ts`](../examples/lookup-table.ts). **Related skills:**
  [`transaction-landing`](../../transaction-landing/SKILL.md).
</content>
