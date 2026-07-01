# Legacy `Transaction` vs versioned `VersionedTransaction` (v0)

The long form of SKILL.md's **"Legacy vs Versioned (v0)"** and **"Build a v0 transaction"**
sections. It documents the *complete* `@solana/web3.js` 1.98.4 API for both formats, dissects the
`MessageV0` wire anatomy, gives the exact `legacy → v0` migration checklist (and the reverse
inspect/decompile recipe), and explains wallet-version gating and the forthcoming (not-yet-activated)
transaction v1.

Baseline client: **`@solana/web3.js` 1.98.4**. Kit equivalents use **`@solana/kit` 7.0.0**. Node 20+.

> This doc is about the two **formats** and how to move between them. It does **not** re-derive the
> 1232-byte size limit (see [`transaction-size.md`](./transaction-size.md)), the Address Lookup Table
> lifecycle (see [`address-lookup-tables.md`](./address-lookup-tables.md)), or the positional signing
> model (see [`signing-and-assembly.md`](./signing-and-assembly.md)). Getting a built transaction
> **landed** — priority fees, retries, confirmation — is the
> [`transaction-landing`](../../transaction-landing/SKILL.md) skill.

---

## 1. The one-line summary

`@solana/web3.js` 1.98.4 has exactly **two** transaction formats and knows exactly **two** versions:

```ts
type TransactionVersion = 'legacy' | 0;   // web3.js v1 knows ONLY these two — there is no `1` here
```

- **`Transaction`** — the original *unversioned* ("legacy") format. A mutable builder. No Address
  Lookup Tables.
- **`VersionedTransaction`** — the versioned wire format. In web3.js v1 the only meaningful version
  is **0**, which unlocks Address Lookup Tables. You do not build it from instructions directly — you
  compile a `TransactionMessage` into a `MessageV0`, then wrap it.

**Default to v0 for app code.** A v0 transaction with zero `addressTableLookups` is functionally the
legacy transaction plus a single 1-byte version prefix — it is a strict superset. Reach for legacy
only for trivial one-off scripts or absolute-maximum wallet reach (§6).

---

## 2. Legacy `Transaction` — the full API

The original, unversioned format: a mutable builder object; no lookup tables; still fully supported.

```ts
declare class Transaction {
  // ── mutable fields ──────────────────────────────────────────────────────
  signatures: Array<SignaturePubkeyPair>;   // { signature: Buffer | null; publicKey: PublicKey }[]
  get signature(): Buffer | null;           // the FIRST (fee-payer) signature = the transaction id
  feePayer?: PublicKey;                      // if unset, the first signer becomes fee payer
  instructions: Array<TransactionInstruction>;
  recentBlockhash?: Blockhash;              // string; set before signing
  lastValidBlockHeight?: number;
  nonceInfo?: NonceInformation;             // durable-nonce lifetime instead of a blockhash
  minNonceContextSlot?: number;

  // ── constructors (overloaded) ─────────────────────────────────────────────
  constructor(opts?: TransactionBlockhashCtor);        // { blockhash, lastValidBlockHeight, feePayer? }  ← RECOMMENDED
  constructor(opts?: TransactionNonceCtor);            // { nonceInfo, minContextSlot, feePayer? }
  constructor(opts?: TransactionCtorFields_DEPRECATED);// { recentBlockhash?, feePayer?, ... }  @deprecated

  // ── build ─────────────────────────────────────────────────────────────
  add(...items: Array<Transaction | TransactionInstruction | TransactionInstructionCtorFields>): Transaction; // VARIADIC + chainable
  compileMessage(): Message;                // -> legacy Message
  serializeMessage(): Buffer;               // the message bytes that get signed

  // ── sign (all VARIADIC) ────────────────────────────────────────────────────
  sign(...signers: Array<Signer>): void;        // (re)builds the sig list, signs all provided
  partialSign(...signers: Array<Signer>): void; // fills only the given slots (offline/multisig)
  addSignature(pubkey: PublicKey, signature: Buffer): void; // inject an external/HW signature (64 bytes)
  verifySignatures(requireAllSignatures?: boolean): boolean;
  setSigners(...signers: Array<PublicKey>): void; // @deprecated — only the fee payer is needed

  // ── serialize / parse ──────────────────────────────────────────────────────
  serialize(config?: SerializeConfig): Buffer;  // { requireAllSignatures?: boolean; verifySignatures?: boolean }
  getEstimatedFee(connection: Connection): Promise<number | null>;
  static from(buffer: Buffer | Uint8Array | Array<number>): Transaction;  // parse wire bytes
  static populate(message: Message, signatures?: Array<string>): Transaction; // from message + base58 sigs
}
```

