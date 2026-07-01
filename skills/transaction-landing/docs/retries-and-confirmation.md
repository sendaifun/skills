# Retries & Confirmation

The deep dive behind **steps 4–7** of the landing checklist in `../SKILL.md`: how a blockhash
lives and dies, why the **client** must own rebroadcast (`skipPreflight: true` + `maxRetries: 0`),
how to confirm against *expiry* instead of a wall-clock timeout, and how a **durable nonce**
removes expiry entirely for offline / long-lived / multisig signing.

Baseline client: **`@solana/web3.js` 1.98.4**. Modern equivalents (`@solana/kit` 7.0.0 +
`@solana-program/system` 0.12.2) appear as secondary notes. Node 20+. This document does **not**
re-derive fee estimation (see `priority-fees.md`) or Jito bundle status (see `jito-bundles.md`).

---

## 1. Blockhash lifecycle — the clock every send races

A signed transaction carries a `recentBlockhash`. The runtime accepts it only while the chain's
**block height** is `<= lastValidBlockHeight`. Fetch both values together:

```ts
import { Connection } from "@solana/web3.js"; // 1.98.4

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
// blockhash:            base58 string -> set as the message's recentBlockhash
// lastValidBlockHeight: u64 -> your HARD timeout. Stop when getBlockHeight() exceeds it.
```

| Fact | Value |
|---|---|
| Validity window | ~**150 slots** after the slot the blockhash was produced |
| Wall-clock | ≈ **60–90 s** (varies with slot time) |
| Expiry condition | `currentBlockHeight > lastValidBlockHeight` |
| After expiry | The bytes are **permanently invalid** — resending does nothing; you must rebuild |

Two distinct symptoms come from this one clock:

- **"Blockhash not found"** — the validator/RPC has *no record* of that blockhash. Either it
  already aged out, or it was produced on a fork/node the processing leader hasn't seen yet.
  Usually means the sign→send gap was too long, or the blockhash came from a lagging RPC.
- **"Transaction expired" / "was not confirmed in N seconds"** — the blockhash *was* valid when
  sent, but block height passed `lastValidBlockHeight` before a leader included the tx.

> Mitigation baked into every step: fetch the blockhash with the **same commitment you send and
> confirm with**, minimize the sign→send gap, and treat `lastValidBlockHeight` as the only timeout.

### kit equivalent

```ts
import { createSolanaRpc } from "@solana/kit"; // 7.0.0
const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const { value: latest } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
// latest.blockhash, latest.lastValidBlockHeight (a bigint in kit)
```

---

## 2. Send flags — make the client own rebroadcast

The default `Connection.sendTransaction` behavior hides two decisions from you. Override both:

| Flag | Default | Set to | Why |
|---|---|---|---|
| `skipPreflight` | `false` | **`true`** | Skip the RPC's preflight simulation. Faster, and avoids a stale-blockhash preflight rejection on a time-sensitive send. **You must simulate client-side first** (you already do, to size CU) — see `priority-fees.md`. |
| `maxRetries` | RPC-chosen | **`0`** | Disable the RPC node's *own* automatic rebroadcast. The node otherwise resends on an opaque schedule you cannot tune; with `0`, **your code** decides when and how often to resend. |
| `preflightCommitment` | `finalized` | match your send commitment (e.g. `confirmed`) | Only used when `skipPreflight` is `false`. A `finalized` preflight against a `confirmed` blockhash can spuriously fail. |

```ts
const signature = await connection.sendRawTransaction(signedTx.serialize(), {
  skipPreflight: true,
  maxRetries: 0,
});
// A returned signature means "accepted for forwarding" — NOT "included in a block".
```

> **Security / correctness:** `skipPreflight: true` removes your last automatic guardrail. Always
> simulate the exact instruction set client-side before the first send, or you will pay base fees
> broadcasting a guaranteed-fail transaction. The Helius Sender and Jito's single-tx path also
> force preflight off (see `../resources/api-reference.md`, `jito-bundles.md`), so this discipline
> is mandatory on every escalation path too.

---

## 3. The manual rebroadcast loop

With `maxRetries: 0`, resubmission is yours. The pattern: **serialize the signed bytes once**, send
them, then re-send the *identical* bytes every ~2 s until a status confirms or the blockhash
expires. Resending the same signed transaction is **idempotent** — it has the same signature, and
the network dedups it; you cannot accidentally double-execute.

