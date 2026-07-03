# Signing & Assembly — signatures, multisig, offline, sponsors

The deep dive behind the signing section in `../SKILL.md`. Signatures on Solana are **positional and
independent**, which is exactly what makes multisig, air-gapped hardware, and fee-sponsor flows
possible: parties sign the *identical* message bytes at different times, on different machines, in any
order. This doc covers the signing model, then every practical assembly pattern in **`@solana/web3.js`
1.98.4** with **`@solana/kit` 7.0.0** equivalents.

Related docs: `versioned-transactions.md` (the tx classes), `transaction-size.md` (each signer costs
96 bytes). Durable-nonce *mechanics* (creating the nonce account, rebroadcast) live in the
**`transaction-landing`** skill — cross-referenced at the end.

---

## The signing model — order is fixed by the runtime

You do not choose the account order or the signature order — the compiler does, deterministically.
`web3.js` partitions every account the transaction touches into four groups and lays them out in this
exact order:

```
staticAccountKeys = [ ...writableSigners, ...readonlySigners, ...writableNonSigners, ...readonlyNonSigners ]

header = {
  numRequiredSignatures:       writableSigners.length + readonlySigners.length,
  numReadonlySignedAccounts:   readonlySigners.length,
  numReadonlyUnsignedAccounts: readonlyNonSigners.length,
}
// invariant enforced by the compiler:
//   the first writable signer MUST equal the fee payer
```

Three consequences you can rely on:

- **The fee payer is always account index 0**, forced to `isSigner && isWritable` and unshifted to
  the front. Therefore **`signatures[0]` is the fee payer's signature — and it is the transaction id.**
  (kit's `getSignatureFromTransaction` returns exactly this.)
- **The signatures array is positional.** `signatures[i]` corresponds to `staticAccountKeys[i]` for
  every `i < numRequiredSignatures`. A missing or misplaced signature = the runtime rejects the tx.
- **`numRequiredSignatures`** is simply the count of signer keys: the fee payer plus every account
  marked `isSigner` in any instruction.

**The one rule that governs every pattern below:** because all signers sign over
`message.serialize()`, they must all sign the **byte-identical message** — same fee payer, same
blockhash/nonce, same instructions, same account-meta order. **Freeze the message before *any* party
signs.** Reordering account metas after the first signature silently changes the positional slots and
invalidates every signature.

### Signature data shapes differ (web3.js)

The two transaction classes store signatures differently — a frequent source of confusion:

| | Legacy `Transaction` | `VersionedTransaction` (v0) |
|---|---|---|
| `signatures` field | `{ signature: Buffer \| null, publicKey: PublicKey }[]` | `Uint8Array[]` (64-byte slots, zero-filled until signed) |
| Alignment | by `publicKey` | **positional** — aligned to the required signers |
| Convenience getter | `tx.signature` → fee-payer `Buffer \| null` | index `signatures[0]` |
| Constructor sig arg | n/a | `new VersionedTransaction(msg, signatures?)` — **throws** if `signatures.length !== header.numRequiredSignatures` |

kit uses a third shape: `Transaction.signatures` is an **ordered `Record<Address, SignatureBytes |
null>`** keyed by signer address (unsigned signers map to `null`).

---

## web3.js — partial / multisig / offline / hardware

All patterns rely on: sign only the slots you hold, serialize with the gaps, hand off, let the next
party fill their slots. Nobody touches the message.

### VersionedTransaction (v0)

```ts
import { VersionedTransaction } from "@solana/web3.js";

const vtx = new VersionedTransaction(messageV0); // signatures start as zero-filled 64-byte slots

// Sign with ONLY a subset — fills just those signers' slots, leaves the rest zeroed:
vtx.sign([feePayerKeypair]);   // fills the fee payer's slot (index 0)
vtx.sign([cosignerKeypair]);   // fills the cosigner's slot — existing slots untouched

// Inject an externally-produced signature (hardware wallet, remote signer, air-gapped machine):
vtx.addSignature(cosignerPubkey, precomputedSig64); // must be exactly 64 bytes; no secret key in process
```

`vtx.sign(signers)` finds each signer's positional slot
(`staticAccountKeys.slice(0, numRequiredSignatures).findIndex(pk === signer.publicKey)`; asserts `≥ 0`
→ `Cannot sign with non signer key`) and writes `sign(messageData, secretKey)` there.

> **Footgun:** `vtx.sign([...])` takes an **array** (legacy `tx.sign(...)` is variadic). It fills only the
> passed signers' positional slots and leaves other slots untouched (unlike legacy `Transaction.sign(...)`,
> which rebuilds the whole `signatures` array), so you can sign incrementally — call `sign([oneSigner])` per
> party, or use `addSignature`. Just never mutate the message after the first signature.