### Constructing a legacy transaction

The constructor is overloaded; the **recommended** shape bakes the blockhash lifetime in
(`TransactionBlockhashCtor`):

```ts
// Preferred: blockhash lifetime baked in at construction
const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });

// Or: construct empty, then set fields imperatively
const tx = new Transaction();
tx.feePayer = payer.publicKey;
tx.recentBlockhash = blockhash;
tx.add(ix1, ix2);   // .add(...) is variadic + chainable
```

### The canonical simple legacy flow

`sendAndConfirmTransaction` is the one-call ergonomic path — it sets `recentBlockhash` for you, signs
with the `signers` you pass (fee payer first), sends, and confirms:

```ts
import {
  Connection, Keypair, SystemProgram, Transaction,
  sendAndConfirmTransaction, clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const payer = Keypair.generate();          // fund on devnet first
const to    = Keypair.generate();

const tx = new Transaction().add(          // .add(...) is variadic + chainable
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to.publicKey, lamports: 1_000 }),
);
const sig = await sendAndConfirmTransaction(connection, tx, [payer]); // signers, fee payer first
```

**`sendAndConfirmTransaction` is typed to a legacy `Transaction` only** — there is **no
`VersionedTransaction` overload:**

```ts
function sendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction,               // ← legacy only
  signers: Array<Signer>,
  options?: ConfirmOptions & Readonly<{ abortSignal?: AbortSignal }>,
): Promise<TransactionSignature>;
```

For a `VersionedTransaction` you **pre-sign, then** `connection.sendTransaction(vtx)` +
`connection.confirmTransaction(...)`, or `sendAndConfirmRawTransaction(connection, vtx.serialize())`
(§3).

### When legacy is still fine

- Simple transactions with **few accounts** (well under the ~35-static-key / 1232-byte ceiling — see
  [`transaction-size.md`](./transaction-size.md)) and **no Address Lookup Tables** (legacy cannot use
  ALTs; see [`address-lookup-tables.md`](./address-lookup-tables.md)).
- **Maximum wallet compatibility.** Every wallet signs legacy; some older adapters do **not** advertise
  v0 support (§6).
- Quick scripts where `sendAndConfirmTransaction(conn, tx, signers)` ergonomics win.

Everything else — ALTs, many accounts, future-proofing — prefers v0 (§3).

---

## 3. `VersionedTransaction` + `TransactionMessage` — the full API

You build v0 in two steps: (A) build a `TransactionMessage` and compile it to a `MessageV0`, then
(B) wrap that message in a `VersionedTransaction`, sign, and serialize.