```ts
const raw = signedTx.serialize();               // serialize ONCE; rebroadcast these exact bytes
const signature = await connection.sendRawTransaction(raw, {
  skipPreflight: true,
  maxRetries: 0,
});

while (true) {
  // (a) success path — poll the signature's confirmation status
  const { value } = await connection.getSignatureStatuses([signature]);
  const status = value[0];
  if (status?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    break; // landed
  }

  // (b) expiry path — block height is the hard timeout, never a wall-clock timer
  const blockHeight = await connection.getBlockHeight("confirmed");
  if (blockHeight > lastValidBlockHeight) {
    throw new Error("blockhash expired — rebuild with a fresh blockhash and a higher fee");
  }

  // (c) rebroadcast the SAME bytes and wait
  await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  await new Promise((r) => setTimeout(r, 2000));
}
```

Why poll *both* signals: a leader can include your tx and then your RPC connection blips before you
observe it. Driving **expiry off block height** (which is monotonic and cheap to read) and
**success off signature status** means neither a missed websocket nor a slow status cache leaves you
hung. On expiry, the correct move is to **rebuild** — fresh blockhash, re-pull the fee estimate
(the market moved, that's *why* it didn't land), re-sign, resend — not to retry the dead bytes.

---

## 4. Confirmation strategies

### (a) Blockhash-aware `confirmTransaction` — the one-liner

`confirmTransaction` with the `{ signature, blockhash, lastValidBlockHeight }` form resolves on
**either** outcome — confirmed, or block height exceeded — so it can never hang forever. Internally
it opens a `signatureSubscribe` websocket and races it against the expiry height.

```ts
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
// ...build & sign with `blockhash`, then send (skipPreflight + maxRetries:0)...

const result = await connection.confirmTransaction(
  { signature, blockhash, lastValidBlockHeight },
  "confirmed", // target commitment
);
if (result.value.err) {
  throw new Error(`tx failed: ${JSON.stringify(result.value.err)}`);
}
```

**Caveat:** `confirmTransaction` confirms; it does **not** rebroadcast. Pair it with the
`maxRetries: 0` send and a separate resend loop, or use the explicit polling loop in §3 which does
both in one place. On a flaky websocket, prefer the §3 polling form.

### (b) Polling `getSignatureStatuses`

`getSignatureStatuses([sig])` returns, per signature, either `null` (not seen) or
`{ slot, confirmations, err, confirmationStatus }` where `confirmationStatus` is one of
`processed | confirmed | finalized`. By default it only searches the recent status cache
(~150 blocks); pass `{ searchTransactionHistory: true }` to also search older history when you need
a definitive "did this ever land?" answer.

```ts
const { value } = await connection.getSignatureStatuses([signature], {
  searchTransactionHistory: false, // true => also scan history (slower, definitive)
});
const s = value[0]; // null | { slot, confirmations, err, confirmationStatus }
```

### `signatureSubscribe` (websocket) vs polling — when to use which

| | `signatureSubscribe` (push) | Poll `getSignatureStatuses` (pull) |
|---|---|---|
| Latency | Lowest — fires the instant the sig reaches commitment | One poll interval of lag |
| RPC load | One subscription | N requests (one per interval) |
| Resilience | **Single-shot**; a dropped connection can miss the notification | Resilient; just keep polling |
| Already-landed tx | Will **not** retro-report a sig that landed before you subscribed | Reports it on the next poll |
| Best role | **Success** signal, latency-critical | **Success** signal + combine with block-height **expiry** |

```ts
// Raw websocket success notification (single-shot). The callback fires once, then auto-unsubscribes.
const subId = connection.onSignature(
  signature,
  (result) => {
    if (result.err) console.error("tx failed:", result.err);
    else console.log("tx confirmed");
  },
  "confirmed",
);
// Always also enforce expiry separately:
//   if ((await connection.getBlockHeight()) > lastValidBlockHeight) connection.removeSignatureListener(subId);
```

**Best practice:** drive **expiry by polling block height** (monotonic, never missed) and **success
by signature status** (push *or* pull). The §3 loop and the reference implementation in §5 do
exactly this.

> **kit equivalent:** `sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })` returns a
> `sendAndConfirmTransaction` function that confirms a transaction built with a blockhash lifetime
> via signature subscription, raising `SolanaError` on failure/expiry. Build `rpcSubscriptions`
> with `createSolanaRpcSubscriptions(wsUrl)`. For polling, `rpc.getSignatureStatuses([sig]).send()`.

### Commitment levels — and which to use