### Legacy Transaction

```ts
import { Transaction } from "@solana/web3.js";

tx.feePayer = feePayer.publicKey;   // establishes signature slot 0
tx.recentBlockhash = blockhash;

// Full-signer convenience (must be given ALL required signers; fee payer first is conventional):
tx.sign(feePayer, cosigner);        // variadic

// Partial signing — fills ONLY the given slots, leaves the rest null (offline / multisig):
tx.partialSign(feePayer);           // sign now, hand off for the rest later
tx.partialSign(cosigner);

// Inject an external signature (hardware / air-gapped):
tx.addSignature(cosignerPubkey, sig64Buffer); // asserts 64 bytes; unknown signer throws
```

`partialSign(...signers)` compiles the message, then stores `sign(message.serialize(), secretKey)` in
each signer's slot (found by `publicKey.equals`; throws `unknown signer` if the key isn't required).

### The handoff — serialize a partially-signed transaction

**Legacy:** default serialization requires all signatures and verifies them, so it throws on a
partial tx. Disable both to serialize the gaps for transport:

```ts
const partialWire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
// ship partialWire (e.g. base64) to the next signer
```

Leaving the defaults on throws `Signature verification failed. Missing signature for public key
[...]`. (`tx.verifySignatures(false)` returns true if the *present* signatures are valid even when
some are missing — useful to validate an incoming partial tx.)

**VersionedTransaction:** `serialize()` never verifies and never enforces size, so a partially-signed
v0 tx serializes fine — unsigned slots are simply 64 zero bytes:

```ts
const partialWire = vtx.serialize(); // Uint8Array, includes zeroed slots for the not-yet-signed signers
```

### The next signer — deserialize → sign → combine

```ts
// Legacy
import { Transaction } from "@solana/web3.js";
const tx = Transaction.from(partialWire); // preserves existing signatures
tx.partialSign(otherSigner);              // fills their slot
const fullWire = tx.serialize();          // now requireAllSignatures passes

// VersionedTransaction
import { VersionedTransaction } from "@solana/web3.js";
const vtx = VersionedTransaction.deserialize(partialWire); // keeps prior signatures
vtx.sign([otherSigner]);                  // fills their slot; existing slots untouched
const fullWire = vtx.serialize();
```

`VersionedTransaction.deserialize` reads the compact-u16 signature count, splices out that many
64-byte signatures, then reconstructs `new VersionedTransaction(message, signatures)`. Because the
message bytes are byte-identical and signatures are positional, each party's signature composes
cleanly.

---

## Multisig assembly (M-of-M at the transaction level)

A transaction with **multiple required signers** is already a native M-of-M multisig: the runtime
requires **all** listed signer slots filled. The assembly is just the handoff above, fanned out:

```ts
// Coordinator: build ONCE, freeze the message, distribute the same wire bytes to every cosigner.
const vtx = new VersionedTransaction(messageV0); // message includes all M signers + fee payer at index 0
const base = vtx.serialize();                    // all slots zeroed

// Each cosigner independently:
//   const v = VersionedTransaction.deserialize(base);
//   v.sign([theirKeypair]);
//   return v.serialize();  // only their slot filled

// Coordinator merges: because slots are positional, copy each non-zero slot into one vtx.
const merged = VersionedTransaction.deserialize(base);
for (const partial of partialWiresFromEachCosigner) {
  const p = VersionedTransaction.deserialize(partial);
  p.signatures.forEach((sig, i) => {
    if (sig.some((b) => b !== 0)) merged.signatures[i] = sig; // adopt any filled slot
  });
}
// merged is now fully signed → send
```

> **Threshold (N-of-M) multisig** is *not* a transaction-level feature — the tx runtime is all-or-
> nothing on its required signers. For a true N-of-M policy (e.g. 2-of-3), use an **on-chain multisig
> program** (SPL Token's native multisig for token authorities, or **Squads** for program/treasury
> governance): the on-chain account is a single signer/authority from the transaction's perspective,
> and the program enforces the threshold internally. The transaction-level pattern above is M-of-M
> (every listed key must sign).

---

## Sponsor / relayer — fee payer ≠ signer

A service pays fees on a user's behalf (gasless UX, relayers). The fee payer and the authorizing user
are **different** keys, both required:

1. **Build** the message with `payerKey = sponsor.publicKey` (fee payer → forced to index 0), plus
   the **user** as an instruction signer.
2. The **user** signs their slot and returns the partially-signed wire:
   ```ts
   userVtx.sign([user]);                 // or hardware: userVtx.addSignature(user.publicKey, sig64)
   const partial = userVtx.serialize();  // → send to the sponsor's backend
   ```
3. The **sponsor** deserializes, adds its signature, and submits:
   ```ts
   const vtx = VersionedTransaction.deserialize(partial);
   vtx.sign([sponsor]);                  // fills slot 0
   const txid = await connection.sendTransaction(vtx); // sponsor pays the fee
   ```

