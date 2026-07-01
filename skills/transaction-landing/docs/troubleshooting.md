# Troubleshooting — Why Your Transaction Didn't Land

The exhaustive Cause/Solution catalog behind the headline errors in `../SKILL.md`. Every entry is
a **symptom → root cause → exact fix**, with a pointer to the deep dive that implements the fix.
`../SKILL.md` keeps the six most common; this file is the full reference.

Baseline client: **`@solana/web3.js` 1.98.4**. Kit (`@solana/kit` 7.0.0) behaves identically at
the RPC layer.

**First, classify the failure.** Almost every "my tx didn't work" reduces to one of four classes:

| Class | Telltale | Jump to |
|---|---|---|
| **Never accepted** | Error thrown by `sendTransaction`/preflight before you got a signature | Blockhash not found · Sim failed · skipPreflight burned fees |
| **Accepted, never included** | You got a signature, but it never confirms; expires | Expired · Dropped under congestion · AccountInUse · Underpriced |
| **Included, but failed** | `getSignatureStatuses` shows the sig with an `err` | exceeded CUs meter · custom program error |
| **Jito-specific** | Bundle/relayer path | Bundle not landing · 429 · bundleOnly via public RPC |

A signature returned from `sendRawTransaction` means **"the RPC accepted it for forwarding"** —
never **"a leader included it"**. Always confirm against `lastValidBlockHeight` (see
`retries-and-confirmation.md`).

---

## Acceptance failures (no usable signature)

### Error: "Blockhash not found"
**Symptom:** Preflight (or the leader) rejects the tx with `BlockhashNotFound`.
**Cause:** The tx's `recentBlockhash` is unknown to the validating node. Three common roots:
(1) the blockhash already **expired** before send; (2) it was fetched from a **lagging or forked
RPC** that the validating node hasn't caught up to (or vice-versa); (3) the sign→send gap was too
long under load.
**Solution:**
- Fetch the blockhash with the **same commitment** you confirm at — `getLatestBlockhash("confirmed")` —
  immediately before signing, and minimize the sign→send latency.
- Use **one RPC** (or a load balancer with sticky routing) for `getLatestBlockhash`, `sendTransaction`,
  and confirmation, so all three see the same fork.
- During CU sizing, simulate with `replaceRecentBlockhash: true` so a stale placeholder blockhash
  never causes a sim-time `BlockhashNotFound` (see `priority-fees.md`).
- If it expired mid-flight, **rebuild** from a fresh blockhash — the bytes are permanently invalid.

### Error: simulation fails / "Transaction simulation failed"
**Symptom:** `simulateTransaction` returns `value.err`, or a preflight send throws before a signature.
**Cause:** A genuine program error (bad accounts, failed constraint, insufficient funds), an
unsigned tx simulated without `sigVerify: false`, or a stale blockhash.
**Solution:** Read `sim.value.err` and `sim.value.logs` first — the program log usually names the
failing instruction. While **sizing**, pass `{ replaceRecentBlockhash: true, sigVerify: false }`
(see `priority-fees.md`). Fix the underlying error before sending; do **not** mask it with
`skipPreflight`.

### Error: `skipPreflight` burned fees on a guaranteed-fail tx
**Symptom:** You paid the base + priority fee, but the tx landed with an `err` (e.g. a slippage or
constraint failure). Because preflight was skipped, you got no early warning.
**Cause:** `skipPreflight: true` (mandatory for Helius Sender, Jito `/transactions`, and most
time-sensitive sends) removes the RPC's pre-send simulation. A tx that would have been caught by
preflight is broadcast anyway, lands, fails, and you pay for it.
**Solution:** **Always simulate client-side before any `skipPreflight` send** — you already do this
to size CU (`priority-fees.md`). Treat a non-empty `sim.value.err` as a hard stop. Re-simulate close
to send time for state-sensitive txns (swaps with slippage, auctions).

---

