# Troubleshooting — Priority Fees & Transaction Building

Diagnosis and fixes for the failures you hit when building and landing Solana transactions.

## Block height exceeded / blockhash expired

**Symptoms:** `TransactionExpiredBlockheightExceededError`, "Blockhash not found", or the confirmation promise resolving to a failure after ~60–90 seconds.

**Cause:** A blockhash is valid only until the chain passes `lastValidBlockHeight` (~150 slots, ~60–90s). If the transaction has not landed by then, it can never land — the blockhash is permanently invalid.

**Fix:**

1. Always capture `lastValidBlockHeight` alongside the blockhash and confirm against it:

```typescript
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
// ... build, sign ...
const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 });
await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
```

2. Under congestion, rebroadcast while you wait and bail once the height is exceeded:

```typescript
const raw = tx.serialize();
let landed = false;
while ((await connection.getBlockHeight()) <= lastValidBlockHeight) {
  const { value } = await connection.getSignatureStatuses([sig]);
  const s = value[0];
  if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
    landed = true;
    break;
  }
  if (s?.err) throw new Error(JSON.stringify(s.err));
  await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  await new Promise((r) => setTimeout(r, 1_000));
}
// The loop also exits when the block height passes lastValidBlockHeight — the tx
// is then permanently dead. Throw so the caller never treats an expired,
// never-landed transaction as a success.
if (!landed) throw new Error('Blockhash expired before confirmation');
```

3. Fetch the blockhash as late as possible — right before signing — so you don't burn part of its lifetime building the transaction.

## Transaction too large

**Symptoms:** "Transaction too large", "encoded/raw transaction size exceeds limit", or a serialize error before sending.

**Cause:** The serialized transaction exceeds the 1,232-byte packet limit, usually because it references too many accounts (each full address is 32 bytes).

**Fix:**

- Use a **versioned (v0) transaction** plus an **Address Lookup Table**. Each account moved into an ALT costs 1 byte (an index) instead of 32 bytes on the wire.
- Split unrelated work into multiple transactions.
- Remove duplicate accounts; the message dedupes, but minimizing the unique set helps.

```typescript
const { value: alt } = await connection.getAddressLookupTable(altAddress);
const message = new TransactionMessage({ payerKey, recentBlockhash, instructions })
  .compileToV0Message(alt ? [alt] : []);
```

## CU limit too low → "exceeded CUs"

**Symptoms:** Simulation or on-chain failure with "exceeded CUs", "Computational budget exceeded", or the program halting mid-execution.

**Cause:** The `setComputeUnitLimit` value is below what the transaction actually consumes.

**Fix:**

- Estimate from simulation and add headroom:

```typescript
const sim = await connection.simulateTransaction(vtx, { replaceRecentBlockhash: true, sigVerify: false });
const units = Math.ceil((sim.value.unitsConsumed ?? 200_000) * 1.1);
```

- Add a margin (10–20%) — on-chain state can differ from simulation (e.g. an account that now needs initialization).
- Remember the per-transaction ceiling is 1,400,000 CUs; work that needs more must be split.

## Priority fee too low → transaction dropped

**Symptoms:** The transaction simulates fine, sends without error, but never confirms; status stays `null`.

**Cause:** Under congestion, validators drop the lowest fee-per-CU transactions. A `0` or stale price loses the race.

**Fix:**

- Fetch a live estimate scoped to the writable accounts you touch:

```typescript
const fees = await connection.getRecentPrioritizationFees({ lockedWritableAccounts });
const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
const microLamports = Math.max(1, sorted[Math.floor(sorted.length * 0.9)] ?? 0); // 90th pct
```

- Add a buffer (10–25%) on top of the estimate for headroom.
- For time-sensitive flows (swaps, mints) use a higher percentile or Helius `getPriorityFeeEstimate` with `priorityLevel: 'High'`/`'VeryHigh'`.
- Re-estimate per transaction during volatile periods rather than reusing an old value.

## ALT not warmed up

**Symptoms:** "invalid account index", "Lookup table not found", or `getAddressLookupTable` returning `null` right after creating/extending.

**Cause:** A newly created or extended Address Lookup Table only becomes usable **one slot after** the extend transaction confirms.

**Fix:**

- Wait a slot (or ~1–2 seconds) after the extend confirms before referencing the table.
- Re-fetch the account and verify the addresses landed:

```typescript
const { value: alt } = await connection.getAddressLookupTable(altAddress);
if (!alt) throw new Error('ALT not warmed up yet — retry shortly');
console.log('Addresses:', alt.state.addresses.length);
```

- Confirm the create and extend transactions separately before using the table; don't reference it in the same transaction that creates it.

## Simulation failed with no logs

**Symptoms:** `simulateTransaction` returns an error and empty/missing logs, often a signature or blockhash complaint.

**Cause:** Simulating a transaction that isn't signed or carries a stale blockhash.

**Fix:** When simulating just to size CUs, skip signing and blockhash concerns:

```typescript
const sim = await connection.simulateTransaction(vtx, {
  replaceRecentBlockhash: true, // RPC injects a valid blockhash
  sigVerify: false,             // don't require signatures
});
```

If logs are still empty, the failure is pre-execution (bad account, missing program) — inspect `sim.value.err` and confirm every account and program ID exists on the cluster you're targeting.

## "Insufficient funds for fee"

**Symptoms:** Send fails because the fee payer can't cover base fee + priority fee + rent.

**Fix:** Budget for all three. Recall the priority fee ≈ `(CU limit × CU price) / 1e6` lamports; a high CU price on a large limit can dwarf the 5,000-lamport base fee. Check the payer balance before sending and lower the CU price/limit if needed.

## Debugging checklist

- Targeting the right cluster? Devnet program IDs and accounts won't exist on mainnet.
- Are the ComputeBudget instructions present and first?
- Is the CU limit sized from a real simulation (not the 200,000 default)?
- Is the CU price non-zero and based on a live estimate?
- Is the blockhash fresh and confirmed against `lastValidBlockHeight`?
- For large transactions: v0 message + ALT, and is the ALT warmed up?
- Using a reliable RPC? Public endpoints rate-limit and drop sends under load.
