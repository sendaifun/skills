# Jito bundles — troubleshooting

Symptom-first guide to the failure modes that actually bite. Most "my bundle
didn't land" reports are one of the first three.

## Bundle "succeeds" but nothing lands on-chain
`sendBundle` returning a `bundle_id` means **received, not landed**. You must
poll `getInflightBundleStatuses` (and then `getBundleStatuses`). If you treat the
`bundle_id` as success, you'll silently miss every drop.
- **Fix:** poll to a terminal state (`Landed` / `Failed` / `Invalid`).

## Bundle stays `Pending` then goes `Invalid`
The 5-minute lookback expired without landing — almost always **tip too low** so
it lost the auction, or it was **uncled** (leader skipped).
- **Fix:** size the tip off the tip-floor feed (50th–75th percentile), not the
  1,000-lamport minimum. See `resources/tip-accounts.md`.

## Tip is way too small (off by ~1e9)
The `tip_floor` percentiles are in **SOL**, not lamports.
- **Fix:** `Math.ceil(solValue * LAMPORTS_PER_SOL)`. Forgetting `*1e9` underpays
  by a billion-fold and the bundle never wins.

## Server rejects the transactions / "failed to deserialize"
You sent base64 strings without telling Jito.
- **Fix:** `sendBundle` params second element **must** be `{ "encoding": "base64" }`.
  The legacy default is base58, so omitting it mis-decodes base64 payloads.

## Status poll never lands (even when the bundle landed)
You read the status result as a bare array. Both `getInflightBundleStatuses` and
`getBundleStatuses` wrap their result as `{ context, value: [...] }`.
- **Fix:** unwrap `.value` — e.g. `result.value?.[0]?.status`. Indexing the
  wrapper object with `[0]` yields `undefined`, so the poll never sees a terminal
  state and times out.

## Status fields come back `undefined`
You camelCased a field name.
- **Fix:** the status responses are **snake_case** — `confirmation_status`,
  `bundle_id`, `landed_slot`, `transactions`, `slot`, `err`.

## HTTP 429
You exceeded the default **1 request/sec per IP per region**. Aggressive status
polling is the usual culprit.
- **Fix:** sleep ≥ 1s between calls, batch up to 5 bundle IDs per status call, or
  spread requests across regional hosts (limits are per-region).

## Bundle `Failed` immediately
A transaction in the bundle errored or used a **stale blockhash**. Bundles are
atomic — one bad tx rejects all of them.
- **Fix:** build and sign as late as possible (blockhashes expire in ~60–90s);
  simulate each tx (`simulateTransaction`) or the whole bundle (`simulateBundle`
  on a Jito-Solana RPC) before sending; ensure every tx shares one recent blockhash.

## Calling `simulateBundle` returns "method not found"
`simulateBundle` is **not** a Block Engine method — it lives on a **Jito-Solana
RPC node**.
- **Fix:** point it at a Jito-Solana RPC endpoint, not `mainnet.block-engine.jito.wtf`.

## Bundle ID never appears in `sendTransaction` response body
For the single-tx `sendTransaction?bundleOnly=true` path, the `bundle_id` is in
the **`x-bundle-id`** response header — not the JSON body, and not `x-bundle-auth`.

## Low landing rate under load
Always tipping the same account causes write-lock contention.
- **Fix:** fetch `getTipAccounts` and pick one of the 8 **at random** per bundle.

## `params` shape errors
Status methods nest one level deeper than people expect:
`params: [[ "id1", "id2" ]]`, not `params: [ "id1", "id2" ]`. The same
double-array applies to `sendBundle`'s transaction list.
