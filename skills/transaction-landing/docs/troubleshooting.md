# Troubleshooting

## Transaction "sent successfully" but never confirms

**Cause:** The RPC accepted your bytes, then the transaction was dropped from the mempool before reaching a leader — normal under congestion. A successful `sendTransaction` response is not a confirmation.

**Fix:** Run the rebroadcast-and-confirm loop ([references/confirmation.md](../references/confirmation.md)): resend the **same** serialized bytes every ~2s while polling `getSignatureStatuses`, stopping at blockhash expiry. If it still drops, climb the [reliability ladder](../SKILL.md#the-reliability-ladder) — raise the priority fee (rung 1) or use staked routing (rung 2).

## `TransactionExpiredBlockheightExceededError` / `block height exceeded`

**Cause:** The blockhash's `lastValidBlockHeight` passed before inclusion. The transaction is permanently dead.

**Fix:** Rebuild with a fresh blockhash — **but first verify the original didn't land** (`getSignatureStatuses(..., { searchTransactionHistory: true })`) so you don't double-execute. For long retry windows, switch to a [durable nonce](../references/confirmation.md#durable-nonces), which doesn't expire. See [agentic safe-retry](../references/confirmation.md#agentic-safe-retry).

## `Blockhash not found`

**Cause:** Two flavors — (a) you fetched the blockhash from one RPC and sent to another that hasn't seen that slot yet, or (b) the blockhash already expired.

**Fix:** Fetch the blockhash and send through the **same** RPC (or commitment). Retry the send a few times; if it persists past the validity window, treat it as expired and rebuild.

## Program fails with a compute error / `exceeded CUs`

**Cause:** Your `setComputeUnitLimit` is below actual consumption (or you left the 200k default and the program needs more).

**Fix:** Simulate to read `unitsConsumed`, set the limit to `used × 1.1` ([references/compute-units.md](../references/compute-units.md)). For variable-cost transactions (e.g. multi-pool swaps), simulate the actual instructions you'll send, not a representative sample.

## Fees are far higher than expected

**Cause:** Priority fee = `price × CU limit`. An oversized CU limit (especially the 200k default) multiplies a fair price into a large fee.

**Fix:** Right-size the CU limit. Halving an oversized limit halves the priority fee at the same price.

## Transaction lands but is deprioritized / slow under load

**Cause:** Priority fee too low for current contention, or estimated without `lockedWritableAccounts` so it missed per-account congestion.

**Fix:** Pass the writable accounts your transaction touches to `getRecentPrioritizationFees`, raise the percentile (0.75→0.9 for competitive slots), and add the production buffer ([references/priority-fees.md](../references/priority-fees.md)).

## Agent transferred / funded something twice

**Cause:** On interruption or timeout, the agent signed a **new** transaction for the same action instead of rebroadcasting the original bytes — the chain saw a second signature and executed it again.

**Fix:** Apply the [Agentic Safety](../SKILL.md#agentic-safety) invariants: retry = rebroadcast identical bytes; verify on-chain state before rebuilding; treat `already processed` as success; prefer a durable nonce for value transfers. This is the single most important rule in this skill.

## `already been processed` thrown on send

**Cause:** The transaction already landed; you resent it.

**Fix:** This is **success** — return the signature. Match `already.*processed` and resolve, don't surface it as an error or retry it as a failure.

## Simulation fails but the instructions look correct

**Cause:** Missing signer, stale blockhash, an account not yet created, or the probe omitted a required compute-budget instruction.

**Fix:** Simulate with `sigVerify: false` and `replaceRecentBlockhash: true`, sign the probe with the fee payer, and read `sim.value.logs` — the program logs name the actual failing constraint. Fix that before sending (you'd have paid the base fee for the same failure on-chain).

## Devnet works, mainnet drops

**Cause:** Devnet has near-zero priority fees and light congestion; the same flow on mainnet competes for block space.

**Fix:** Don't validate landing on devnet alone. On mainnet, ship rung 1 (right-sized CU + real fee + rebroadcast) as the baseline and load-test before relying on it; escalate to rungs 2–3 for time-sensitive paths.
