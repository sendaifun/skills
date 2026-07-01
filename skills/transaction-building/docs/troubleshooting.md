# Troubleshooting — Transaction Construction

The exhaustive Cause/Solution catalog behind the headline errors in `../SKILL.md`. Every entry is a
**symptom → root cause → exact fix**, pointing to the deep dive that implements it. Scope is
**construction** (size, ALTs, signing, versioning, install) — for *landing* failures (blockhash
expiry, dropped/underpriced txs, confirmation), see the **`transaction-landing`** skill's
troubleshooting.

Baseline client: **`@solana/web3.js` 1.98.4**; **`@solana/kit` 7.0.0** noted where it differs.

**Classify the failure first:**

| Class | Telltale | Jump to |
|---|---|---|
| **Too big** | `Transaction too large`, or a v0 tx that silently never lands | [Size](#size-errors) |
| **ALT lifecycle** | `is not a recent slot`, `invalid index`, `cannot be closed` | [Lookup tables](#address-lookup-table-errors) |
| **Signing/assembly** | `Cannot sign with non signer key`, `Missing signature`, unsigned send | [Signing](#signing--assembly-errors) |
| **Version/wallet** | `Unsupported transaction version`, `sendAndConfirmTransaction` type error | [Versioning](#versioning--wallet-errors) |
| **Install/tooling** | `ERESOLVE`, unmet peer dependency | [Install](#install--tooling-errors) |

---

## Size errors

### Error: `Transaction too large: 1263 > 1232`
**Symptom:** a **legacy** `Transaction.serialize()` (or `sendAndConfirmTransaction`) throws locally.
**Cause:** the fully serialized transaction exceeds `PACKET_DATA_SIZE` (1232) — too many inline
account keys and/or too much instruction data. Legacy `serialize()` asserts the size and throws.
**Solution:** switch to **v0 + Address Lookup Tables** (`compileToV0Message([lut])`, ~31 bytes saved
per moved account), dedupe/remove accounts, split the transaction, or shorten instruction data. See
`transaction-size.md` and `address-lookup-tables.md`.

### Error: a v0 transaction silently never lands — no client error
**Symptom:** `vtx.serialize()` succeeds, `sendTransaction` returns a signature, but the tx never
confirms and there's no oversize error anywhere.
**Cause:** the v0 tx is `>1232` bytes. **`VersionedTransaction.serialize()` does NOT enforce the limit
and never throws** — it uses a 2048-byte scratch buffer and returns whatever fits. The RPC/leader
silently drops the oversized packet.
**Solution:** **measure v0 size yourself** before sending:
```ts
import { PACKET_DATA_SIZE } from "@solana/web3.js"; // 1232
const wire = vtx.serialize();
if (wire.length > PACKET_DATA_SIZE) throw new Error(`too big: ${wire.length} > 1232`);
// kit: if (!isTransactionWithinSizeLimit(signedTx)) throw new Error(...);
```
Then apply the fit-more strategies (`transaction-size.md`).

### Error (kit): `SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT`
**Symptom:** `assertIsTransactionWithinSizeLimit` or the send path throws in kit.
**Cause:** the compiled tx exceeds its version's limit (1232 for v0).
**Solution:** guard with `isTransactionWithinSizeLimit(tx)` first; compress with
`compressTransactionMessageUsingAddressLookupTables(message, addressesByLut)`, dedupe, or split.

### Error: `Max static account keys length exceeded`
**Symptom:** compiling a message throws.
**Cause:** more than **256** inline static account keys.
**Solution:** move non-signer accounts into ALTs (they stop counting as static keys) or split the tx.
You will usually hit the 1232-byte or 128-lock limit first.

---

## Address Lookup Table errors

### Error: `<slot> is not a recent slot`
**Symptom:** the `createLookupTable` transaction fails, intermittently.
**Cause:** the `recentSlot` passed to `createLookupTable` is **ahead of the leader's view** — the LUT
address is a PDA of `[authority, recentSlot]`, and passing the absolute latest `getSlot()` races the
leader, which may be one slot behind your RPC read.
**Solution:** always pass **`recentSlot: (await connection.getSlot()) - 1`**. See
`address-lookup-tables.md`.

### Error: `Transaction address table lookup uses an invalid index`
**Symptom:** a transaction that references an ALT fails.
**Cause:** the table (or a just-**extended** address) was used **before its ~1-slot warm-up
completed**, or an index past `state.addresses.length` was referenced.
**Solution:** wait **≥1 slot** after create/extend before using the table; re-fetch with
`getAddressLookupTable(pk)` and confirm the address is actually present (`value.state.addresses`)
before referencing it.

### Error: `Table cannot be closed until it's fully deactivated in N blocks`
**Symptom:** `closeLookupTable` fails.
**Cause:** `close` was called before the **~513-slot cooldown** (`MAX_ENTRIES + 1`, `MAX_ENTRIES =
512`) after `deactivateLookupTable` elapsed. The cooldown prevents censorship via deactivate+recreate.
**Solution:** poll `getSlot()` until `currentSlot - deactivationSlot > 513` (~3–4 min at ~400 ms/slot),
then close. Fetch `deactivationSlot` from the table's state.

### Error: `AddressLookupTableAccount is null` when fetching a table
**Symptom:** `getAddressLookupTable(addr)` returns `{ value: null }`.
**Cause:** the create/extend transaction hasn't propagated to the RPC you're reading, or the address
is wrong.
**Solution:** confirm the create tx **first**, then fetch; allow propagation delay on a fresh table; on
a load-balanced RPC, read from the same node that saw the create.

### Error: a v0 tx still doesn't shrink after attaching an ALT
**Symptom:** `compileToV0Message([lut])` is barely smaller than without it.
**Cause:** the accounts you hoped to compress are **signers, the fee payer, or program IDs** — those
must stay in the static keys and can never be sourced from a table; only **non-signer, non-invoked**
accounts move to a 1-byte index. Or the accounts aren't actually stored in the table.
**Solution:** verify the eligible accounts are in `lut.state.addresses`; compare
`compileToV0Message()` vs `compileToV0Message([lut])` byte counts (`transaction-size.md`) to confirm
the saving; move only non-signer accounts.

---

## Signing & assembly errors

### Error: `Cannot sign with non signer key <pubkey>` / `unknown signer: <pubkey>`
**Symptom:** `vtx.sign([...])`, `tx.partialSign(...)`, or `addSignature(...)` throws.
**Cause:** signing with (or injecting a signature for) a key that is **not among the required
signers** — it is neither the fee payer nor marked `isSigner` in any instruction, so there is no
positional slot for it.
**Solution:** mark the account as a signer in an instruction (or set it as the fee payer) before
compiling the message; verify you're signing the correct, frozen message. See `signing-and-assembly.md`.

### Error: `Signature verification failed. Missing signature for public key [...]`
**Symptom:** `Transaction.serialize()` throws on a partially-signed legacy tx.
**Cause:** default `requireAllSignatures: true` / `verifySignatures: true` on a tx that isn't fully
signed yet (an intentional multisig/offline handoff).
**Solution:** serialize the handoff with `tx.serialize({ requireAllSignatures: false, verifySignatures:
false })`; collect the remaining signatures downstream before the final send.

### Error: sent a `VersionedTransaction` but it never lands / "signature verification failed"
**Symptom:** `connection.sendTransaction(vtx)` returns a signature (or throws a verification error) but
nothing confirms.
**Cause:** the vtx was sent **unsigned or partially signed**. Unlike the legacy overload,
`connection.sendTransaction(vtx)` has **no signers argument** and does **not** sign for you — passing
signers as a second arg is a type error on the versioned overload.
**Solution:** **pre-sign** before sending: `vtx.sign([...allRequiredSigners])` (array!). For multisig,
ensure every positional slot is filled (`signing-and-assembly.md`) before submitting.

### Error: `Expected signatures length to be equal to the number of required signatures`
**Symptom:** `new VersionedTransaction(message, signatures)` throws.
**Cause:** the `signatures` array length ≠ `message.header.numRequiredSignatures`.
**Solution:** pass exactly one 64-byte slot per required signer, or omit the arg to get zero-filled
slots.

### Error: multisig tx fails after a cosigner signed
**Symptom:** after collecting signatures, the tx is rejected as unsigned/invalid.
**Cause:** a party called `vtx.sign([allSigners])` (which **replaces** all signatures) instead of
signing only their slot, or the message bytes differed between signers (someone re-fetched a blockhash
or reordered metas).
**Solution:** distribute **one frozen wire**; each party signs only their own slot (`sign([theirKey])`
or `addSignature`); merge positional slots. Never mutate the message after the first signature.

### Error (kit): `SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING`
**Symptom:** `assertIsFullySignedTransaction` / `signTransaction*` throws in kit.
**Cause:** the transaction is still missing required signatures.
**Solution:** read `e.context.addresses` for the missing signers, sign them
(`partiallySignTransaction` / signer-based flow), then re-assert before sending.

### Error: `Cannot read properties of undefined` reading a v0 tx's accounts
**Symptom:** `msg.getAccountKeys()` or introspecting a deserialized v0 tx throws.
**Cause:** the referenced lookup tables weren't passed, so looked-up keys can't be resolved.
**Solution:** fetch each `addressTableLookups[].accountKey` via `getAddressLookupTable` and pass
`msg.getAccountKeys({ addressLookupTableAccounts: [...] })` (or `TransactionMessage.decompile(msg,
{ addressLookupTableAccounts })`). See `versioned-transactions.md`.

---

## Versioning & wallet errors

### Error: wallet fails to sign — `Unsupported transaction version` / `WalletSendTransactionError`
**Symptom:** sending a `VersionedTransaction` through a connected wallet throws, or the wallet refuses
to display it.
**Cause:** the wallet/adapter does **not advertise v0** — `wallet.adapter.supportedTransactionVersions`
is `undefined` (legacy-only, older adapter contract) or does not contain `0`.
**Solution:** feature-gate before sending, and fall back to a legacy `Transaction`:
```ts
const supported = wallet?.adapter.supportedTransactionVersions; // Set<TransactionVersion> | undefined
if (!supported)        { /* legacy-only wallet → build a legacy Transaction */ }
else if (!supported.has(0)) { /* no v0 → fall back to legacy */ }
// else: safe to send the VersionedTransaction
```
Full feature-detection pattern: the **`wallet-adapter`** skill (`wa-usage.md`).

### Error: `sendAndConfirmTransaction` type error / does nothing with a `VersionedTransaction`
**Symptom:** TypeScript rejects the call, or a JS call misbehaves.
**Cause:** `sendAndConfirmTransaction(connection, tx, signers)` is typed to a **legacy `Transaction`
only** — there is no `VersionedTransaction` overload.
**Solution:** for v0, **pre-sign** then `connection.sendTransaction(vtx)` + `connection.confirmTransaction(...)`,
or `sendAndConfirmRawTransaction(connection, vtx.serialize())`. In kit, use
`sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })`.

### Error: building a v1 transaction fails
**Symptom:** `createTransactionMessage({ version: 1 })` is a type error (kit); web3.js has no v1.
**Cause:** **transaction v1 (SIMD-0385) is `Review` status, not activated on mainnet.** kit ships the
type plumbing but `createTransactionMessage` only accepts `'legacy' | 0`; web3.js v1 knows only
`'legacy' | 0`.
**Solution:** target **v0**. (v1 also would not support ALTs — see `transaction-size.md`.)

---

## Install & tooling errors

### Error: `ERESOLVE` / unmet peer dependency installing `@solana-program/address-lookup-table`
**Symptom:** `npm i @solana-program/address-lookup-table` against `@solana/kit@7.0.0` emits an
`ERESOLVE` / "unmet peer dependency" warning (or fails on strict installers).
**Cause:** `@solana-program/address-lookup-table@0.12.1` declares `peerDependencies: { "@solana/kit":
"^6.4.0" }` (i.e. `>=6.4.0 <7.0.0`). Kit 7 shipped just after this client, so its peer range hasn't
been bumped. The client uses only ABI-stable primitives and **works at runtime against kit 7** — this
is a resolver warning, not a real incompatibility.
**Solution (pick one):**
- **Best:** for the **read/compress** path you don't need this package at all — use kit-native
  `fetchAddressesForLookupTables(addrs, rpc)` + `compressTransactionMessageUsingAddressLookupTables`
  (no peer-dep skew). Only reach for `@solana-program/address-lookup-table` to **create/extend/
  deactivate/close** tables.
- `npm i @solana-program/address-lookup-table --legacy-peer-deps` (silences the resolver).
- Or pin `@solana/kit@^6.4.0` for that workspace.
- **Re-check at build time:** a `0.12.2+` / `0.13` widening the range to `^7` is likely imminent —
  run `npm view @solana-program/address-lookup-table peerDependencies` before assuming the skew still
  exists. See `address-lookup-tables.md` and the kit path in `../SKILL.md`.

---

## References

- **1232-byte limit / v0 serialize gotcha** — `transaction-size.md`; Solana docs:
  https://solana.com/docs/core/transactions/transaction-structure
- **Address Lookup Tables** — `address-lookup-tables.md`; Solana docs:
  https://solana.com/docs/advanced/lookup-tables
- **Signing & assembly** — `signing-and-assembly.md`.
- **Versioned transactions & wallet gating** — `versioned-transactions.md`; **`wallet-adapter`** skill
  (`wa-usage.md`).
- **kit ALT peer-skew** — `npm view @solana-program/address-lookup-table peerDependencies`;
  https://www.npmjs.com/package/@solana-program/address-lookup-table
- **Landing failures** (blockhash expiry, dropped/underpriced, confirmation) — **`transaction-landing`**
  skill troubleshooting.
</content>