## Inclusion failures (signature returned, never confirms)

### Error: "Transaction was not confirmed in N seconds" / transaction expired
**Symptom:** `confirmTransaction` times out, or your loop hits `getBlockHeight() > lastValidBlockHeight`.
**Cause:** The chain's block height passed `lastValidBlockHeight` (~150 slots ≈ 60–90 s) before the
tx was included. It was underpriced, dropped before reaching the leader, or the RPC stopped
rebroadcasting. **The bytes are now permanently invalid** — resending them does nothing.
**Solution:** This is an **expiry**, not a chain failure.
1. Confirm it truly didn't land: `getSignatureStatuses([sig])` (it may have squeaked in at the boundary).
2. Rebuild from a **fresh** `getLatestBlockhash`, with a **higher** CU price from a live estimate.
3. Send with `maxRetries: 0` and **rebroadcast the same bytes every ~2 s** until confirmed or the
   new `lastValidBlockHeight` (see `retries-and-confirmation.md`, `templates/robust-sender.ts`).
4. Under heavy congestion, escalate to the **Helius Sender** or a **Jito bundle**.
Drive expiry off **block height**, never a wall-clock timer.

### Error: transaction dropped under congestion (silently disappears)
**Symptom:** A valid tx gets a signature, never errors, and simply never appears — repeatable
during launches, liquidation cascades, or NFT mints.
**Cause:** The network is saturated. Your tx either never reached the current leader's TPU in time,
or was deferred behind higher-priority txns each slot until the blockhash expired. A generic public
RPC's opaque auto-rebroadcast cannot compete.
**Solution:**
- **Raise the priority fee** to a live `High`/p75–`VeryHigh`/p90 estimate, scoped to your
  write-locked accounts (`priority-fees.md`).
- Take control of sending: `skipPreflight: true` + `maxRetries: 0` + manual rebroadcast
  (`retries-and-confirmation.md`).
- Escalate to a **staked path**: the **Helius Sender** (dual-routes to SWQoS validators + Jito;
  requires both a ≥200,000-lamport Jito tip and a priority fee — see `resources/api-reference.md`)
  or a **Jito bundle** (`jito-bundles.md`).
- Shrink the tx: fewer instructions and Address Lookup Tables (v0 `VersionedTransaction`) mean
  fewer write locks and smaller bytes, both of which improve scheduling.

### Error: "Account in use" / `AccountInUse` (write-lock contention, tx repeatedly deferred)
**Symptom:** The tx is perfectly valid but keeps getting deferred; logs/errors mention an account
already in use. Common against a hot AMM pool, a popular mint, or an always-the-same Jito tip account.
**Cause:** Every account a tx **writes** is locked for the slot, and a single writable account has a
per-slot CU ceiling. Under load the leader serializes writers to a hot account and takes the
**highest priority fee** first; yours is continuously bumped.
**Solution:**
- **Bid against the contended account specifically:** scope `getRecentPrioritizationFees`
  (`lockedWritableAccounts`) or Helius `getPriorityFeeEstimate` (pass the serialized tx) to your
  write-locked accounts so the price reflects *their* contention, not a global average.
- **Reduce writable accounts:** use ALTs, split work, or write to a less-contended account where the
  protocol allows.
- **Add jitter and retry:** randomize the rebroadcast interval slightly so many bots don't collide on
  the same slot boundary.
- **For Jito specifically:** all 8 tip accounts are write-locked — **randomize** which one you tip per
  submission; always hitting the same one serializes your bundles (`jito-bundles.md`).

### Error: simulation succeeds but the tx never lands (underpriced)
**Symptom:** `simulateTransaction` returns no error and `sendRawTransaction` returns a signature, yet
the tx never confirms and finally expires.
**Cause:** Simulation validates **logic and CU**, not **inclusion**. A correct tx with a priority
fee **below the live market** is deferred every slot and expires unincluded. A returned signature
means "submitted", not "confirmed".
**Solution:** Set **both** budget ixs with a live price (`High`/p75 or higher during events) and a
simulation-sized limit (`priority-fees.md`); confirm against `lastValidBlockHeight`
(`retries-and-confirmation.md`). If it still won't land, escalate to the Sender/Jito. **Never treat a
returned signature as confirmation** — always poll `getSignatureStatuses`.

