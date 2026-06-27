# Escalation — Rungs 2 & 3 When the Base Path Drops

Rung 1 (right-sized CU + real priority fee + rebroadcast loop) lands the large majority of transactions. Climb when you still see drops under congestion, or when you need **atomic** or **front-run-protected** execution.

## Rung 2 — Staked / SWQOS routing

Public RPCs forward your transaction to a leader on a best-effort, unstaked path that is the first thing shed under load. **Stake-weighted Quality of Service (SWQOS)** providers forward through staked connections that leaders prioritize, and often dual-route to both validators and Jito simultaneously.

You don't build this — you point the same right-sized, fee-bearing transaction at a provider endpoint:

- **Helius Sender** — dual-routes to validators + Jito; free tier; requires `skipPreflight: true`, `maxRetries: 0`, and a Jito tip. Full request format and regional endpoints: the [`helius`](../../helius/) skill, `references/sender.md`.
- **QuickNode** — staked sending + `qn_estimatePriorityFees`. See the [`quicknode`](../../quicknode/) skill.
- **Triton**, **Jito ShredStream** consumers, and other stake-weighted RPCs expose equivalents.

The transaction is identical to rung 1; only the **submission endpoint** changes. Keep your rebroadcast-and-confirm loop ([confirmation.md](confirmation.md)) — staked routing improves inclusion odds, it does not replace confirmation polling.

## Rung 3 — Jito bundles (atomic + MEV-protected)

A **bundle** is an ordered list of up to 5 transactions that land **all-or-nothing, in order, in a single slot**. Use it when:

- multiple transactions must land **together** (e.g. open + hedge, or a multi-leg arb),
- you need **front-run/sandwich protection** (bundles aren't exposed to the public mempool), or
- you want a guaranteed **ordering** the public mempool can't promise.

### How it works

1. Include a **tip**: a `SystemProgram.transfer` to a Jito **tip account** (one of the 8 — pick randomly per send; list in [resources/constants.md](../resources/constants.md)). The tip is what pays for bundle inclusion — it is separate from the priority fee.
2. Size the tip dynamically from the **tip-floor API** (`https://bundles.jito.wtf/api/v1/bundles/tip_floor`); use `max(75th_percentile, 0.0001 SOL)`. Tips that are too low simply don't land.
3. Base64-encode each signed transaction and submit the array to the Block Engine `sendBundle` JSON-RPC.
4. Poll bundle status with `getBundleStatuses` (or confirm the contained signatures normally).

The tip can ride in any transaction in the bundle — commonly the last. A runnable single-transaction example (tip + submit + poll) is in [examples/jito-bundle.ts](../examples/jito-bundle.ts).

### Block Engine endpoints (regional)

```
https://mainnet.block-engine.jito.wtf/api/v1/bundles      # global
https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles
https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles
https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles
https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles
```

Pick the region nearest your infrastructure. Devnet: `https://dallas.devnet.block-engine.jito.wtf/api/v1/bundles`.

### Bundle rules that bite

- **Max 5 transactions** per bundle; total size limits apply.
- **All-or-nothing**: if any transaction would fail, the *whole* bundle is dropped — simulate each first.
- **Tip is not a priority fee**: a bundle still wants right-sized CUs and a normal priority fee on its transactions *plus* the Jito tip.
- **No partial landing**: never assume a subset landed. Confirm the bundle (or every contained signature) before chaining actions — the [agentic-safety](confirmation.md#agentic-safe-retry) invariants apply per signature.

## Choosing a rung

| Need | Rung |
|------|------|
| Ordinary mainnet transaction | 1 |
| Time-sensitive trade/mint that keeps dropping | 2 |
| Multiple txs must land together / in order | 3 |
| Front-run / sandwich protection | 3 |
| Devnet / low stakes | 0–1 |

Don't over-escalate: bundles and high tips cost real SOL. Climb only to the rung your failure mode requires.
