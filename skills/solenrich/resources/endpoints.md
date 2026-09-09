# SolEnrich endpoint reference

All paid endpoints: `POST https://api.solenrich.com/entrypoints/{key}/invoke`, JSON body (flat or wrapped
in `input`), optional `format: "json" | "llm" | "both"`. Prices in USDC per call, settled over x402 on
Solana or Base. Live prices: `GET /docs` or the `pricing` block of any 402 response.

Test fixtures used throughout SolEnrich's own tests:
- Wallet: `vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg` (Solana Foundation)
- Token: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (BONK)
- StonkFun reward coin: `HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR` (ZCAT, quote ZEC, 300 bps)

## Core

| Key | Price | Required input | Returns |
|---|---|---|---|
| `enrich-wallet-light` | $0.002 | `address` | SOL balance, holdings, NFT breakdown, labels incl. bot/automation flags, 7-factor risk score |
| `enrich-wallet-full` | $0.005 | `address` | + DeFi positions, connected wallets, enhanced tx history |
| `enrich-token-light` | $0.002 | `mint` | Price (median of 3 sources), mcap, volume, liquidity, slippage at $100/$1K/$10K/$100K, risk flags, `transfer_tax` |
| `enrich-token-full` | $0.004 | `mint` | + top 20 holders, HHI concentration, volatility |
| `parse-transaction` | $0.001 | `signature` | Type, protocol, transfer breakdown, account roles |

## Risk and composition

| Key | Price | Required input | Returns |
|---|---|---|---|
| `due-diligence` | $0.02 | `mint` | Token + whales + holder concentration in one SAFE / CAUTION / RISKY verdict with risk factors |
| `whale-watch` | $0.008 | `mint` | Top holders with accumulation / distribution flow and supply share |
| `wallet-graph` | $0.01 | `address` (`depth` 1 or 2) | Connected wallets and suspicious clusters |
| `copy-trade-signals` | $0.01 | `address` | PnL, win rate, Sharpe, Sortino, max drawdown, profit factor |
| `batch-enrich` | $0.015 | `addresses[]` (1–25), `type` | Parallel wallet or token enrichment |
| `compare-tokens` | $0.006 | `mints[]` (2–3) | Side-by-side with rankings and summary picks |
| `compare-wallets` | $0.006 | `addresses[]` (2–3) | Side-by-side with rankings and summary picks |

## Temporal

| Key | Price | Required input | Returns |
|---|---|---|---|
| `token-trend` | $0.006 | `mint` (`lookback`) | Daily snapshots, improving / declining / stable per metric |
| `wallet-history` | $0.006 | `address` (`lookback`) | Portfolio deltas and position changes |
| `portfolio-history` | $0.006 | `address` (`period` 7d/14d/30d) | Full value series, peak, trough, max drawdown |
| `perps-market-trend` | $0.008 | (`lookback`) | Per-market OI, skew, utilization, borrow APR deltas |

## Discovery and signals