---

## Execution failures (included, but the tx itself failed)

### Error: "exceeded CUs meter" / exceeded compute budget
**Symptom:** The tx **lands** (you can see it on an explorer) but failed; logs end with a compute
budget overrun.
**Cause:** Real CU consumption exceeded the declared `setComputeUnitLimit`. Either you sized with no
headroom, or account state changed between sizing and send (an account got initialized, a `Vec`
grew), pushing consumption over the limit.
**Solution:** Re-simulate close to send time and keep the **`× 1.1` headroom**; clamp to 1,400,000.
If one instruction legitimately needs more than 1.4M CU, **split** the work across instructions or
transactions — 1.4M is a hard per-tx ceiling (`priority-fees.md`). Do not "fix" this by removing the
limit ix; that just bills you against the inflated default.

### Error: tx landed with a custom program error / `InstructionError`
**Symptom:** `getSignatureStatuses` shows the sig with `err: { InstructionError: [i, { Custom: n }] }`.
**Cause:** The instruction at index `i` failed inside the program (e.g. slippage exceeded, a
constraint, insufficient balance). This is an application failure, not a landing failure — the tx
was included and you paid for it.
**Solution:** Decode the program's error code `n` from its IDL/source. For market-sensitive txns
(swaps), re-simulate immediately before send and widen tolerances or refresh quotes. Landing tooling
cannot fix a logic error — fix it upstream, then re-send.

---

## Jito-specific failures

### Error: Jito bundle silently not landing
**Symptom:** `sendBundle` returns a `bundle_id`, but `getInflightBundleStatuses` never reaches
`Landed` (stays `Pending`, then drops), and the txns never appear on-chain. No error is surfaced.
**Cause:** Usually one of —
1. **Tip too low** — 1,000 lamports is the protocol *minimum*, not a competitive bid.
2. **Tip not in the bundle** — sent as a separate, non-bundled tx, so it is **not credited**.
3. **Tip not in the last tx** — out-of-convention placement; the tip should be the last instruction
   of the last tx so work commits before the tip.
4. **A tx in the bundle fails simulation** — bundles are all-or-nothing; one failing tx drops the lot.
5. **Stale blockhash** — bundles expire like any tx.
6. **More than 5 txns** — over the bundle limit; rejected.
**Solution:** Put the tip **inside the bundle's last tx** (`SystemProgram.transfer` to a **random**
one of the 8 tip accounts), size it from `GET https://bundles.jito.wtf/api/v1/bundles/tip_floor`
(≥`landed_tips_75th_percentile`, scaling to 95th/99th during launches; percentiles are in **SOL**,
×1e9 for lamports). Keep **≤5 fully-signed txns** with a **fresh blockhash**. Simulate each tx
client-side first. Poll `getInflightBundleStatuses` and fall back to a fresh bundle on
`Failed`/`Invalid`/expiry. See `jito-bundles.md` and `resources/jito-endpoints.md`.

### Error: Jito `429 Too Many Requests`
**Symptom:** `sendBundle` or a status poll returns HTTP 429.
**Cause:** The default Jito rate limit is **1 request/second/IP per region**. Fanning a submission
out to every region from one IP, or polling status too aggressively, trips it.
**Solution:** Submit to the **single region nearest your server**, not all regions. Throttle status
polls to ~1–2 s. Combine `sendBundle` + status into a paced loop. For higher limits, request UUID
auth from Jito and pass it (`x-jito-auth` header or `?uuid=`). See `resources/jito-endpoints.md`.

