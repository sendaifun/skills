# API Reference — Transaction Construction (`@solana/web3.js` 1.98.4 ↔ `@solana/kit` 7.0.0)

Lookup tables behind `../SKILL.md` and the `../docs/*.md` deep dives. Exact class names, method
signatures, exports, constants, and program IDs — copy these, don't guess. For tutorial flow read
the `docs/`; this file is pure reference. Every signature below was read from the published `.d.ts`
of each package (`@solana/web3.js@1.98.4`, `@solana/kit@7.0.0`).

Confirmation, priority fees, CU pricing, retries/rebroadcast, Jito, and durable-nonce **creation**
are out of scope here — see the **`transaction-landing`** skill.

## Version matrix

| Package | Version | Role |
|---|---|---|
| `@solana/web3.js` | **1.98.4** | Portable baseline client (v1 line); `Transaction`, `VersionedTransaction`, `AddressLookupTableProgram` |
| `@solana/kit` | **7.0.0** | Modern client (v2 line, renamed web3.js); immutable `pipe()` message builder |
| `@solana-program/address-lookup-table` | **0.12.1** | Kit-native ALT instruction builders — **only for create/extend/manage**; peerDep `@solana/kit ^6.4.0` (skew, see below) |
| `@solana/spl-token` | **0.4.14** | `createAssociatedTokenAccountIdempotentInstruction` and other token ixs to compose |

```bash
npm i @solana/web3.js@1.98.4              # baseline
npm i @solana/kit@7.0.0                    # kit path
# Only if you CREATE/EXTEND/MANAGE lookup tables with kit (NOT needed just to read/compress an existing table):
npm i @solana-program/address-lookup-table@0.12.1 --legacy-peer-deps
```

> **Peer-skew (kit ALT management):** `@solana-program/address-lookup-table@0.12.1` declares
> `peerDependencies: { "@solana/kit": "^6.4.0" }` (i.e. `>=6.4.0 <7.0.0`). Installed against kit
> **7.0.0** it emits an `ERESOLVE`/unmet-peer-dep warning — its codecs are ABI-stable and work at
> runtime, but `npm install` complains. Mitigate with `--legacy-peer-deps`, or pin kit `^6.4.0`
> for that package, or avoid it entirely for the read/compress path (kit-native
> `fetchAddressesForLookupTables` has no skew). A `0.12.2`/`0.13` widening the range to `^7` is
> likely imminent — **re-verify: `npm view @solana-program/address-lookup-table peerDependencies`.**

## Constants

| Constant | Value | Source / meaning |
|---|---|---|
| `PACKET_DATA_SIZE` | **1232** | Public web3.js export. Hard over-the-wire tx size, legacy **and** v0. `1280 (IPv6 min MTU) − 40 (IPv6 hdr) − 8 (fragment hdr)` |
| `LEGACY_TRANSACTION_SIZE_LIMIT` | **1232** | kit internal (not exported — use `getTransactionSize`/`isTransactionWithinSizeLimit`) |
| `V1_TRANSACTION_SIZE_LIMIT` | **4096** | kit internal. Transaction **v1** (SIMD-0296/0385) — **`Review`, NOT activated on mainnet**, and **no ALT support**. Target v0 today |
| `MAX_TX_ACCOUNT_LOCKS` | **128** | Real per-tx cap on distinct locked accounts (static + all ALT-resolved). The docs' "**64** addresses" is **STALE** — cite 128 |
| `LOOKUP_TABLE_MAX_ADDRESSES` | **256** | Max addresses stored in one lookup table |
| addresses per `extend` ix | **~30** | Size-bounded by the 1232-byte tx carrying the extend — loop to reach 256 |
| ALT warm-up | **1 slot** | A newly created/extended table is unusable until the **next** slot |
| ALT deactivation cooldown | **513 slots** | `MAX_ENTRIES (512) + 1` — wait after `deactivate` before `close` |
| `LOOKUP_TABLE_META_SIZE` | **56** bytes | ALT account metadata prefix size |
| max static account keys | **256** | Compiler asserts `≤ 256` static keys (`MAX_ACCOUNTS_PER_TRANSACTION = 256` in the SVM) |
| `VERSION_PREFIX_MASK` | **0x7f** (127) | v0 message first byte = `0x80 \| version`; legacy first byte (`numRequiredSignatures`) has the high bit unset |
| signature size | **64** bytes | Ed25519, one per required signer; each signer is also a 32-byte key |