| Commitment | Meaning | Rollback risk | Latency | Use for |
|---|---|---|---|---|
| `processed` | Seen/executed by the current leader | **Yes** — can be dropped on a fork | Fastest | Optimistic UI only; never settle value on it |
| `confirmed` | Voted on by a supermajority of the cluster (~1 confirmation) | Practically negligible | ~1–2 s | **Default for apps & bots** — best latency/safety balance |
| `finalized` | Rooted, >31 confirmations, irreversible | None | ~13 s+ | Exchange credits, bridges, accounting — settlement-grade |

Use one commitment **consistently** across `getLatestBlockhash`, send/preflight, and confirm. Mixing
(e.g. a `finalized` blockhash with `processed` confirmation, or vice-versa) is a common source of
spurious "blockhash not found" and premature "expired" outcomes.

---

## 5. Robust send-and-confirm — reference implementation

This is the canonical loop the SKILL.md checklist describes: fetch a fresh blockhash, build+sign,
send with `maxRetries: 0`, rebroadcast the same bytes, confirm against block height, and on expiry
**rebuild** with a fresh blockhash (bounded attempts). `buildAndSign` is a caller-supplied callback
so the fee can be re-estimated and the tx re-signed on every attempt. A drop-in, parameterized
version of this lives in `../templates/robust-sender.ts`; a fully runnable script is
`../examples/robust-send-and-confirm.ts`.

```ts
import { Connection, VersionedTransaction } from "@solana/web3.js"; // 1.98.4

/**
 * Land a transaction reliably under congestion.
 *
 * @param buildAndSign  Builds & signs a v0 tx for the given blockhash. Re-invoked on every
 *                       blockhash attempt so you can re-pull the priority-fee estimate and re-sign.
 *                       MUST set the message's recentBlockhash to `blockhash`.
 * @returns the confirmed transaction signature
 */
async function landTransaction(
  connection: Connection,
  buildAndSign: (
    blockhash: string,
    lastValidBlockHeight: number,
  ) => Promise<VersionedTransaction>,
  opts: { maxBlockhashAttempts?: number; pollIntervalMs?: number; commitment?: "confirmed" | "finalized" } = {},
): Promise<string> {
  const maxBlockhashAttempts = opts.maxBlockhashAttempts ?? 4;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const commitment = opts.commitment ?? "confirmed";

  for (let attempt = 1; attempt <= maxBlockhashAttempts; attempt++) {
    // Step 4: fresh blockhash + the expiry height for this attempt.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);

    // Step 5: caller re-fees and re-signs against THIS blockhash. Serialize once.
    const signedTx = await buildAndSign(blockhash, lastValidBlockHeight);
    const raw = signedTx.serialize();

    // Step 6: send with the client in control of retries.
    const signature = await connection.sendRawTransaction(raw, {
      skipPreflight: true,
      maxRetries: 0,
    });

    // Step 7: rebroadcast + confirm, expiry == block height (not a wall clock).
    while (true) {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) {
        throw new Error(`tx ${signature} failed on-chain: ${JSON.stringify(status.err)}`);
      }
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return signature; // landed
      }

      const blockHeight = await connection.getBlockHeight(commitment);
      if (blockHeight > lastValidBlockHeight) break; // expired -> rebuild outer loop

      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    // Before retrying with a new blockhash, make SURE it didn't actually land late.
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    if (value[0] && !value[0].err) return signature;
    // else: truly expired -> loop, fresh blockhash + fresh fee on the next attempt.
  }

  throw new Error(`failed to land after ${maxBlockhashAttempts} blockhash attempts`);
}
```

Key properties:

- **Idempotent rebroadcast** within an attempt (same signed bytes, same signature).
- **Definitive expiry handling**: a `searchTransactionHistory: true` re-check before each rebuild
  prevents the classic double-spend footgun — never resend *different* bytes for the same intent
  until you've confirmed the previous attempt truly did not land.
- **Bounded**: caps total attempts so it cannot loop forever during an outage.
- The `buildAndSign` callback is where you raise the **CU price** on each retry (the market moved),
  per `priority-fees.md`.

---

## 6. Durable nonce — eliminate expiry for offline / long-lived / multisig signing

When a transaction may be signed now and submitted minutes, hours, or days later — offline signing,
cold-wallet / multisig approval flows, scheduled or queued transactions — a recent blockhash will
have long expired by submission time. A **durable nonce** replaces the recent blockhash with a
stored, non-expiring value, so the signed transaction **never expires**.

Mechanics:

1. Create and fund a rent-exempt **nonce account**. It stores the *current nonce* (a blockhash-like
   value) and an *authority* (who may advance or withdraw it).
