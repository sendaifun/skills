# One trade, five calls — the SolEnrich trenches lifecycle

Every SolEnrich response carries a `next_steps` array naming the call that comes next. This is the
default chain for a memecoin trade, with what to read at each step and what it costs.

| Step | Call | Read | Cost |
|---|---|---|---|
| 1. Find | `runner-scan` (velocity) or `smart-money-trenches` (who is buying) or `stonk-gems` (StonkFun) | Ranked candidates with a stage or score and reasons | $0.04 / $0.05 / $0.03 |
| 2. Vet | `trenches-check` on one mint | `verdict`, `confluence`, `reasoning`, `transfer_tax` | $0.03 |
| 3. Safety | `due-diligence` | `verdict` SAFE / CAUTION / RISKY, `risk_factors`, concentration | $0.02 |
| 4. Size | `enrich-token-light` | `slippage_estimates` at $100 / $1K / $10K / $100K, `transfer_tax.round_trip_pct` | $0.002 |
| 5. Hold | `exit-signal` with `entry_price_usd`, repeated no faster than every 5 minutes | `verdict` EXIT / DERISK / HOLD, `exit_score`, `position.net_pnl_after_exit_tax_pct` | $0.04 per check |

Total to enter with full diligence: about $0.09. Each exit check: $0.04.

## Rules the agent should apply

- **Stop at the first hard flag.** A `RISKY` due-diligence verdict or an `EXIT` from a rug trigger
  (`lp_pull`, `active_dump`) ends the chain. Report it; do not continue to sizing.
- **Second look for deltas.** `trenches-check` and `exit-signal` compare against a snapshot from the
  prior call. Liquidity trend and holder churn are `null` on first sight and fill in on a repeat call
  5 or more minutes later.
- **Price the tax.** On Token-2022 mints (every StonkFun reward coin) the `transfer_tax` block gives
  the buy plus sell cost. A 300 bps coin costs 6% per round trip before slippage; a scalp has to clear
  that. `exit-signal` already nets the sell leg in `position.net_pnl_after_exit_tax_pct`.
- **Do not trade on the verdict alone.** Every response ends its `caveats` with "not financial
  advice". Confirm with the user before any swap.

## Worked example (ZCAT, a StonkFun reward coin on ZEC)

1. `stonk-gems` `{ "limit": 10 }` → ZCAT is not in the list (mcap above the 5M default cap), but
   `stonk-screener` `{ "live_only": true, "sort": "lastPayout", "limit": 5 }` shows it PAYING 0.1h ago.
2. `trenches-check` `{ "mint": "HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR" }` → MODERATE, with the
   caveat that the 300 bps tax makes a round trip 6% and weakens an IGNITING read.
3. `due-diligence` → verdict and holder concentration.
4. `enrich-token-light` → slippage at the intended size; `risk_flags` includes `transfer_tax`.
5. Holding from $0.10: `exit-signal` `{ "mint": "...", "entry_price_usd": 0.1 }` → DERISK,
   `unrealized_pnl_pct` 30.7, `net_pnl_after_exit_tax_pct` 26.8. Report the net figure.

## Perps variant

Find: `perps-cross-venue-funding` `{ "market": "SOL" }` → best entry per side.
Size: `perps-venue-comparison` `{ "market": "SOL", "side": "long", "size_usd": 5000 }` → cheapest venue at
that size with warnings.
Hold: `check-alerts` with the wallet in `wallets[]` and a `since` cursor → `perp_at_risk`,
`liquidation_approaching`, `pnl_swing`.