Program IDs (verbatim):

| Program | Address |
|---|---|
| Address Lookup Table | `AddressLookupTab1e1111111111111111111111111` |
| Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| System | `11111111111111111111111111111111` |

---

## Build → sign → send export map (web3.js ↔ kit)

| Step | `@solana/web3.js` 1.98.4 | `@solana/kit` 7.0.0 |
|---|---|---|
| Empty message | `new TransactionMessage({ payerKey, recentBlockhash, instructions })` | `createTransactionMessage({ version: 0 })` |
| Fee payer | `payerKey` field (→ forced to account index 0) | `setTransactionMessageFeePayer(address, m)` **or** `setTransactionMessageFeePayerSigner(signer, m)` |
| Lifetime (blockhash) | `recentBlockhash` field | `setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m)` — `lastValidBlockHeight` is a **`bigint`** |
| Lifetime (durable nonce) | `nonceInfo` field / prepend `SystemProgram.nonceAdvance` | `setTransactionMessageLifetimeUsingDurableNonce({ nonce, nonceAccountAddress, nonceAuthorityAddress }, m)` |
| Add instructions | `.instructions: [...]` (or legacy `.add(...ixs)`) | `appendTransactionMessageInstruction(s)` / `prependTransactionMessageInstruction(s)` |
| Compile to v0 | `.compileToV0Message(alts?)` → `new VersionedTransaction(msg)` | `compileTransaction(msg)` (**sync**) — version is baked in at `createTransactionMessage` |
| Sign | `vtx.sign([signers])` (**array!**) | `signTransactionMessageWithSigners(msg)` (compiles **and** signs) |
| Serialize (wire) | `vtx.serialize()` → `Uint8Array` | `getBase64EncodedWireTransaction(tx)` → base64 string |
| Transaction id | `vtx.signatures[0]` (fee-payer sig) | `getSignatureFromTransaction(tx)` → base58 `Signature` |
| Measure size | `vtx.serialize().length` vs `PACKET_DATA_SIZE` (does **NOT** throw) | `getTransactionSize(tx)` / `isTransactionWithinSizeLimit(tx)` |
| Send (raw) | `connection.sendTransaction(vtx)` (**no signers arg** for versioned) | `rpc.sendTransaction(wire, { encoding: 'base64' }).send()` |

> **Kit has no `Transaction`/`VersionedTransaction` class split** — one immutable `TransactionMessage`
> whose `version` is `'legacy' | 0`. `createTransactionMessage` rejects `version: 1` at the type
> level (`SupportedTransactionVersion = Exclude<TransactionVersion, 1>`). **Kit dropped the `I`
> prefix**: the instruction type is `Instruction` (not `IInstruction`) from `@solana/instructions` 5+.

---

## `@solana/web3.js` 1.98.4 — class reference

### `Transaction` (legacy)

```ts
class Transaction {
  signatures: Array<SignaturePubkeyPair>;   // { signature: Buffer | null; publicKey: PublicKey }[]
  get signature(): Buffer | null;           // FIRST (fee-payer) signature = tx id
  feePayer?: PublicKey;
  instructions: Array<TransactionInstruction>;
  recentBlockhash?: Blockhash;              // string
  lastValidBlockHeight?: number;
  nonceInfo?: NonceInformation;             // durable-nonce lifetime
  constructor(opts?: TransactionBlockhashCtor);        // { blockhash, lastValidBlockHeight, feePayer? } ← RECOMMENDED
  add(...items): Transaction;               // VARIADIC + chainable
  sign(...signers: Signer[]): void;         // VARIADIC
  partialSign(...signers: Signer[]): void;  // VARIADIC — fills only given slots
  addSignature(pubkey: PublicKey, signature: Buffer): void;   // inject external/HW sig (64 bytes)
  serialize(config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Buffer; // THROWS "Transaction too large" if > 1232
  static from(buffer): Transaction;
  static populate(message: Message, signatures?: string[]): Transaction;
}
// One-shot helper (typed to LEGACY only — no versioned overload):
sendAndConfirmTransaction(connection, tx, signers: Signer[], options?): Promise<TransactionSignature>;
```

### `TransactionMessage` (v0 builder)

