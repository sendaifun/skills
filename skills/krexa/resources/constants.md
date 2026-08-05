# Protocol Constants

All hardcoded constants used across Krexa programs.

## Krexit Score

| Constant | Value | Description |
|----------|-------|-------------|
| Score minimum | 200 | Lowest possible score |
| Score maximum | 850 | Highest possible score |
| Default score | 400 | Starting score for new agents |
| Score expiry | 90 days | Score becomes inactive after 90 days of no activity |
| Liquidation penalty | -40 points | Minimum score drop on liquidation |
| Normal update max | +/- 100 BPS | Maximum per-update change (normal events) |
| Critical update max | +/- 200 BPS | Maximum per-update change (critical events) |
| Cooldown | 60 seconds | Minimum time between score updates |
| Score history buffer | 30 entries | Ring buffer of recent score snapshots |

## Credit & Fees

| Constant | Value | Description |
|----------|-------|-------------|
| Protocol fee | 10% | Fee on all revenue passing through Revenue Router |
| Keeper reward | 0.5% | Reward for triggering liquidation (% of recovered amount) |
| Utilization cap | 80% | Maximum vault utilization before borrows are blocked |
| Insurance fund target | 20% | Target insurance fund as % of total deposits |
| Withdrawal buffer | 120% | Vault maintains 120% of queued withdrawals in liquid USDC |

## PDA Wallet Safety

| Constant | Value | Description |
|----------|-------|-------------|
| Per-trade limit | 20% | Max single transaction as % of wallet balance |
| Per-venue concentration | 50% | Max exposure to a single venue as % of wallet balance |
| Daily spend reset | 24 hours | Rolling window for daily spend limit |

## Service Agent (Type B)

| Constant | Value | Description |
|----------|-------|-------------|
| Wind-down grace period | 48 hours | Time before wind-down execution begins |
| Max milestones | 8 | Maximum milestone disbursements per credit cycle |
| Max expense destinations | 20 | Maximum approved expense addresses per agent |
| Revenue history buffer | 50 entries | Ring buffer of recent revenue events |
| No-revenue Orange trigger | 7 days | Days without revenue to enter Orange zone |
| No-revenue Red trigger | 14 days | Days without revenue to enter Red zone |

## Revenue Router

| Constant | Value | Description |
|----------|-------|-------------|
| Round-trip threshold | 95% | % of payment returned within 24h to flag as round-trip |
| Round-trip window | 24 hours | Time window for round-trip detection |
| Amount anomaly threshold | 10x | Multiple of daily average to flag as anomalous |
| Rapid return threshold | 3 times | Same payer-agent pair transactions within 7 days |
| Rapid return window | 7 days | Time window for rapid return detection |
| Single payment cap | 50% | Max single payment as % of agent's total credit line |

## Insurance Fund

| Constant | Value | Description |
|----------|-------|-------------|
| Insurance below-target split | 40% / 60% | Interest split: 40% to insurance, 60% to treasury (when below target) |
| Insurance at-target split | 0% / 100% | All interest to treasury when insurance fund is at target |

## Vault Tranches

| Constant | Value | Description |
|----------|-------|-------------|
| Senior allocation | 50% | Senior tranche share of total deposits |
| Mezzanine allocation | 30% | Mezzanine tranche share |
| Junior allocation | 20% | Junior (first-loss, protocol-owned) tranche share |
| Senior target APR | 10% | Target yield for senior tranche |
| Mezzanine target APR | 12% | Target yield for mezzanine tranche |
| Junior target APR | 20% | Target yield for junior tranche |
| Minimum deposit | 0.001 USDC | Prevents share price inflation attacks |