2. Use the **stored nonce value as the transaction's `recentBlockhash`** — not `getLatestBlockhash`.
3. The transaction's **FIRST instruction MUST be `nonceAdvance`**. Executing it consumes and rotates
   the nonce, so the transaction is valid **exactly once** (replay-proof). If `nonceAdvance` is not
   the first instruction — or is absent — the transaction is rejected or becomes replayable.

> Works identically on **devnet, testnet, and mainnet**. The nonce account is plain System-program
> state; only its rent and authority differ from a throwaway account.

### web3.js 1.98.4

```ts
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

// --- one-time: create & fund the nonce account ---
const nonceKeypair = Keypair.generate();
const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);

const createTx = new Transaction().add(
  SystemProgram.createNonceAccount({
    fromPubkey: payer.publicKey,
    noncePubkey: nonceKeypair.publicKey,
    authorizedPubkey: payer.publicKey, // the nonce authority (advances / withdraws)
    lamports: rent,
  }),
);
// createNonceAccount bundles createAccount + nonceInitialize. Both keypairs sign.
await sendAndConfirmTransaction(connection, createTx, [payer, nonceKeypair]);

// --- later: read the current nonce value ---
const info = await connection.getAccountInfo(nonceKeypair.publicKey);
const nonceAccount = NonceAccount.fromAccountData(info!.data);
const nonceValue = nonceAccount.nonce; // base58 string — used as recentBlockhash

// --- build a durable transaction ---
const tx = new Transaction();
tx.add(
  // FIRST instruction MUST be advanceNonce:
  SystemProgram.nonceAdvance({
    noncePubkey: nonceKeypair.publicKey,
    authorizedPubkey: payer.publicKey, // must be signed by the nonce authority
  }),
  /* ...your real instructions... */
);
tx.recentBlockhash = nonceValue;   // the durable nonce, NOT getLatestBlockhash
tx.feePayer = payer.publicKey;
// Sign now, or hand off for offline / multisig signing. It will not expire until the nonce advances.
// tx.sign(payer);  // or partialSign across signers, collect signatures, then submit any time.
```

To recover rent, `SystemProgram.nonceWithdraw({ noncePubkey, authorizedPubkey, toPubkey, lamports })`
drains the account (the nonce authority signs).

### kit 7.0.0 equivalent

web3.js' `createNonceAccount` is a convenience that combines *create* + *initialize*; kit splits it:

```ts
import { getCreateAccountInstruction } from "@solana-program/system"; // 0.12.2
import {
  getInitializeNonceAccountInstruction, // initialize nonce state in the freshly created account
  getAdvanceNonceAccountInstruction,    // MUST be the first instruction of the durable tx
  getWithdrawNonceAccountInstruction,   // reclaim rent
} from "@solana-program/system";
// Build (one-time): getCreateAccountInstruction({ space: NONCE_ACCOUNT_LENGTH(80), programAddress: SYSTEM })
//                    -> getInitializeNonceAccountInstruction({ nonceAccount, nonceAuthority })
// Durable tx: prepend getAdvanceNonceAccountInstruction({ nonceAccount, nonceAuthority }) and set the
//   message lifetime to the nonce via:
//     setTransactionMessageLifetimeUsingDurableNonce(
//       { nonce, nonceAccountAddress, nonceAuthorityAddress }, txMessage)
```

> `setTransactionMessageLifetimeUsingDurableNonce` is a real export of `@solana/transaction-messages` 7.0.0
> (re-exported by `@solana/kit` 7.0.0); the `@solana-program/system` 0.12.2 nonce builders
> (`getInitializeNonceAccountInstruction` / `getAdvanceNonceAccountInstruction` / `getWithdrawNonceAccountInstruction`)
> are verified from source.

### When to use a durable nonce vs a fresh blockhash

| Situation | Use |
|---|---|
| Normal online send, sign→send within seconds | **Fresh blockhash** + the §3 rebroadcast loop |
| Offline signing (air-gapped signer) | **Durable nonce** |
| Multisig / governance where approvals take minutes–days | **Durable nonce** |
| Scheduled / queued transaction submitted later | **Durable nonce** |
| High-frequency bot spamming many independent txns | **Fresh blockhash** (a nonce account serializes on its own write lock) |

A runnable two-phase script (create the nonce account, then build & sign a non-expiring tx) is
`../examples/durable-nonce.ts`.

---

## Guidelines