```ts
class TransactionMessage {
  payerKey: PublicKey;                      // was tx.feePayer
  instructions: Array<TransactionInstruction>;
  recentBlockhash: Blockhash;               // was tx.recentBlockhash
  constructor(args: { payerKey; instructions; recentBlockhash });
  compileToV0Message(addressLookupTableAccounts?: AddressLookupTableAccount[]): MessageV0;
  compileToLegacyMessage(): Message;
  static decompile(message: VersionedMessage, args?: DecompileArgs): TransactionMessage; // reverse; args = { addressLookupTableAccounts } | { accountKeysFromLookups }
}
```

### `VersionedTransaction`

```ts
class VersionedTransaction {
  signatures: Array<Uint8Array>;            // 64-byte slots, POSITIONAL, zero-filled until signed
  message: VersionedMessage;                // Message | MessageV0
  get version(): 'legacy' | 0;
  constructor(message: VersionedMessage, signatures?: Uint8Array[]); // throws if signatures.length !== header.numRequiredSignatures
  sign(signers: Array<Signer>): void;       // ← ARRAY (not variadic!). REPLACES existing sigs
  addSignature(publicKey: PublicKey, signature: Uint8Array): void;    // inject external/HW sig (64 bytes)
  serialize(): Uint8Array;                   // does NOT enforce 1232 / never throws (2048-byte buffer) — MEASURE .length
  static deserialize(bytes: Uint8Array): VersionedTransaction;       // preserves prior signatures
}
// send: connection.sendTransaction(vtx, options?)  ← NO signers param (must be pre-signed)
```

### `MessageV0` (compiled v0 wire message)

```ts
class MessageV0 {
  header: MessageHeader;                     // { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts }
  staticAccountKeys: Array<PublicKey>;       // inline keys (signers + fee payer + program IDs + non-table accounts)
  recentBlockhash: Blockhash;
  compiledInstructions: Array<MessageCompiledInstruction>;   // { programIdIndex; accountKeyIndexes: number[]; data: Uint8Array }
  addressTableLookups: Array<MessageAddressTableLookup>;     // { accountKey; writableIndexes: number[]; readonlyIndexes: number[] }
  get version(): 0;
  getAccountKeys(args?: { addressLookupTableAccounts?: AddressLookupTableAccount[] }): MessageAccountKeys; // resolved order: [...static, ...writableFromLookups, ...readonlyFromLookups]
  isAccountSigner(i: number): boolean;
  isAccountWritable(i: number): boolean;
  serialize(): Uint8Array;                   // writes into a 1232-byte buffer (message-level overflow throws here)
  static deserialize(bytes: Uint8Array): MessageV0;
}
// Dispatch legacy vs versioned on the wire:
VersionedMessage.deserializeMessageVersion(bytes): 'legacy' | number;   // 'legacy' if high bit unset, else prefix & 0x7f
VersionedMessage.deserialize(bytes): Message | MessageV0;
```

> Legacy `Message` uses `CompiledInstruction { programIdIndex; accounts: number[]; data: string /* base58 */ }`;
> `MessageV0` uses `MessageCompiledInstruction { programIdIndex; accountKeyIndexes: number[]; data: Uint8Array }`.
> Different field names and data encoding — not interchangeable when introspecting.

### `PACKET_DATA_SIZE`

```ts
import { PACKET_DATA_SIZE } from "@solana/web3.js"; // === 1232 (public export)
const wire = vtx.serialize();
if (wire.length > PACKET_DATA_SIZE) throw new Error(`too big: ${wire.length} > 1232 — use ALTs / split`);
```

---

## `@solana/web3.js` 1.98.4 — `AddressLookupTableProgram`

`static programId = AddressLookupTab1e1111111111111111111111111`.