```ts
// Step A — build the message (a mutable args object → an immutable compiled message)
type TransactionMessageArgs = {
  payerKey: PublicKey;
  instructions: Array<TransactionInstruction>;
  recentBlockhash: Blockhash;
};
declare class TransactionMessage {
  payerKey: PublicKey;
  instructions: Array<TransactionInstruction>;
  recentBlockhash: Blockhash;
  constructor(args: TransactionMessageArgs);
  compileToLegacyMessage(): Message;                                                     // -> legacy Message
  compileToV0Message(addressLookupTableAccounts?: AddressLookupTableAccount[]): MessageV0; // -> v0
  static decompile(message: VersionedMessage, args?: DecompileArgs): TransactionMessage;   // reverse (§8)
}
// DecompileArgs = { accountKeysFromLookups } | { addressLookupTableAccounts }

// Step B — wrap + sign + serialize
declare class VersionedTransaction {
  signatures: Array<Uint8Array>;          // 64-byte slots, positional, zero-filled until signed
  message: VersionedMessage;              // Message | MessageV0
  get version(): TransactionVersion;      // reads the message's version getter
  constructor(message: VersionedMessage, signatures?: Array<Uint8Array>);
  sign(signers: Array<Signer>): void;     // ← ARRAY arg (NOT variadic!). Fills matching slots.
  addSignature(publicKey: PublicKey, signature: Uint8Array): void; // inject external/HW sig (64 bytes)
  serialize(): Uint8Array;                // wire bytes — does NOT throw on >1232 (see transaction-size.md)
  static deserialize(serializedTransaction: Uint8Array): VersionedTransaction;
}
```

### The canonical v0 flow

```ts
import {
  Connection, Keypair, SystemProgram, TransactionMessage,
  VersionedTransaction, clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const payer = Keypair.generate();
const { blockhash } = await connection.getLatestBlockhash();

const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,             // fee payer → forced to account index 0
  recentBlockhash: blockhash,            // the transaction's lifetime
  instructions: [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
  ],
}).compileToV0Message();                 // pass [alt1, alt2] here to use ALTs (address-lookup-tables.md)

const vtx = new VersionedTransaction(messageV0);
vtx.sign([payer]);                        // ← ARRAY. MUST pre-sign before sending.
const txid = await connection.sendTransaction(vtx); // ← NO signers arg (versioned overload)
await connection.confirmTransaction(txid, "confirmed");
```

### The two `connection.sendTransaction` overloads (a real footgun)

```ts
// legacy — signs for you (DEPRECATED: "Instead, call sendTransaction with a VersionedTransaction")
sendTransaction(transaction: Transaction, signers: Array<Signer>, options?: SendOptions): Promise<TransactionSignature>;
// versioned — send an ALREADY-SIGNED tx (there is NO signers parameter)
sendTransaction(transaction: VersionedTransaction, options?: SendOptions): Promise<TransactionSignature>;
```

The official docs spell out the gotcha verbatim:

> "Unlike `legacy` transactions, sending a `VersionedTransaction` via `sendTransaction` does **NOT**
> support transaction signing via passing in an array of `Signers` as the second parameter. You will
> need to sign the transaction before calling `connection.sendTransaction()`."
> — Solana developer-content, *Advanced › Versions*

Two ways this bites:

1. **Wrong `sign` shape.** Legacy `tx.sign(a, b)` / `tx.partialSign(a, b)` / `tx.add(a, b)` are
   **variadic**; `vtx.sign([a, b])` takes an **array**. Calling `vtx.sign(a, b)` silently mis-invokes.
2. **Passing signers to the versioned send.** `connection.sendTransaction(vtx, [signers])` is a type
   error (the versioned overload has no signers arg), and forgetting to sign at all sends an unsigned
   packet that never lands. Always `vtx.sign([...])` first.

> **`vtx.sign([...])` replaces existing signatures.** The docs warn "all the previous transaction
> `signatures` will be fully replaced." For incremental / multisig signing, sign each party separately
> and rely on positional slots, or use `addSignature` — see
> [`signing-and-assembly.md`](./signing-and-assembly.md).

---

## 4. `MessageV0` anatomy — what a v0 wire message actually is

`VersionedMessage = Message | MessageV0`. `TransactionMessage.compileToV0Message()` produces a
`MessageV0`:

```ts
declare class MessageV0 {
  header: MessageHeader;                                  // see below
  staticAccountKeys: Array<PublicKey>;                   // keys embedded inline (NOT from tables)
  recentBlockhash: Blockhash;                            // or the nonce value for durable-nonce txs
  compiledInstructions: Array<MessageCompiledInstruction>;
  addressTableLookups: Array<MessageAddressTableLookup>; // the ALT references (empty if no ALTs)
  constructor(args: MessageV0Args);
  get version(): 0;
  get numAccountKeysFromLookups(): number;               // count of keys resolved via tables
  getAccountKeys(args?: GetAccountKeysArgs): MessageAccountKeys; // resolve static + looked-up keys
  isAccountSigner(index: number): boolean;
  isAccountWritable(index: number): boolean;
  resolveAddressTableLookups(alts: AddressLookupTableAccount[]): AccountKeysFromLookups;
  static compile(args: CompileV0Args): MessageV0;        // { payerKey, instructions, recentBlockhash, addressLookupTableAccounts? }
  serialize(): Uint8Array;                               // NOTE: writes into a 1232-byte buffer
  static deserialize(serializedMessage: Uint8Array): MessageV0;
}
```

**The exact sub-types:**

```ts
type MessageHeader = {
  numRequiredSignatures: number;       // = signatures array length; asserted < 128 (high bit reserved)
  numReadonlySignedAccounts: number;   // of the signer keys, how many are read-only
  numReadonlyUnsignedAccounts: number; // of the non-signer static keys, how many are read-only
};
type MessageCompiledInstruction = {
  programIdIndex: number;              // index into the resolved account keys
  accountKeyIndexes: number[];         // ordered indices of the accounts passed to the program
  data: Uint8Array;                    // raw instruction data
};
type MessageAddressTableLookup = {
  accountKey: PublicKey;               // the ALT account's address (32 bytes on the wire)
  writableIndexes: number[];           // table indices resolved as WRITABLE
  readonlyIndexes: number[];           // table indices resolved as READ-ONLY
};
```

> **Legacy and v0 compiled-instruction shapes differ — do not assume they interchange.** The legacy
> `Message` uses `CompiledInstruction = { programIdIndex; accounts: number[]; data: string /* base58 */ }`,
> whereas `MessageV0` uses `MessageCompiledInstruction = { programIdIndex; accountKeyIndexes: number[];
> data: Uint8Array }`. Different field names (`accounts` vs `accountKeyIndexes`) **and** different data
> encoding (base58 string vs raw bytes) when you introspect a message.

### Resolving the complete account-key list

A v0 message's `staticAccountKeys` are only the **inline** keys — signers, the fee payer, program IDs,
and any account not sourced from a table. The rest live in the referenced tables. To get the
**complete, ordered** key list you must pass the tables:

```ts
type GetAccountKeysArgs =
  | { accountKeysFromLookups?: AccountKeysFromLookups | null }          // pre-resolved
  | { addressLookupTableAccounts?: AddressLookupTableAccount[] | null };// let the message resolve
type AccountKeysFromLookups = { writable: PublicKey[]; readonly: PublicKey[] }; // = LoadedAddresses

const keys = messageV0.getAccountKeys({ addressLookupTableAccounts: [lut1, lut2] });
// keys: MessageAccountKeys  ->  keys.get(i), keys.length, keys.keySegments()
```

**The ordering rule for the resolved keys** (matters when you read `programIdIndex` /
`accountKeyIndexes`):

```
[ ...staticAccountKeys, ...writableFromLookups, ...readonlyFromLookups ]
```

Static keys (signers + fee payer + program IDs + any non-table account) come first; then writable
keys drawn from tables, then readonly keys drawn from tables. **Signers, the fee payer, and any account
used as a program ID are always in `staticAccountKeys`** — they can never be sourced from a table (see
[`address-lookup-tables.md`](./address-lookup-tables.md)).

