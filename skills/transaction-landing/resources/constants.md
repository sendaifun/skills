# Constants & Endpoints

## Compute budget

| Constant | Value |
|----------|-------|
| Base fee | 5,000 lamports per signature |
| Default CU limit (unset) | `200,000 × num_instructions`, capped at 1,400,000 |
| Max CU limit | 1,400,000 |
| Compute-budget program | `ComputeBudget111111111111111111111111111111` |
| `setComputeUnitLimit` units | `u32` (CUs) |
| `setComputeUnitPrice` microLamports | `u64` (microLamports per CU) |

Fee formula: `priorityLamports = ceil(microLamports × cuLimit / 1_000_000)`.

## Priority-fee estimation

| Source | How |
|--------|-----|
| `getRecentPrioritizationFees` | Standard RPC method; pass `lockedWritableAccounts`. Provider-agnostic baseline. |
| Helius `getPriorityFeeEstimate` | `https://mainnet.helius-rpc.com/?api-key=...`; see the [`helius`](../../helius/) skill |
| QuickNode `qn_estimatePriorityFees` | See the [`quicknode`](../../quicknode/) skill |

## Blockhash / confirmation

| Item | Value |
|------|-------|
| Blockhash validity | ~150 slots (~60–90s) |
| Expiry signal | `currentBlockHeight > lastValidBlockHeight` |
| Commitments | `processed` < `confirmed` < `finalized` |
| Status method | `getSignatureStatuses([sig], { searchTransactionHistory })` |

## Jito (rung 3)

**Tip accounts — fetch at runtime, never hardcode.** The set rotates; a stale or wrong address silently burns your tip. Use the Block Engine `getTipAccounts` JSON-RPC method (see [examples/jito-bundle.ts](../examples/jito-bundle.ts)). For Helius Sender's tip-account list specifically, the in-repo [`helius`](../../helius/) skill (`references/sender.md`) carries a verified set.

| Resource | Endpoint |
|----------|----------|
| Tip accounts (live) | `getTipAccounts` on any Block Engine URL below |
| Tip floor API | `https://bundles.jito.wtf/api/v1/bundles/tip_floor` (use `landed_tips_75th_percentile`) |
| Block Engine (global) | `https://mainnet.block-engine.jito.wtf/api/v1/bundles` |
| Block Engine (Amsterdam) | `https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles` |
| Block Engine (Frankfurt) | `https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles` |
| Block Engine (NY) | `https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles` |
| Block Engine (Tokyo) | `https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles` |
| Block Engine (devnet) | `https://dallas.devnet.block-engine.jito.wtf/api/v1/bundles` |
| Bundle methods | `sendBundle`, `getBundleStatuses`, `getTipAccounts` |

Bundle limits: **max 5 transactions**, all-or-nothing, single slot. Minimum tip to land in practice: ~0.0001 SOL (size dynamically from the tip floor).

## Error strings → meaning

| String (substring match) | Meaning | Treat as |
|--------------------------|---------|----------|
| `already been processed` | The transaction already landed | **Success** |
| `Blockhash not found` | Blockhash not yet known to this node, or expired | Retry send; if persistent, rebuild |
| `block height exceeded` / `TransactionExpiredBlockheightExceededError` | Lifetime expired | Rebuild (after verifying it didn't land) |
| `insufficient funds for fee` / `insufficient lamports` | Payer can't cover fee/rent | Fund payer; lower fee |
| `exceeded CUs` / `ComputeBudgetExceeded` | CU limit too low | Raise limit via simulation |
| `Node is behind` / `-32005` | RPC lagging | Switch RPC / retry |
| `429` / rate limit | Too many requests | Back off, rotate endpoint |

## Cluster RPCs

| Cluster | URL |
|---------|-----|
| Devnet | `https://api.devnet.solana.com` |
| Testnet | `https://api.testnet.solana.com` |
| Mainnet (public, rate-limited) | `https://api.mainnet-beta.solana.com` |

Public mainnet RPC is fine for reads and devnet work; use a staked provider ([`helius`](../../helius/) / [`quicknode`](../../quicknode/)) for production sending.