```ts
class AddressLookupTableProgram {
  static createLookupTable(p: { authority: PublicKey; payer: PublicKey; recentSlot: bigint | number }):
    [TransactionInstruction, PublicKey];     // ← RETURNS A TUPLE [instruction, lookupTableAddress]
  static extendLookupTable(p: { lookupTable: PublicKey; authority: PublicKey; payer?: PublicKey; addresses: PublicKey[] }): TransactionInstruction;
  static deactivateLookupTable(p: { lookupTable: PublicKey; authority: PublicKey }): TransactionInstruction;
  static closeLookupTable(p: { lookupTable: PublicKey; authority: PublicKey; recipient: PublicKey }): TransactionInstruction;
  static freezeLookupTable(p: { lookupTable: PublicKey; authority: PublicKey }): TransactionInstruction; // irreversible
}

class AddressLookupTableAccount {
  key: PublicKey;
  state: {
    deactivationSlot: bigint;                // u64::MAX while active
    lastExtendedSlot: number;
    lastExtendedSlotStartIndex: number;
    authority?: PublicKey;                   // undefined once frozen
    addresses: Array<PublicKey>;             // index = position
  };
  isActive(): boolean;
  static deserialize(accountData: Uint8Array): AddressLookupTableState;
}

// Fetch:
connection.getSlot(commitmentOrConfig?): Promise<number>;                                   // pass slot - 1 to createLookupTable
connection.getAddressLookupTable(pk, config?): Promise<RpcResponseAndContext<AddressLookupTableAccount | null>>; // read .value
```

Use: `new TransactionMessage({...}).compileToV0Message([altAccount, ...])`. See `../examples/lookup-table.ts`.

---

## `@solana/kit` 7.0.0 — function reference

### Message builders (`@solana/transaction-messages`, re-exported by `@solana/kit`)

```ts
createTransactionMessage<TVersion extends 0 | 'legacy'>(config: { version: TVersion }): EmptyTransactionMessage<TVersion>;

setTransactionMessageFeePayer(feePayer: Address, m): m & TransactionMessageWithFeePayer;         // address only (fee payer stored as { address })
setTransactionMessageFeePayerSigner(feePayer: TransactionSigner, m): m & ...WithFeePayerSigner;  // address + auto-sign
setTransactionMessageLifetimeUsingBlockhash(
  { blockhash: Blockhash, lastValidBlockHeight: bigint }, m): m & ...WithBlockhashLifetime;       // pass rpc.getLatestBlockhash().value directly
setTransactionMessageLifetimeUsingDurableNonce({ nonce, nonceAccountAddress, nonceAuthorityAddress }, m): m; // prepends AdvanceNonceAccount

appendTransactionMessageInstruction(instruction, m): m;
appendTransactionMessageInstructions(instructions: readonly Instruction[], m): m;
prependTransactionMessageInstruction(instruction, m): m;   // also strips a durable-nonce lifetime (advance ix must stay first)
prependTransactionMessageInstructions(instructions: readonly Instruction[], m): m;
```

### Compile / sign / serialize (`@solana/transactions`, `@solana/signers`)

```ts
compileTransaction(m): Readonly<Transaction>;                          // SYNC; type-requires feePayer + lifetime; unsigned
signTransactionMessageWithSigners(m, config?): Promise<SendableTransaction & Transaction & TransactionWithLifetime>; // compiles + signs
partiallySignTransactionMessageWithSigners(m, config?): Promise<Transaction & ...>;   // multisig/offline
signTransaction(keyPairs: CryptoKeyPair[], tx): Promise<FullySignedTransaction & T>;  // key-driven; throws unless fully signed
partiallySignTransaction(keyPairs: CryptoKeyPair[], tx): Promise<T>;                   // no assertion

getSignatureFromTransaction(tx): Signature;                            // base58 tx id (fee-payer sig; throws if missing)
getBase64EncodedWireTransaction(tx): Base64EncodedWireTransaction;     // → rpc.sendTransaction(wire, { encoding: 'base64' })
getTransactionEncoder().encode(tx): Uint8Array;                        // raw wire bytes (measure / other encodings)
getTransactionDecoder().decode(bytes): Transaction;                    // rebuild (e.g. a partially-signed handoff)
```

`Transaction = { messageBytes, signatures: Record<Address, SignatureBytes | null> }` — an ordered
map keyed by signer address; unsigned signers are `null`.

### Size helpers (`@solana/transactions`)

```ts
getTransactionSize(tx): number;                                        // bytes
getTransactionSizeLimit(tx): 1232 | 4096;                              // per version
isTransactionWithinSizeLimit(tx): boolean;                             // type guard
assertIsTransactionWithinSizeLimit(tx): void;                          // throws SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT
// Message-level (needs feePayer set): getTransactionMessageSize(m), isTransactionMessageWithinSizeLimit(m), assert...
```