- **DO** capture `lastValidBlockHeight` alongside the blockhash and treat it as the **only** timeout.
  **DON'T** confirm on a wall-clock `setTimeout` — it is unrelated to actual expiry.
- **DO** send with `skipPreflight: true` + `maxRetries: 0` and rebroadcast yourself.
  **DON'T** rely on the RPC's hidden auto-retry; it is opaque and untunable.
- **DO** simulate client-side before any `skipPreflight` send.
  **DON'T** broadcast a tx you have not simulated — you forfeited the preflight guardrail.
- **DO** resend the **same** signed bytes during one blockhash lifetime (idempotent).
  **DON'T** resend *different* bytes for the same intent without first checking the prior signature
  with `searchTransactionHistory: true` — that risks a double-execute.
- **DO** rebuild with a fresh blockhash **and a re-pulled fee** on expiry.
  **DON'T** retry the dead bytes — an expired blockhash can never land.
- **DO** drive expiry by block height and success by signature status.
  **DON'T** depend on a single `signatureSubscribe` notification — a dropped socket loses it.
- **DO** use one commitment consistently across blockhash/send/confirm.
  **DON'T** mix `finalized` and `processed`/`confirmed` across the lifecycle.
- **DO** make `nonceAdvance` the first instruction of a durable-nonce tx.
  **DON'T** use `getLatestBlockhash` as the `recentBlockhash` of a durable-nonce tx.

---

## Common Errors

(Confirmation / nonce-specific. The exhaustive catalog — under-pricing, write-lock contention, Jito
failures — is in `troubleshooting.md`.)

### Error: "Blockhash not found"
**Cause:** The `recentBlockhash` is stale or came from a lagging/forked RPC, so the processing node
has no record of it. Common when the sign→send gap is too long, or blockhash and send use different
nodes/commitments.
**Solution:** Fetch with the **same commitment** you send with (`getLatestBlockhash("confirmed")`)
immediately before signing; minimize the sign→send gap. During CU-sizing simulation, pass
`replaceRecentBlockhash: true` so the RPC swaps in a valid blockhash for sim only. If it expired
mid-flight, rebuild from a fresh blockhash.

### Error: "Transaction was not confirmed in N seconds" / transaction expired
**Cause:** Block height passed `lastValidBlockHeight` before inclusion — underpriced, dropped before
reaching a leader, or the RPC stopped rebroadcasting. The bytes are now permanently invalid.
**Solution:** This is *expiry*, not failure. Confirm it truly did not land
(`getSignatureStatuses(..., { searchTransactionHistory: true })`), then rebuild with a fresh
blockhash, a **higher CU price** from a live estimate, `maxRetries: 0`, and the §3 loop. Escalate to
the Helius Sender or a Jito bundle under heavy congestion (`../resources/api-reference.md`,
`jito-bundles.md`).

### Error: transaction "succeeds" on send but never confirms
**Cause:** A returned signature only means the RPC accepted the tx for forwarding — not that a leader
included it. With an underpriced fee it is deferred and expires. (Detailed in `troubleshooting.md`.)
**Solution:** Treat a returned signature as "submitted", never "confirmed". Drive success off
signature status and expiry off block height; raise the CU price on retry.

### Error: durable-nonce tx rejected or replayed
**Cause:** `nonceAdvance` is not the **first** instruction (or is missing), or the tx used a recent
blockhash from `getLatestBlockhash` instead of the stored `NonceAccount.nonce` value.
**Solution:** Prepend `SystemProgram.nonceAdvance(...)` at instruction index 0 (signed by the nonce
authority) and set `recentBlockhash` to the current `NonceAccount.nonce`.

---

## References

- Solana Docs — Transactions & confirmation: https://solana.com/docs/core/transactions
- Solana Docs — Retrying transactions: https://solana.com/docs/core/transactions/retry
- Solana Docs — `getLatestBlockhash` / `lastValidBlockHeight`: https://solana.com/docs/rpc/http/getlatestblockhash
- Solana Docs — `getSignatureStatuses`: https://solana.com/docs/rpc/http/getsignaturestatuses
- Solana Docs — `isBlockhashValid`: https://solana.com/docs/rpc/http/isblockhashvalid
- Solana Cookbook — Durable nonces / offline transactions: https://solana.com/developers/cookbook/transactions/offline-transactions
- Helius Blog — How to best send Solana transactions under congestion: https://www.helius.dev/blog/solana-congestion-how-to-best-send-solana-transactions
- `@solana-program/system` 0.12.2 (kit nonce builders): https://www.npmjs.com/package/@solana-program/system
