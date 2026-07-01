# Sending transactions with the classic wallet-adapter

The long form of SKILL.md's "Sending a transaction" section, for the classic
`@solana/wallet-adapter` stack (web3.js v1, `@solana/web3.js@1.98.4`). It covers the two
things people get wrong: **what `sendTransaction` actually does** (it signs *and* broadcasts),
and **when a versioned (v0) transaction is safe to send** (only if the wallet advertises it).
Plus legacy vs v0 construction, Address Lookup Tables, extra co-signers, and confirmation
against `lastValidBlockHeight`.

> `sendTransaction` broadcasts through the **wallet's** RPC, not yours. So mainnet landing
> concerns — priority fees, rebroadcast, confirmation strategy — still apply. Cross-link the
> **transaction-landing** skill ([../../transaction-landing/SKILL.md](../../transaction-landing/SKILL.md))
> for those; this doc is only about building and handing the transaction to the wallet.

---

## The one rule: `sendTransaction` signs AND sends

On `WalletContextState`, `sendTransaction` is the **only** signing method guaranteed to exist
(see [../resources/api-reference.md](../resources/api-reference.md)). Its signature (from
`@solana/wallet-adapter-base@0.9.27`):

```ts
sendTransaction(
  transaction: Transaction | VersionedTransaction,   // legacy or v0
  connection: Connection,
  options?: SendTransactionOptions,                  // extends web3.js SendOptions
): Promise<TransactionSignature>;                     // returns the signature string

interface SendTransactionOptions extends SendOptions {
  signers?: Signer[];   // extra LOCAL co-signers (e.g. a freshly generated Keypair)
}
// SendOptions: { skipPreflight?, preflightCommitment?, maxRetries?, minContextSlot? }
```

It **signs the transaction in the wallet and broadcasts it**, returning the signature. Do **not**
then call `connection.sendRawTransaction` yourself — the transaction is already in flight. After
`sendTransaction` resolves you only *confirm*.

For a legacy `Transaction`, the adapter fills in the fee payer and a recent blockhash if you left
them unset (`BaseWalletAdapter.prepareTransaction`). Passing a fresh blockhash +
`lastValidBlockHeight` + `minContextSlot` yourself is still the robust pattern, because those are
exactly what you need to confirm.

---

## Legacy `Transaction`

```tsx
'use client';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletNotConnectedError } from '@solana/wallet-adapter-base';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { useCallback } from 'react';

export function SendLegacy() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const onClick = useCallback(async () => {
    if (!publicKey) throw new WalletNotConnectedError();

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: Keypair.generate().publicKey,      // demo recipient
        lamports: await connection.getMinimumBalanceForRentExemption(0),
      }),
    );

    // Fresh blockhash + context slot. minContextSlot guards against the wallet using a
    // stale/behind RPC node; pass it to BOTH sendTransaction and confirmTransaction.
    const {
      context: { slot: minContextSlot },
      value: { blockhash, lastValidBlockHeight },
    } = await connection.getLatestBlockhashAndContext();

    const signature = await sendTransaction(tx, connection, { minContextSlot });
    await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
  }, [publicKey, sendTransaction, connection]);

  return <button onClick={onClick} disabled={!publicKey}>Send (legacy)</button>;
}
```

---

## Versioned `VersionedTransaction` (v0) — gate on capability first

Not every wallet signs v0. The capability lives on the adapter as a
`Set<TransactionVersion> | undefined` (`TransactionVersion = 'legacy' | 0`). Check it **before**
building a v0 message; fall back to a legacy `Transaction` (or tell the user) when it is missing:

```ts
const { wallet } = useWallet();
const supported = wallet?.adapter.supportedTransactionVersions; // Set<TransactionVersion> | undefined
if (!supported)          throw new Error("Wallet doesn't report versioned-tx support");
if (!supported.has(0))   throw new Error("Wallet doesn't support v0 transactions");
```

Build a v0 message with `TransactionMessage.compileToV0Message()`, wrap it in a
`VersionedTransaction`, and hand it to the same `sendTransaction`:

```tsx
import {
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';

const {
  context: { slot: minContextSlot },
  value: { blockhash, lastValidBlockHeight },
} = await connection.getLatestBlockhashAndContext();

const instructions: TransactionInstruction[] = [
  SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipient, lamports: 1_000 }),
];

const message = new TransactionMessage({
  payerKey: publicKey,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message(/* optional address-lookup tables — see below */);

const vtx = new VersionedTransaction(message);
const signature = await sendTransaction(vtx, connection, { minContextSlot });
await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
```

A runnable end-to-end version of this (with user-rejection handling and UI state) is
[../examples/connect-and-send.tsx](../examples/connect-and-send.tsx).

---

## Address Lookup Tables (ALTs)

ALTs let a v0 transaction reference accounts by a 1-byte index instead of a full 32-byte key, so
you can pack far more accounts into one transaction. Pass the resolved lookup-table **accounts**
to `compileToV0Message`:

```ts
// 1. Fetch the on-chain lookup table account (created once, ahead of time — see note below).
const lookupTableAccount = (
  await connection.getAddressLookupTable(lookupTableAddress)
).value;
if (!lookupTableAccount) throw new Error('Lookup table not found');

// 2. Compile the v0 message WITH the table. Any account key present in the table is compressed.
const message = new TransactionMessage({
  payerKey: publicKey,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message([lookupTableAccount]);

const vtx = new VersionedTransaction(message);
const signature = await sendTransaction(vtx, connection, { minContextSlot });
```

Creating and warming a table is a **one-time on-chain setup** step (not something the connected
wallet does per send). With web3.js v1 it is `AddressLookupTableProgram`:

```ts
import { AddressLookupTableProgram } from '@solana/web3.js';

const slot = await connection.getSlot();
const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
  authority: publicKey,
  payer: publicKey,
  recentSlot: slot,
});
const extendIx = AddressLookupTableProgram.extendLookupTable({
  payer: publicKey,
  authority: publicKey,
  lookupTable: lookupTableAddress,
  addresses: [/* PublicKey[] you will reference later */],
});
// Send createIx + extendIx (via sendTransaction), then WAIT one slot before the table is
// usable — a table cannot be used in the same slot it was extended. After that, fetch it with
// getAddressLookupTable and pass it to compileToV0Message as shown above.
```

Only the *consuming* transaction needs the wallet's signature; table setup can be done by any
fee-payer/authority you control. Full ALT semantics are a web3.js/runtime topic — see the Solana
docs on Address Lookup Tables for the warm-up and deactivation lifecycle.

---

## `sendTransaction` vs `signTransaction` (+ manual send)

Use `sendTransaction` for the normal sign-and-send path. Reach for `signTransaction` — which is
**optional, so feature-detect it** — only when you need the *signed-but-unsent* bytes: to relay
through your own RPC, to add to a Jito bundle, or to co-sign server-side.

```ts
const { publicKey, signTransaction } = useWallet();
if (!signTransaction) throw new Error('Wallet cannot sign without sending');

const signed = await signTransaction(vtx);          // returns the signed transaction
// You now own broadcast + retries (this is where transaction-landing strategy lives):
const signature = await connection.sendRawTransaction(signed.serialize(), {
  skipPreflight: false,
  maxRetries: 0,          // e.g. disable RPC retries to run your own rebroadcast loop
  minContextSlot,
});
await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
```

`signAllTransactions` (also optional) signs a batch in one prompt — useful for a sequence you
broadcast yourself.

---

## Extra co-signers

If a transaction needs a signature from a keypair you hold locally (e.g. a newly-created account),
pass it via `options.signers` — the wallet signs for `publicKey`, and web3.js applies the local
signers too:

```ts
const newAccount = Keypair.generate();
const signature = await sendTransaction(tx, connection, {
  minContextSlot,
  signers: [newAccount],   // co-signs alongside the wallet
});
```

---

## Confirmation (do it against `lastValidBlockHeight`)

Always confirm with the **same** `blockhash` + `lastValidBlockHeight` you built the transaction
with. This is the deterministic expiry model: once the cluster passes `lastValidBlockHeight`, the
blockhash is dead and the transaction can never land, so `confirmTransaction` stops waiting
instead of hanging.

```ts
const result = await connection.confirmTransaction(
  { blockhash, lastValidBlockHeight, signature },
  'confirmed',
);
if (result.value.err) {
  throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
}
```

`getLatestBlockhashAndContext` gives you `blockhash`, `lastValidBlockHeight`, **and** the context
`slot` — thread that slot through as `minContextSlot` so the wallet and your confirmation agree on
a consistent RPC view. For under-priced fees, dropped transactions, and rebroadcast loops (which
`confirmTransaction` alone does not solve), see the **transaction-landing** skill.

---

## Guidelines

**DO**
- Feature-gate v0 on `wallet.adapter.supportedTransactionVersions?.has(0)` before building a
  `VersionedTransaction`.
- Fetch a fresh blockhash with `getLatestBlockhashAndContext` and pass `minContextSlot` through
  both `sendTransaction` and `confirmTransaction`.
- Confirm with the matching `{ blockhash, lastValidBlockHeight, signature }`.
- Use `signTransaction` (feature-detected) only when you need signed-but-unsent bytes.
- Pass local co-signers via `options.signers`.

**DON'T**
- Call `connection.sendRawTransaction` after `sendTransaction` — the wallet already broadcast it.
- Assume every wallet signs v0 — legacy-only wallets report `undefined` capabilities.
- Confirm against a blockhash different from the one you signed — it will time out.
- Treat user rejection (provider code `4001`) as a retryable error.

---

## Common Errors

### Error: "Wallet doesn't support versioned transactions"
**Cause:** you built a v0 `VersionedTransaction` for a wallet whose
`adapter.supportedTransactionVersions` is `undefined` or lacks `0`.
**Solution:** feature-gate on `supportedTransactionVersions?.has(0)`; fall back to a legacy
`Transaction`. See [troubleshooting.md](troubleshooting.md).

### Error: transaction "sent" but never confirms / `TransactionExpiredBlockheightExceededError`
**Cause:** confirming against a stale blockhash, or the wallet used a lagging RPC node.
**Solution:** fresh `getLatestBlockhashAndContext`, thread `minContextSlot`, confirm with the
matching values. Persistent landing failures are a fee/rebroadcast problem — see the
**transaction-landing** skill.

### Error: `signTransaction is not a function`
**Cause:** `signTransaction` / `signAllTransactions` are optional and absent on some wallets.
**Solution:** feature-detect before calling; only `sendTransaction` is guaranteed. See
[../resources/api-reference.md](../resources/api-reference.md).

---

## References

- Wallet Adapter `APP.md` (sendTransaction usage): https://github.com/anza-xyz/wallet-adapter/blob/master/APP.md
- web3.js v1 `VersionedTransaction` / `TransactionMessage`: https://solana.com/docs/core/transactions/versions
- Address Lookup Tables: https://solana.com/docs/advanced/lookup-tables
- Confirmation & blockhash expiry: https://solana.com/docs/core/transactions/confirmation
- Landing (fees, retries, Jito): [../../transaction-landing/SKILL.md](../../transaction-landing/SKILL.md)
- SKILL.md "Sending a transaction": [../SKILL.md](../SKILL.md)
</content>
</invoke>