### Signers (`@solana/signers`)

```ts
generateKeyPairSigner(extractable?): Promise<KeyPairSigner>;
createKeyPairSignerFromBytes(bytes, extractable?): Promise<KeyPairSigner>;              // 64-byte secret key
createNoopSigner(address): NoopSigner;                                                  // reserve a slot signed elsewhere
addSignersToTransactionMessage(signers: TransactionSigner[], m): m;                     // attach to hand-built ixs
signAndSendTransactionMessageWithSigners(m, config?): Promise<SignatureBytes>;          // sign-and-send wallets (≤1 sending signer)
```

---

## ALT export map (web3.js ↔ kit)

| Operation | `@solana/web3.js` 1.98.4 | kit 7.0.0 |
|---|---|---|
| Create | `AddressLookupTableProgram.createLookupTable({authority,payer,recentSlot})` → `[ix, addr]` | `getCreateLookupTableInstructionAsync({authority,payer,recentSlot})` *(pkg 0.12.1)* |
| Derive PDA | (returned by `createLookupTable`) | `findAddressLookupTablePda({ authority, recentSlot })` *(0.12.1)* |
| Extend | `AddressLookupTableProgram.extendLookupTable({lookupTable,authority,payer,addresses})` | `getExtendLookupTableInstruction({ address, authority, payer, addresses })` *(0.12.1)* |
| Deactivate | `AddressLookupTableProgram.deactivateLookupTable({lookupTable,authority})` | `getDeactivateLookupTableInstruction(...)` *(0.12.1)* |
| Close | `AddressLookupTableProgram.closeLookupTable({lookupTable,authority,recipient})` | `getCloseLookupTableInstruction(...)` *(0.12.1)* |
| Freeze | `AddressLookupTableProgram.freezeLookupTable({lookupTable,authority})` | `getFreezeLookupTableInstruction(...)` *(0.12.1)* |
| Read one table | `connection.getAddressLookupTable(pk)` → `.value.state.addresses` | `fetchAddressLookupTable(rpc, addr)` → `.data.addresses` *(0.12.1)* |
| Read many (for compress) | — | `fetchAddressesForLookupTables(addrs, rpc)` → `AddressesByLookupTableAddress` *(kit-native, no extra dep)* |
| Use / compress | `.compileToV0Message([alt, ...])` | `compressTransactionMessageUsingAddressLookupTables(message /* FIRST arg */, addressesByLut)` *(kit-native, v0-only)* |

```ts
// kit read + compress (no @solana-program dep — no peer-skew):
import { fetchAddressesForLookupTables, compressTransactionMessageUsingAddressLookupTables } from "@solana/kit";
const addressesByLut = await fetchAddressesForLookupTables([lut], rpc); // { [lut]: Address[] }
const compressed = compressTransactionMessageUsingAddressLookupTables(message, addressesByLut); // (message, map)!
```

`AddressesByLookupTableAddress = { [lookupTableAddress: Address]: Address[] }`. Only **v0**
messages compress (legacy is a type error); only **non-signer** accounts move into a lookup —
the fee payer, other signers, and program IDs stay inline.

---

## References

- **Versioned transactions (v0)** — Solana docs: https://solana.com/docs/advanced/versions
- **Address Lookup Tables** — Solana docs: https://solana.com/docs/advanced/lookup-tables
- **Transaction structure / 1232-byte limit** — https://solana.com/docs/core/transactions/transaction-structure
- **`MAX_TX_ACCOUNT_LOCKS` 64 → 128** — https://forum.solana.com/t/feature-increased-tx-account-lock-limits-1-14-17/189
- **SIMD-0296 / SIMD-0385 (transaction-v1, 4096 B, Review, no ALTs)** — https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md
- **`@solana/web3.js` 1.98.4** — https://www.npmjs.com/package/@solana/web3.js
- **`@solana/kit` 7.0.0** (transactions guide) — https://www.solanakit.com/docs/advanced-guides/transactions
- **`@solana-program/address-lookup-table` 0.12.1** (note the `^6.4.0` peer range) — https://www.npmjs.com/package/@solana-program/address-lookup-table
- **Related skills:** `transaction-landing` (fees, confirmation, retries, Jito, durable-nonce) · `wallet-adapter` (v0 gating) · `token-2022` (token ixs to compose).