### Error: `bundleOnly` tx landed via public RPC without revert protection
**Symptom:** A tx you intended to send as a revert-protected single-tx bundle (`bundleOnly=true`)
landed anyway — and landed **failed**, costing fees, with no protection.
**Cause:** The **same signed tx** was also broadcast to a public RPC (or the RPC's auto-rebroadcast
forwarded it). Once any leader sees those bytes it can include them, bypassing the Jito
all-or-nothing guarantee.
**Solution:** When relying on `bundleOnly=true` / `/api/v1/transactions` for revert protection, send
the bytes **only** through Jito — do not also `sendTransaction` to a public RPC, and use
`maxRetries: 0` so no node auto-rebroadcasts. See `jito-bundles.md`.

---

## Durable nonce failures

### Error: durable-nonce tx rejected or replayed
**Symptom:** A durable-nonce tx is rejected as having an invalid blockhash, or (worse) the same
signed tx executes more than once.
**Cause:** Either `nonceAdvance` is **not the first instruction** (or is missing), or the tx used
`getLatestBlockhash` instead of the **stored nonce value** as its `recentBlockhash`. The runtime
only treats a tx as durable when `nonceAdvance` is instruction index 0; otherwise it is validated as
a normal (expiring, replayable-window) tx.
**Solution:** Prepend `SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey })` as
**instruction index 0**, and set `recentBlockhash` to the current `NonceAccount.nonce` value (read
via `NonceAccount.fromAccountData`). Executing `nonceAdvance` rotates the nonce, making the tx valid
**exactly once** (replay-proof). See `retries-and-confirmation.md` and `examples/durable-nonce.ts`.

### Error: "nonce account not found" / nonce value stale
**Symptom:** Build fails reading the nonce, or the tx is rejected because the stored nonce no longer
matches.
**Cause:** The nonce account wasn't created/funded (rent-exempt) yet, or it was **advanced by another
transaction** since you read it — each advance rotates the nonce, invalidating any tx built on the
previous value.
**Solution:** Create and fund the nonce account once (`SystemProgram.createNonceAccount`,
`NONCE_ACCOUNT_LENGTH`, rent-exempt). **Serialize** use of a single nonce account — only one in-flight
tx per nonce at a time; re-read the current value (`NonceAccount.fromAccountData`) right before
building each tx. For parallel flows, use **one nonce account per signer/queue**. See
`retries-and-confirmation.md`.

---

## Quick diagnostic recipes

```ts
// Did it actually land, or just get accepted?  (signature != confirmation)
const { value } = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
console.log(value[0]); // null = never seen | { err } = landed-failed | confirmationStatus = landed-ok

// Is my blockhash still alive?  (expiry is the #1 silent killer)
const expired = (await connection.getBlockHeight()) > lastValidBlockHeight; // true => rebuild

// What did the program actually say?  (read logs, don't guess)
const sim = await connection.simulateTransaction(vtx, { replaceRecentBlockhash: true, sigVerify: false });
console.log(sim.value.err, sim.value.logs);
```

---

## References

- Solana Docs — Retrying transactions: https://solana.com/docs/core/transactions/retry
- Solana Docs — Transactions & confirmation: https://solana.com/docs/core/transactions
- Solana Docs — `getLatestBlockhash` / `lastValidBlockHeight`: https://solana.com/docs/rpc/http/getlatestblockhash
- Helius Blog — How to best send Solana transactions under congestion: https://www.helius.dev/blog/solana-congestion-how-to-best-send-solana-transactions
- Helius — Sender (ultra-low-latency submission): https://www.helius.dev/docs/sending-transactions/sender
- Jito — Low-Latency Transaction Send (bundles, statuses, rate limits): https://docs.jito.wtf/lowlatencytxnsend/
- Jito — Tip-floor API: https://bundles.jito.wtf/api/v1/bundles/tip_floor
- Related deep dives: `priority-fees.md` · `jito-bundles.md` · `retries-and-confirmation.md`
