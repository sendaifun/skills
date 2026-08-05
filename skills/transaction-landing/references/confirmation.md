# Confirmation — Rebroadcast, Expiry, Durable Nonces, Safe Retry

A successful `sendTransaction` RPC response means *the RPC accepted your bytes* — not that the transaction landed. Under congestion, RPCs routinely accept a transaction and then drop it from the mempool before it reaches a leader. **Landing is your job:** rebroadcast the same bytes and poll until the chain confirms or the lifetime expires.

## The rebroadcast-and-confirm loop

```typescript
import { Connection } from '@solana/web3.js';

async function sendAndConfirm(
  connection: Connection,
  rawTx: Uint8Array,           // tx.serialize() — signed ONCE, reused every resend
  lastValidBlockHeight: number,
  signature: string,           // bs58 of tx.signatures[0]
  { pollMs = 2_000, timeoutMs = 90_000 } = {},
): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // (Re)broadcast the IDENTICAL bytes. Idempotent: the network dedupes by signature.
    try {
      await connection.sendRawTransaction(rawTx, { skipPreflight: true, maxRetries: 0 });
    } catch (e: any) {
      // "already been processed" == it LANDED. Success, not failure.
      if (/already.*processed/i.test(e.message)) return signature;
      // Any other send error: fall through and let status polling decide.
    }

    // Did it confirm?
    const { value } = await connection.getSignatureStatuses([signature]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
        return signature;
      }
    }

    // Has the blockhash lifetime expired? If so it can NEVER land — stop.
    const height = await connection.getBlockHeight('confirmed');
    if (height > lastValidBlockHeight) {
      throw new BlockhashExpiredError(signature);   // see safe-retry below
    }

    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`Confirmation timed out (still unexpired): ${signature}`);
}
```

### Why resend the same bytes (not `maxRetries`)
`sendRawTransaction({ maxRetries: N })` delegates rebroadcast to the RPC's own loop, which is opaque and stops when the RPC decides. Setting `maxRetries: 0` and resending yourself gives you control over cadence and a hard stop at blockhash expiry. Resending is safe because the bytes — and therefore the signature — are identical; validators dedupe duplicate signatures.

### Expiry is the real deadline
A transaction is dead the moment `currentBlockHeight > lastValidBlockHeight` (~150 slots, 60–90s after the blockhash). Polling `getSignatureStatuses` forever is pointless past that — it will never confirm. Always gate the loop on block height, not just a wall-clock timeout.

### Commitment levels
- `processed` — seen by one node; can still be rolled back. Don't act on it.
- `confirmed` — supermajority voted; safe for most UX and chaining. **Default.**
- `finalized` — rooted, irreversible. Require it only before irreversible downstream actions (off-ramp, cross-chain message, accounting settlement).

## Durable nonces

Recent blockhashes expire in ~90s. When you need a transaction to stay valid for minutes or hours — offline signing, multisig collection, or an **agent that may retry over a long window** — use a durable nonce instead.

A nonce account stores a "nonce" that serves as the transaction's blockhash and only advances when consumed. Mechanics:

1. Create a nonce account once (`SystemProgram.createNonceAccount`); fund it rent-exempt.
2. Read the current nonce: `connection.getNonce(nonceAccount)` → `nonce` value.
3. Make `SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey })` the **first** instruction.
4. Use the nonce value as `recentBlockhash` when compiling the message.

The transaction stays valid until the nonce advances (i.e. until *this* transaction lands). That makes the same signed bytes rebroadcastable indefinitely — the ideal substrate for safe agentic retry, because you never have to rebuild (and risk a double).

```typescript
const nonceInfo = await connection.getNonce(nonceAccount);
const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: nonceInfo!.nonce,        // the durable nonce, not a blockhash
  instructions: [
    SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: payer.publicKey }),
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ...applicationInstructions,
  ],
}).compileToV0Message();
```

## Agentic safe-retry

When `sendAndConfirm` throws `BlockhashExpiredError`, an autonomous agent must **not** reflexively rebuild and resend — the original might have landed in a race. Decide from on-chain truth:

```typescript
class BlockhashExpiredError extends Error {
  constructor(public signature: string) { super(`Blockhash expired before confirmation: ${signature}`); }
}

async function landWithSafeRetry(
  connection: Connection,
  build: () => Promise<{ raw: Uint8Array; signature: string; lastValidBlockHeight: number }>,
  maxRebuilds = 3,
): Promise<string> {
  for (let attempt = 0; attempt < maxRebuilds; attempt++) {
    const { raw, signature, lastValidBlockHeight } = await build();
    try {
      return await sendAndConfirm(connection, raw, lastValidBlockHeight, signature);
    } catch (e) {
      if (!(e instanceof BlockhashExpiredError)) throw e;   // on-chain failure: never retry

      // EXPIRED is ambiguous: the prior tx might still have landed. Verify before rebuilding.
      const { value } = await connection.getSignatureStatuses([e.signature], {
        searchTransactionHistory: true,
      });
      if (value[0] && !value[0].err) return e.signature;     // it DID land — do not resend
      // Confirmed not-landed → safe to rebuild with a fresh blockhash and try again.
    }
  }
  throw new Error('Exhausted safe rebuild attempts without landing');
}
```

### The invariants (see SKILL.md → Agentic Safety)
1. Retry = **rebroadcast identical bytes**, never sign a fresh transaction for the same action while the first could land.
2. Rebuild **only** after confirming the prior signature did **not** land (`searchTransactionHistory: true`).
3. `already processed` and a no-error status both mean **success** — return, don't resend.
4. For value transfers, prefer a **durable nonce** so retry never requires a rebuild.

This is the exact failure mode behind real agentic double-spends: a flow that, on interruption, rebuilt and rebroadcast a *funding* transaction and funded the target twice. Verifying on-chain state before rebuilding is what prevents it.