### The version-prefix byte (how the wire distinguishes legacy from versioned)

Verified from the shipped `1.98.4` source:

- `VERSION_PREFIX_MASK = 0x7f` (127). `MESSAGE_VERSION_0_PREFIX = 1 << 7 = 0x80` (128).
- A **v0** message serializes with a leading prefix byte of `0x80 | version` → **`0x80`** for v0.
- A **legacy** message has **no** prefix byte; its first byte is `header.numRequiredSignatures`, which
  the compiler asserts is `< 128` (`numRequiredSignatures === (numRequiredSignatures & 0x7f)`), so the
  high bit is guaranteed unset. That is exactly how deserialization disambiguates the two:

```ts
// VersionedMessage helpers (a const object on the exported symbol)
VersionedMessage.deserializeMessageVersion(bytes): "legacy" | number; // 'legacy' if high bit unset, else prefix & 0x7f
VersionedMessage.deserialize(bytes): VersionedMessage;                 // -> Message | MessageV0
// Internally: maskedPrefix = prefix & 0x7f; if (maskedPrefix === prefix) => legacy; else version = maskedPrefix.
```

> **Size buffers differ, so only the message throws on oversize.** `MessageV0.serialize()` writes into
> a 1232-byte (`PACKET_DATA_SIZE`) scratch buffer, so an oversized v0 *message* overflows at serialize
> time — but `VersionedTransaction.serialize()` uses a larger buffer and will **not** throw on >1232.
> Always measure the transaction yourself. Full size behavior:
> [`transaction-size.md`](./transaction-size.md).

---

## 5. Decision table — legacy vs v0

| Dimension | Legacy `Transaction` | v0 `VersionedTransaction` |
|---|---|---|
| Address Lookup Tables | **No** (runtime ignores lookups for legacy) | **Yes** — the whole point (`compileToV0Message([alt])`) |
| Practical account ceiling | ~**35** static keys (1232 B) | up to **128** locked accounts via ALTs (`MAX_TX_ACCOUNT_LOCKS`) |
| Build path | `new Transaction().add(...ixs)` (mutable) | `new TransactionMessage({...}).compileToV0Message()` → wrap |
| Sign call | `tx.sign(...signers)` **(variadic)** | `vtx.sign([signers])` **(array)** |
| One-shot send+confirm | `sendAndConfirmTransaction(conn, tx, signers)` | none — pre-sign, `sendTransaction(vtx)` + `confirmTransaction` |
| `sendTransaction` signers arg | yes (deprecated overload) | **no** — must be pre-signed |
| Signatures field | `SignaturePubkeyPair[]` (`{signature, publicKey}`) | `Uint8Array[]` (positional 64-byte slots) |
| `serialize()` on oversize | **throws** `Transaction too large` | **silently returns** — measure yourself |
| Wallet support | universal | **gated** — some wallets lack v0 (§6) |
| Wire prefix | first byte < 128 (no prefix) | first byte `0x80` |
| Recommended for | tiny txs, max compat, quick scripts | anything with many accounts / ALTs / future-proofing |

**Rule of thumb:** default to **v0** for app code (it is a strict superset — a v0 tx with zero
`addressTableLookups` is the legacy tx plus a 1-byte prefix); reach for **legacy** only for maximum
wallet reach or trivial one-off scripts.

---

## 6. `supportedTransactionVersions` — wallet/adapter gating

Not every wallet signs v0. Before sending a `VersionedTransaction` through a connected wallet, gate on
the adapter's advertised capability set (`Set<TransactionVersion> | undefined`):

```ts
// from @solana/wallet-adapter-react useWallet()
const supported = wallet?.adapter.supportedTransactionVersions; // Set<TransactionVersion> | undefined
if (!supported)        throw new Error("Wallet supports legacy transactions only");
if (!supported.has(0)) throw new Error("Wallet does not support v0 transactions");
// safe to send a VersionedTransaction; otherwise fall back to a legacy Transaction
```