Because the fee payer is forced to index 0, **`signatures[0]` (the sponsor's) is the transaction id**.
The *order* in which the two parties sign is irrelevant (positional slots); the *account-meta order*
is what defines the slots, so the message must be frozen before either signs.

> **Security:** the sponsor should simulate/inspect the message before signing — it is paying for
> whatever instructions the user assembled. Verify the instructions do only what you intend before
> adding the fee-payer signature.

---

## `@solana/kit` 7.0.0 — signing

Kit has two layers. Use the **signer-based** layer for app code; drop to the **key-based** layer for
raw `CryptoKeyPair`s and the offline round-trip.

### Signer-based (idiomatic) — signers attached to the message

```ts
import {
  setTransactionMessageFeePayerSigner, addSignersToTransactionMessage,
  partiallySignTransactionMessageWithSigners, signTransactionMessageWithSigners,
} from "@solana/kit";

// msg already has instructions + a blockhash (or durable-nonce) lifetime
const withPayer   = setTransactionMessageFeePayerSigner(sponsorSigner, msg); // fee payer AS a signer
const withSigners = addSignersToTransactionMessage([userSigner], withPayer); // attach extra signers

const partial = await partiallySignTransactionMessageWithSigners(withSigners); // does NOT assert full
const signed  = await signTransactionMessageWithSigners(withSigners);          // asserts fully signed → sendable
```

- `setTransactionMessageFeePayerSigner(signer, m)` sets the fee payer **and** registers it as a
  signer. Use `setTransactionMessageFeePayer(address, m)` (address only) when the fee payer signs
  elsewhere (a wallet/backend); pair with `createNoopSigner(address)` if you want kit to reserve the
  slot without signing.
- Codama `@solana-program/*` instruction builders that take a `TransactionSigner` in a signer slot are
  discovered automatically. For hand-built instructions, `addSignersToTransactionMessage([...], m)`.
- `signTransactionMessageWithSigners` runs `TransactionModifyingSigner`s sequentially, then
  `TransactionPartialSigner`s in parallel — this is how hardware/remote signers plug in. Its return
  type in kit 7 is `SendableTransaction & Transaction & TransactionWithLifetime` (a fully-signed,
  sendable tx; it throws if any required signature is missing).
- **Sign-and-send wallets** (browser wallets exposing only sign-and-send): use a
  `TransactionSendingSigner` + `signAndSendTransactionMessageWithSigners(m)` → returns `SignatureBytes`
  directly (the wallet broadcasts). A message may contain **at most one** sending signer.

### Key-based (lower level) + offline round-trip

```ts
import {
  compileTransaction, partiallySignTransaction, signTransaction,
  getSignatureFromTransaction, isFullySignedTransaction, assertIsFullySignedTransaction,
  getTransactionEncoder, getTransactionDecoder,
} from "@solana/kit";

const tx   = compileTransaction(message);                        // sync → { messageBytes, signatures }
const p1   = await partiallySignTransaction([userKeyPair], tx);  // does NOT assert fully-signed
const full = await signTransaction([sponsorKeyPair], p1);        // asserts fully signed, else throws
const id   = getSignatureFromTransaction(full);                  // fee-payer signature = tx id (base58)

// Offline handoff: encode → transport → decode → sign the remaining signers
const wire = getTransactionEncoder().encode(p1);                 // Uint8Array (partially signed OK)
const back = getTransactionDecoder().decode(wire);               // Transaction, existing sigs preserved
const done = await partiallySignTransaction([sponsorKeyPair], back);
assertIsFullySignedTransaction(done);                            // throws SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING if not
```

- `partiallySignTransaction(keyPairs, tx)` does **not** assert fully-signed — a partial tx can be
  serialized/deserialized but not landed. `signTransaction(keyPairs, tx)` returns
  `FullySignedTransaction` and **throws unless fully signed**.
- `getTransactionEncoder().encode` / `getTransactionDecoder().decode` are the kit analog of web3.js
  `serialize` / `deserialize` for the offline handoff, preserving existing signatures.
- Error shapes: `SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING` (`e.context.addresses` lists the
  missing signers) and `SOLANA_ERROR__TRANSACTION__EXCEEDS_SIZE_LIMIT`.

---

## Long-lived / offline lifetimes — durable nonce

A blockhash lifetime expires in **~60–90 s (150 slots)** — far too short for air-gapped signing or a
multisig round-trip that takes minutes to hours. Swap the blockhash for a **durable nonce**, which
stays valid until the nonce advances (i.e. until the transaction lands):

- **web3.js:** the transaction's first instruction MUST be
  `SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey })`, and `recentBlockhash` is set to the
  current nonce value (`tx.nonceInfo = { nonce, nonceInstruction }`, or prepend the advance
  instruction manually).
- **kit:** `setTransactionMessageLifetimeUsingDurableNonce({ nonce, nonceAccountAddress,
  nonceAuthorityAddress }, msg)` (instead of `setTransactionMessageLifetimeUsingBlockhash`) — it also
  prepends the `AdvanceNonceAccount` instruction. Send with `sendAndConfirmDurableNonceTransactionFactory`.

The nonce advances (invalidating the old value) only when the tx lands, so exactly **one** transaction
per nonce value — perfect for "sign now, submit much later." **Creating the nonce account,
`getNonceAndContext`, and the rebroadcast loop live in the `transaction-landing` skill** (see
`../../transaction-landing/docs/retries-and-confirmation.md`).

---

## Guidelines

**DO**
- **DO** freeze the message (fee payer, blockhash/nonce, instructions, account-meta order) before
  **any** party signs — all signers sign identical bytes.
- **DO** use `vtx.sign([subset])` (v0) / `tx.partialSign(...)` (legacy) / `partiallySign*` (kit) for
  multisig/offline, and hand off with `serialize({ requireAllSignatures: false })` (legacy) or a plain
  `serialize()` (v0).
- **DO** rely on positional slots — the fee payer is index 0, and `signatures[0]` is the tx id.
- **DO** use a **durable nonce** for any transaction signed well before it is sent.
- **DO** have a sponsor **simulate/inspect** the message before adding the fee-payer signature.

**DON'T**
- **DON'T** mutate the message after signing — it invalidates every signature.
- **DON'T** reorder account metas between signers — it changes the positional signature slots.
- **DON'T** try to `vtx.sign([...])` with a key you don't hold — each party signs their own slot with
  `sign([theirKey])` or `addSignature` (`sign` only fills the slots of the signers you pass, leaving the rest intact).
- **DON'T** confuse the classes: `vtx.sign([...])` is an **array**; legacy `tx.sign(...)` is variadic.
- **DON'T** expect transaction-level signing to give N-of-M thresholds — use an on-chain multisig
  (SPL Token multisig / Squads) for that.

---

## Common Errors

### Error: `Signature verification failed. Missing signature for public key [...]`
**Cause:** `Transaction.serialize()` with default `requireAllSignatures: true` on a partially-signed
tx.
**Solution:** for intentional handoffs, `serialize({ requireAllSignatures: false, verifySignatures:
false })`; otherwise collect the missing signer's signature before serializing.

### Error: `Cannot sign with non signer key <pubkey>` / `unknown signer: <pubkey>`
**Cause:** signing with (or `addSignature` for) a key that is not among the required signers — not the
fee payer and not marked `isSigner` in any instruction.
**Solution:** mark the account as a signer in an instruction (or set it as the fee payer) before
compiling; verify you're signing the correct, frozen message.

### Error: `Expected signatures length to be equal to the number of required signatures`
**Cause:** `new VersionedTransaction(message, signatures)` with a `signatures` array whose length ≠
`message.header.numRequiredSignatures`.
**Solution:** pass exactly one slot per required signer, or omit the arg to get zero-filled slots.

### Error (kit): `SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING`
**Cause:** `assertIsFullySignedTransaction` / `signTransaction*` on a tx still missing signatures.
**Solution:** read `e.context.addresses` for the missing signers, collect their signatures
(`partiallySignTransaction` / the signer-based flow), then re-assert.

### Error: multisig tx fails after a cosigner "re-signed everything"
**Cause:** a party called `vtx.sign([allSigners])` (or rebuilt the message) instead of signing only
their slot, replacing/invalidating others' signatures — or the message bytes differed between signers.
**Solution:** distribute one frozen wire; each party signs only their own slot; merge positional slots.

---

## References

- **Transaction structure — fee payer index 0 / first signature / account ordering** — Solana docs:
  https://solana.com/docs/core/transactions/transaction-structure
- **web3.js signing API** — `Transaction.partialSign` / `addSignature` / `serialize({requireAllSignatures})`,
  `VersionedTransaction.sign(signers[])` / `addSignature` / `deserialize` (`@solana/web3.js` 1.98.4).
- **kit signers** — `partiallySignTransactionMessageWithSigners` / `signTransactionMessageWithSigners`
  / `setTransactionMessageFeePayerSigner` / `addSignersToTransactionMessage` (`@solana/signers` 7.0.0);
  `partiallySignTransaction` / `signTransaction` / `getTransactionEncoder` / `getTransactionDecoder`
  (`@solana/transactions` 7.0.0): https://www.solanakit.com/docs
- **Durable nonces** — Solana docs, Advanced › Durable Nonces:
  https://solana.com/docs/advanced/introduction-to-durable-nonce  (mechanics: **`transaction-landing`**
  skill, `retries-and-confirmation.md`).
- **Squads / SPL Token multisig** (true N-of-M authorities): https://docs.squads.so
- **Related docs:** `versioned-transactions.md` (tx classes) · `transaction-size.md` (96 B per signer)
  · `../../transaction-landing/` (durable-nonce rebroadcast, confirmation).
</content>