| Key | Price | Required input | Returns |
|---|---|---|---|
| `new-tokens` | $0.012 | none (`min_liquidity_usd`, `max_risk_score`, `limit`) | Fresh launches enriched and ranked safest first |
| `trending-signals` | $0.05 | none | DexScreener trending composed with whale flow and risk, ranked with reasoning |
| `feed-latest` | $0.005 | none (`since`) | Daily pre-computed trending brief, cheap to poll |
| `consensus-signal` | $0.005 | none (`address`, `window`) | What other agents are querying right now (SolEnrich's own request stream) |
| `attention-momentum` | $0.02 | none | Agent attention acceleration vs price: early_signal / confirmed / distribution_risk / fading |
| `check-alerts` | $0.008 | `since` + watchlist (`tokens[]`, `wallets[]`) | Price, whale, concentration, risk, position, and perp alerts since a cursor |
| `protocol-profile` | $0.008 | `protocol` | TVL, yields, activity, health, automated-activity share |
| `query` | $0.003 | `question` | Plain English routed to one or more enrichers, unified answer |

## Smart money

| Key | Price | Required input | Returns |
|---|---|---|---|
| `smart-money-flow` | $0.10 | none (`wallets[]`, `min_win_rate`, `lookback_days`) | Winners filtered by copy-trade metrics, what they accumulate, clusters |
| `smart-money-trenches` | $0.05 | none (`hours_back`, `max_token_age_hours`, `min_buyers`, `limit`) | Vetted realized-PnL winners buying tokens younger than 6 hours |
| `hyperliquid-smart-money` | $0.05 | none (`market`, `top_traders`) | Consistency-gated leaderboard traders' positioning consensus per coin |
| `hyperliquid-trader-profile` | $0.012 | `address` (0x) | Live positions, leverage, liquidation distance, week/month/all-time PnL |

## Trenches (fresh-launch trade lifecycle)

| Key | Price | Required input | Returns |
|---|---|---|---|
| `runner-scan` | $0.04 | none (`max_token_age_hours`, `min_liquidity_usd`, `min_volume_h1_usd`, `limit`) | Fresh tokens whose buying is accelerating: RUNNING / IGNITING / PARABOLIC_LATE / FADING, 0–1 score, `transfer_tax` per runner |
| `trenches-scan` | $0.08 | none | Velocity × smart money × attention, ranked, HIGH_CONFLUENCE / MODERATE / SINGLE_SIGNAL |
| `trenches-check` | $0.03 | `mint` | The three legs pointed at one token, with verdict, reasoning, `transfer_tax` |
| `exit-signal` | $0.04 | `mint` (`entry_price_usd`) | EXIT / DERISK / HOLD, 0–1 exit score, whale flow, `position.net_pnl_after_exit_tax_pct` |

## Perps

| Key | Price | Required input | Returns |
|---|---|---|---|
| `perps-market-structure` | $0.012 | none | Jupiter Perps OI, utilization, borrow APR, skew, health per market |
| `perps-trader-profile` | $0.01 | `address` | Open positions across Jupiter Perps and Adrena, leverage, PnL, classification |
| `perps-cross-venue-funding` | $0.015 | `market` (SOL/BTC/ETH/BONK) | Funding and OI across Jupiter, Adrena, Flash, Hyperliquid, dYdX; best entry per side; arbitrage |
| `perps-venue-comparison` | $0.02 | `market`, `side`, `size_usd` | Slippage, fees, OI headroom, total entry cost per venue, recommendation |
| `perps-basis-signal` | $0.015 | `asset` (`min_yield_apr_pct`) | Net-of-borrow basis yield per venue, best trade |

## StonkFun reward coins (Token-2022 transfer-tax coins paired to xStocks, pre-stocks, ZEC)

| Key | Price | Required input | Returns |
|---|---|---|---|
| `stonk-pairs` | free | none (`category`, `launchable_only`) | Quote assets a launch can pair against, `is_agent_launchable` flag |
| `stonk-gems` | $0.03 | none (`quote_mint`, `category`, `max_age_days`, `min_holders`, `max_market_cap_usd`, `limit`) | Every reward coin scored 0–100: GEM / WATCH / NOISE / DEAD with reasons, warnings, round-trip tax |
| `stonk-reward-risk` | $0.005 | `mint` | `payout_status` PAYING / STALE / NEVER / NOT_REWARD, `trading_cost`, on-chain fee config, health score |
| `stonk-yield` | $0.005 | `mint` | Trailing 7d / 30d / lifetime holder yield, quote exposure |
| `stonk-screener` | $0.01 | none (`quote_mint`, `category`, `paying_only`, `live_only`, `sort`, `limit`, …) | Every reward coin with payout status, live flag, tax cost; sort by volume, last payout, holders, change, yield |
| `stonk-launch-intel` | $0.02 | none (`category`, `min_coins`, `sort`, `limit`) | Per quote asset: launches, traded and paying shares, survival past day 3, tax mix, crowding, demand score, recommendations |
| `stonk-launch-preflight` | $0.25 | `unsigned_transaction`, `quote_mint`, `mode` | Diffs a self-built LaunchLab launch against StonkFun's published shape; mismatches with fixes |

## Collectibles

| Key | Price | Required input | Returns |
|---|---|---|---|
| `gacha-ev-scan` | $0.02 | none (`machine`, `franchise`, `exit_strategy`, `min_edge_pct`) | Jupiter Gacha pack net EV per machine: POSITIVE_EV / HOUSE_EDGE / NEGATIVE_EV |

## Free surfaces

| Route | What |
|---|---|
| `GET /health` | Liveness |
| `GET /docs` | Every endpoint: input schema, output description, scoring methodology |
| `GET /openapi.json` | OpenAPI 3.1 with `x-payment-info` per route |
| `GET /llms.txt` | One paragraph per endpoint for LLM context |
| `GET /.well-known/x402` | x402 service discovery |
| `GET /entrypoints` | Key list |
| `POST /demo/enrich` | One free wallet or token enrichment, 10 per hour per IP |
| `POST /entrypoints/stonk-pairs/invoke` | Free StonkFun quote-pair catalog |