- `supportedTransactionVersions === undefined` → treat as **legacy-only** (older adapter contract).
- `supportedTransactionVersions.has(0)` → v0 is safe.
- The full pattern — feature detection, `sendTransaction` from the adapter, `minContextSlot`, and legacy
  fallback — lives in the [`wallet-adapter`](../../wallet-adapter/SKILL.md) skill's
  [`sending-transactions.md`](../../wallet-adapter/docs/sending-transactions.md).

---

## 7. Recipe: migrate a legacy `Transaction` → v0

The instruction objects are **identical** (`TransactionInstruction[]`); only the assembly changes.

```ts
import { Connection, TransactionMessage, VersionedTransaction, clusterApiUrl } from "@solana/web3.js";

// ── BEFORE (legacy) ──────────────────────────────────────────────────────────
// const tx = new Transaction().add(ix1, ix2);
// tx.feePayer = payer.publicKey;
// tx.recentBlockhash = blockhash;
// tx.sign(payer);                       // variadic
// await connection.sendRawTransaction(tx.serialize());

// ── AFTER (v0) ────────────────────────────────────────────────────────────────
const instructions = [ix1, ix2];         // ← reuse the exact same TransactionInstruction[]
const { blockhash } = await connection.getLatestBlockhash();

const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,             // was tx.feePayer
  recentBlockhash: blockhash,            // was tx.recentBlockhash
  instructions,                          // was tx.add(...)
}).compileToV0Message(/* optional: [lookupTableAccount, ...] */);

const vtx = new VersionedTransaction(messageV0);
vtx.sign([payer]);                       // ← now an ARRAY
const sig = await connection.sendTransaction(vtx); // ← no signers arg (pre-signed)
await connection.confirmTransaction(sig, "confirmed");
```

**Migration checklist — the only things that change:**

1. `tx.feePayer` → `TransactionMessage.payerKey`.
2. `tx.recentBlockhash` → `TransactionMessage.recentBlockhash`.
3. `tx.add(a, b)` → `instructions: [a, b]`.
4. `.compileToV0Message()` → wrap in `new VersionedTransaction(msg)`.
5. `tx.sign(a, b)` **(variadic)** → `vtx.sign([a, b])` **(array)**.
6. `sendAndConfirmTransaction(conn, tx, [a])` → pre-sign, then `sendTransaction(vtx)` + `confirmTransaction`.
7. Add ALT accounts by passing `[alt]` to `compileToV0Message` (see
   [`address-lookup-tables.md`](./address-lookup-tables.md)).

The runnable, self-contained form of this recipe is
[`../examples/build-v0-transaction.ts`](../examples/build-v0-transaction.ts).

---

## 8. Recipe: read / inspect a serialized v0 transaction (the reverse)

```ts
// Deserialize wire bytes back into a VersionedTransaction
const vtx = VersionedTransaction.deserialize(wireBytes);
console.log(vtx.version);                          // 0
const msg = vtx.message as MessageV0;              // header, staticAccountKeys, addressTableLookups, ...

// Resolve the FULL, ordered account-key list (fetch any referenced tables first)
const luts = await Promise.all(
  msg.addressTableLookups.map(l =>
    connection.getAddressLookupTable(l.accountKey).then(r => r.value!),
  ),
);
const keys = msg.getAccountKeys({ addressLookupTableAccounts: luts }); // MessageAccountKeys
for (const ci of msg.compiledInstructions) {
  const programId = keys.get(ci.programIdIndex);
  const accounts  = ci.accountKeyIndexes.map(i => keys.get(i));
  // ci.data is a Uint8Array
}

// Or convert all the way back to editable instructions:
const editable = TransactionMessage.decompile(msg, { addressLookupTableAccounts: luts });
// editable.instructions is a fresh TransactionInstruction[] (payerKey/recentBlockhash preserved)
```

