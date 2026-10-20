# Dexra API reference

Base URL `https://api.dexra.dev`. Every answer is JSON wrapped as `{"result": {...}}`. Every result has `summary` (one line), `generated_at` (unix seconds) and the coverage of the history it used; every paid check has `verdict` and `reasons` (worst first). Machine-readable: [`/openapi.json`](https://api.dexra.dev/openapi.json), [`/.well-known/x402`](https://api.dexra.dev/.well-known/x402).

Auth: `Authorization: Bearer dxr_...` or `X-Api-Key: dxr_...`. Without a key, paid tools answer `402` with an x402 challenge.

## Verdicts

| Verdict | Meaning |
|---|---|
| `avoid` | One finding is enough to stay away: active mint or freeze authority on a launch, a creator behind earlier collapses, collapsed or withdrawn liquidity, a blacklisted holder, one entity holding half the supply, a permanent delegate, a pool under $10k |
| `caution` | Something needs a look: transfer fees or hooks, linked top holders, rising concentration, large holders selling, sandwich- or bot-heavy pools, costly execution |
| `unknown` | Nothing stands out, but data to judge is missing (first buyers not analyzed yet, no holder history yet) |
| `ok` | None of the checked risks found. It is not a price prediction |

## Launches

### `GET /new_launches`

| Param | Type | Default | Notes |
|---|---|---|---|
| `minutes` | int 1–1440 | 15 | look-back window; over 60 costs 2 credits |
| `limit` | int | 20 | over 20 needs a plan (`max_batch`) and costs 2 credits |
| `platforms` | csv | all | `pump_fun`, `letsbonk`, `raydium_launchlab`, `meteora_dbc`, `pump_swap`, `raydium_amm_v4`, `raydium_cpmm` |
| `min_liquidity_usd` | number | | |
| `include_collapsed` | bool | false | |

`result.launches[]`, newest first. `result.coverage` lists the tracked, partial and untracked platforms.

### `POST /new_launches/batch`

Body `{"mints": ["<mint>", ...]}`: up to 5 on Free, 50 paid per call, or the plan's `max_batch`. `result.results[]` in request order: `{mint, found, launches[]}`. A mint can have several launches (its pump.fun curve and its PumpSwap pool).

### Launch fields

| Field | |
|---|---|
| `mint`, `pool`, `platform`, `pool_kind`, `migrated_from` | where it trades |
| `launched_at`, `age_secs`, `signature`, `slot` | |
| `token` | `name`, `symbol`, `uri`, `standard`, `decimals`, `supply` |
| `authorities` | `mint_authority`, `freeze_authority`, `mint_renounced`, `freeze_renounced` |
| `liquidity` | `quote_symbol`, `quote_reserve`, `peak_quote_reserve`, `usd`, `lock` (`bonding_curve`, `burned`, `partially_burned`, `unlocked`, `withdrawn`, `unknown`), `lp_burned_pct`, `graduated`, `collapsed`, `collapsed_at` |
| `creator` | `address`, `funder`, `previous_launches`, `collapsed_launches`, `graduated_launches`, `linked_collapses` (collapses by wallets that funded or were funded by the creator), `linked_collapse_examples[]` |
| `first_buyers` | `status` (`pending` until analyzed), `analyzed_wallets`, `same_block`, `funded_by_creator`, `shared_funder_wallets`, `largest_funder_cluster`, `known_snipers`, `first_buyers_supply_pct`, `wallets[]` with per-wallet `flags` |
| `known_snipers[]` | `address`, `label`, `early_buys` |
| `risk_flags[]`, `verdict`, `reasons[]` | |

The creator's history is known from the first second. First buyers are analyzed on demand, usually within seconds to a minute of launch; until then the verdict is often `unknown`. Ask again rather than treating it as `ok`.

## Tokens

| Endpoint | Params | Answers |
|---|---|---|
| `GET /token_deep_check` | `mint` | top holders merged by shared funding, real concentration, holder and liquidity history, blacklist proximity within two transfers, authorities, Token-2022 extensions (transfer fee, hook, permanent delegate, non-transferable) |
| `GET /token_holders_delta` | `mint` | who entered and left the top holders over 1h and 24h, concentration shift, large holders selling |

Both answer `400` for tokens with millions of holders (SOL, USDC, USDT): RPC lists only the top 20 accounts.

## Wallets, pools, markets, swaps

| Endpoint | Params | Answers |
|---|---|---|
| `GET /describe_address` (free) | `address` | wallet, token, pool or program; age, activity; which tool to call next |
| `GET /wallet_check` | `address` | known exchange, age, bot or human, PnL on fresh launches, exchange funding, OFAC and hack links within two hops |
| `GET /pool_health` | `pool` | Raydium AMM/CPMM/CLMM, Orca Whirlpool, Meteora DLMM, PumpSwap: depth within 2%, slippage for $1k and $10k, 24h liquidity flow, LP return vs holding after IL (7d, 30d), bot and sandwich share |
| `GET /clmm_range_stats` | `pool`, `width_pct` (default 10) | time in range, fee yield, IL and rebalances for that range width (7d, 30d) |
| `GET /market_snapshot` | `symbol`, `size_usd` (default 10000) | funding, OI, liquidations and all-in execution cost on Binance, Bybit, OKX, Hyperliquid, Drift and Jupiter; the cheapest venue |
| `GET /swap_preflight` | `mint`, `side` (`buy`/`sell`), `amount`, `quote` (SOL default) | price impact on the best route, sandwich share on the pool, Token-2022 traps, authorities; `assessment`: `ok`, `unverified`, `high_slippage_risk`, `high_sandwich_risk`, `blocked` |
| `GET /score_performance` (free) | `days` (default 30) | how often launches with each verdict and flag collapsed within 24h against the base rate |
| `GET /service_stats` (free) | | calls, payers, uptime, latency |

## Limits and errors

| Status | Header | Meaning |
|---|---|---|
| `402` | `X-Dexra-Subscription: quota_exceeded` | today's credits spent; pay per call or upgrade |
| `402` | `X-Dexra-Subscription: plan_required` | the call needs a plan (e.g. a feed over an hour on Free) |
| `402` | `Payment-Required` | x402 challenge for a call without a key (or with a key that is not recognized) |
| `401` | | revoked key |
| `429` | `Retry-After` | per-second limit: 2 on Free, 5–20 on plans |

Webhook watches (`POST /account/watches`) push changes for a token, wallet, pool or the launch feed instead of polling.