`TransactionMessage.decompile(message, args?)` is the inverse of `compileToV0Message` — it rebuilds a
mutable `TransactionMessage` (with resolved `TransactionInstruction[]`) from a compiled message, using
either pre-resolved `accountKeysFromLookups` or the `addressLookupTableAccounts` you fetched.

> **If a v0 tx references ALTs, you MUST pass the tables** to `getAccountKeys(...)` /
> `TransactionMessage.decompile(...)`. Omitting them leaves the looked-up keys unresolved and the code
> throws when it tries to `.get()` an index past `staticAccountKeys.length`.

---

## 9. Forward-looking: transaction v1 (4096 bytes) — not activated, do not build on it yet

A new **transaction v1** format (SIMD-0296 "Larger Transactions" + SIMD-0385 "transaction-v1") raises
the size limit to **4096 bytes** and moves priority-fee / compute-unit configuration into native message
fields instead of separate ComputeBudget instructions. Three things to know:

- **It is `Review` status and NOT activated on mainnet-beta.** Do not target it in production.
- **It does not support Address Lookup Tables.** ALTs remain a v0-only feature; v1 relies purely on its
  larger packet, not on key compression.
- **`@solana/web3.js` 1.98.4 has no v1 at all** (`TransactionVersion = 'legacy' | 0`). `@solana/kit`
  7.0.0 ships the plumbing (`TransactionVersion` includes `1`, `V1_TRANSACTION_SIZE_LIMIT = 4096`), but
  `createTransactionMessage` accepts only `Exclude<TransactionVersion, 1>` = `'legacy' | 0` — you cannot
  build a v1 message with the public constructor today.

**Target v0.** More on the v1 size math and the kit constants: [`transaction-size.md`](./transaction-size.md).

---

## 10. The `@solana/kit` 7.0.0 equivalent (pointer)

Kit has **no `Transaction` / `VersionedTransaction` class split** and **no legacy mutable builder**.
There is one immutable `TransactionMessage` whose `version` is `'legacy' | 0`, built with `pipe()` +
setters — every setter returns a new, more-strongly-typed message:

```ts
import {
  pipe, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
} from '@solana/kit'; // 7.0.0

const msg = pipe(
  createTransactionMessage({ version: 0 }),                              // v0 (ALT-capable) — the default
  m => setTransactionMessageFeePayerSigner(feePayer, m),                 // was payerKey
  m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),  // was recentBlockhash
  m => appendTransactionMessageInstructions(instructions, m),            // was add / instructions[]
);
// createTransactionMessage({ version: 'legacy' }) for legacy; version 1 is rejected at the type level
```

`{ version: 0 }` is the v0 equivalent of web3.js `compileToV0Message()`; `{ version: 'legacy' }` is the
legacy equivalent. Compiling + signing (`compileTransaction` / `signTransactionMessageWithSigners`),
serializing (`getBase64EncodedWireTransaction`), size helpers, and ALT compression
(`compressTransactionMessageUsingAddressLookupTables`) are covered in
[`../examples/kit-build.ts`](../examples/kit-build.ts), [`address-lookup-tables.md`](./address-lookup-tables.md),
and [`signing-and-assembly.md`](./signing-and-assembly.md).

---

## Guidelines (DO / DON'T)

**DO**

- **DO** default new app code to **v0** (`compileToV0Message` / kit `version: 0`) — it is a superset of
  legacy and unlocks ALTs; keep legacy for max compatibility or trivial scripts.
- **DO** remember `vtx.sign([...])` takes an **array**, while legacy `tx.sign(...)` /
  `tx.partialSign(...)` / `tx.add(...)` are **variadic**.
- **DO** pre-sign a `VersionedTransaction` before `connection.sendTransaction(vtx)` — the versioned
  overload has no signers argument.
- **DO** gate wallet sends on `wallet.adapter.supportedTransactionVersions?.has(0)` (see the
  [`wallet-adapter`](../../wallet-adapter/docs/sending-transactions.md) skill).
- **DO** pass the referenced `AddressLookupTableAccount[]` to `getAccountKeys(...)` /
  `TransactionMessage.decompile(...)` when reading a v0 tx — otherwise looked-up keys are unresolved.

**DON'T**

- **DON'T** expect a **legacy** `Transaction` to use ALTs — it can't; the runtime ignores lookups.
- **DON'T** call `sendAndConfirmTransaction` with a `VersionedTransaction` — it is typed to legacy; use
  `sendTransaction(vtx)` + `confirmTransaction`, or `sendAndConfirmRawTransaction(conn, vtx.serialize())`.
- **DON'T** mutate a `TransactionMessage` / compiled message after signing — it invalidates every
  signature (see [`signing-and-assembly.md`](./signing-and-assembly.md)).
- **DON'T** build **v1** transactions for mainnet — SIMD-0385 is still `Review` and the public
  constructor rejects `version: 1`.

## Common Errors

### Error: `sendTransaction` overload mismatch (TS) / silent unsigned send
**Cause:** calling `connection.sendTransaction(vtx, [signers])` (the versioned overload has no signers
parameter), or forgetting to sign the vtx at all.
**Solution:** `vtx.sign([...allRequiredSigners])` first (array!), then `connection.sendTransaction(vtx)`.

### Error: `Cannot read properties of undefined` when reading a v0 tx's accounts
**Cause:** calling `msg.getAccountKeys()` (or `decompile`) without passing the referenced tables, so
looked-up keys are missing and an index resolves past `staticAccountKeys.length`.
**Solution:** fetch each `addressTableLookups[].accountKey` via `getAddressLookupTable` and pass
`{ addressLookupTableAccounts: [...] }`.

### Error: wallet fails to sign — "unsupported transaction version"
**Cause:** the wallet/adapter doesn't advertise v0 (`supportedTransactionVersions` is `undefined` or
lacks `0`).
**Solution:** feature-gate on `wallet.adapter.supportedTransactionVersions?.has(0)` and fall back to a
legacy `Transaction` (see the [`wallet-adapter`](../../wallet-adapter/docs/sending-transactions.md) skill).

### Error: `Expected versioned message but received legacy message` (or vice-versa)
**Cause:** `VersionedMessage.deserialize` / `MessageV0.deserialize` fed bytes of the other kind (the
prefix high-bit mismatched).
**Solution:** dispatch on `VersionedMessage.deserializeMessageVersion(bytes)` first, or use
`VersionedMessage.deserialize` which returns the correct `Message | MessageV0`.

More build-time errors (size, ALT warm-up, signing) are catalogued in
[`troubleshooting.md`](./troubleshooting.md).

## References

- **Versioned transactions (v0)** — Solana docs, *Advanced › Versions*: https://solana.com/docs/advanced/versions
- **`@solana/web3.js` 1.98.4 API** (`Transaction`, `TransactionMessage`, `VersionedTransaction`,
  `MessageV0`, `VersionedMessage`) — https://www.npmjs.com/package/@solana/web3.js
- **SIMD-0296 (Larger Transactions) / SIMD-0385 (transaction-v1)** — 4096 bytes, `Review` status, no ALTs:
  https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md
- **`@solana/kit` 7.0.0** (transactions guide) — https://www.solanakit.com/docs/advanced-guides/transactions
- **Related docs:** [`address-lookup-tables.md`](./address-lookup-tables.md) ·
  [`transaction-size.md`](./transaction-size.md) · [`signing-and-assembly.md`](./signing-and-assembly.md) ·
  [`troubleshooting.md`](./troubleshooting.md). **Related skills:**
  [`transaction-landing`](../../transaction-landing/SKILL.md) ·
  [`wallet-adapter`](../../wallet-adapter/SKILL.md).
</content>
</invoke>
