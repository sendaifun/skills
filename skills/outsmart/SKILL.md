---
name: outsmart
description: "MCP toolkit for AI agents to trade, LP, snipe, and farm across 18 Solana DEX protocols. 49 ready-to-call tools for swaps, autonomous LP management, event streaming, prediction markets, perp exchanges, and token launches. Use when building autonomous DeFi agents, connecting agents to Solana, or executing any on-chain DeFi operation via MCP."
---

# Outsmart — Solana DeFi Toolkit for AI Agents

49 MCP tools that give any AI agent full access to Solana DeFi. Trade across 18 DEXes, manage LP positions autonomously, stream real-time events, bet on prediction markets, operate perp exchanges, and launch tokens — all through a single MCP server.

## Overview

Outsmart is two packages:

- **`outsmart`** (npm) — TypeScript trading library + CLI with 18 DEX adapters
- **`outsmart-agent`** (npm) — MCP server that wraps the library into 49 callable tools

The MCP server is a thin layer — validates params, calls library methods, returns JSON. No code duplication. Works with Claude Desktop, Cursor, OpenClaw, or any MCP-compatible client.

## Quick Start

### As MCP Server (for AI agents)

```bash
# Claude Desktop / Cursor — add to MCP config:
npx outsmart-agent

# Claude Code
claude mcp add outsmart-agent -- npx outsmart-agent
```

### As CLI (for humans)

```bash
npm i -g outsmart
outsmart init
# Enter PRIVATE_KEY and MAINNET_ENDPOINT when prompted
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Base58 Solana private key |
| `MAINNET_ENDPOINT` | Yes | Solana RPC (Helius, Triton, etc.) |
| `JUPITER_API_KEY` | No | Jupiter Ultra, Shield, Prediction, DCA |
| `GRPC_URL` | No | Yellowstone gRPC (event streaming) |
| `GRPC_XTOKEN` | No | Yellowstone gRPC auth token |
| `DEVNET_ENDPOINT` | No | Solana devnet RPC (Percolator perps) |
| `DFLOW_API_KEY` | No | DFlow adapter |

Config stored at `~/.outsmart/config.env`.

## Instructions

### 1. Trading (Buy / Sell / Quote)

Use `dex_buy` and `dex_sell` for all token trades. For best price without knowing the pool, use `jupiter-ultra` as the DEX — it aggregates across all protocols.

```
# Buy a token (aggregated best price)
→ dex_buy(dex=jupiter-ultra, token=MINT_ADDRESS, amount_sol=0.1)

# Buy from a specific pool
→ dex_buy(dex=meteora-dlmm, pool=POOL_ADDRESS, amount_sol=0.1)

# Sell 100% of a token
→ dex_sell(dex=jupiter-ultra, token=MINT_ADDRESS, percentage=100)

# Get current price
→ dex_quote(dex=raydium-cpmm, pool=POOL_ADDRESS)

# Dry run (simulate without executing)
→ dex_buy(dex=jupiter-ultra, token=MINT, amount_sol=0.1, dry_run=true)
```

**DEX Selection:**
- Best price, unknown pool: `jupiter-ultra`
- Specific Meteora pool: `meteora-dlmm` or `meteora-damm-v2`
- Specific Raydium pool: `raydium-cpmm`, `raydium-clmm`, or `raydium-amm-v4`
- PumpFun tokens: `pumpfun-amm` (graduated) or `pumpfun` (bonding curve)

Aggregators (`jupiter-ultra`, `dflow`) need `token` parameter only. On-chain adapters need `pool` parameter.

### 2. Token Info and Safety

Always check a token before trading:

```
# DexScreener market data (price, mcap, volume, liquidity, age)
→ solana_token_info(token=MINT_ADDRESS)

# Jupiter Shield security check (rug risk, freeze authority, etc.)
→ jupiter_shield(mints=MINT_ADDRESS)

# Wallet balances
→ solana_wallet_balance()
→ solana_wallet_balance(token=MINT_ADDRESS)
```

### 3. Liquidity Provision (Manual)

```
# Find pools for a token
→ dex_find_pool(dex=meteora-dlmm, token=MINT)

# Add liquidity — DLMM concentrated bins
→ dex_add_liquidity(dex=meteora-dlmm, pool=POOL, amount_sol=0.5, strategy=spot, bins=50)

# Add liquidity — DAMM v2 full range
→ dex_add_liquidity(dex=meteora-damm-v2, pool=POOL, amount_sol=0.5)

# Check positions
→ dex_list_positions(dex=meteora-dlmm, pool=POOL)

# Claim swap fees
→ dex_claim_fees(dex=meteora-dlmm, pool=POOL)

# Remove liquidity (100%)
→ dex_remove_liquidity(dex=meteora-dlmm, pool=POOL, percentage=100)
```

DLMM strategies: `spot` (even), `curve` (concentrated center), `bid-ask` (weighted edges).

### 4. Autonomous LP Manager

Start a manager that auto-rebalances, compounds fees, and exits on risk thresholds:

```
# Find the best pool (scored by volume/TVL, APR, age)
→ lp_find_pool(token=MINT)

# Start autonomous management
→ lp_manager_start(pool=POOL, dex=meteora-dlmm)
→ lp_manager_start(pool=POOL, dex=meteora-dlmm, compound_interval_min=15, il_threshold_pct=5)

# Dry run to see what it would do
→ lp_manager_start(pool=POOL, dex=meteora-dlmm, dry_run=true)

# Check live status
→ lp_manager_status()

# Stop and get final stats
→ lp_manager_stop()
```

- **DLMM strategy:** Detects out-of-range, removes liquidity, re-adds centered on current price
- **DAMM v2 strategy:** Claims fees periodically, re-deposits to compound
- **Risk controls:** IL threshold exit, stop-loss, configurable slippage

### 5. Real-Time Event Streaming

Detect new pools, large swaps, and bonding curve completions as they happen:

```
# Start streaming (gRPC or WebSocket)
→ stream_start(preset=new-pools)

# Check buffered events
→ stream_status(type=NewPool, limit=5)
→ stream_status(type=Swap, limit=10)
→ stream_status(type=BondingComplete, limit=3)

# Stop streaming
→ stream_stop()
```

Monitors 18+ DEX programs. Events: `Swap`, `NewPool`, `BondingComplete`, `LargeSwap`.

### 6. Pool Creation

Create DAMM v2 pools with decaying fee schedules (first-LP advantage):

```
# Check if pool already exists
→ dex_find_pool(dex=meteora-damm-v2, token=MINT)

# Create with 99% starting fee decaying to 2%
→ dex_create_pool(mode=custom, base_mint=MINT, base_amount=1000000, quote_amount=0.5, max_base_fee_bps=9900, min_base_fee_bps=200, total_duration=86400, number_of_period=100)
```

### 7. Jupiter DCA

Create recurring buy/sell orders executed by Jupiter keepers:

```
# DCA into SOL over 10 days
→ jupiter_dca_create(input_mint=USDC_MINT, output_mint=SOL_MINT, total_amount=100, input_decimals=6, number_of_orders=10, interval_seconds=86400)

# List active DCA orders
→ jupiter_dca_list(status=active)

# Cancel
→ jupiter_dca_cancel(order=ORDER_ADDRESS)
```

### 8. Prediction Markets

```
# Browse Jupiter prediction markets
→ jupiter_prediction_events(category=crypto, limit=10)
→ jupiter_prediction_market(market_id=ID, include_orderbook=true)

# Place a bet
→ jupiter_prediction_order(market_id=ID, is_yes=true, is_buy=true, deposit_amount=5.0)

# Track and claim
→ jupiter_prediction_positions(include_orders=true)
→ jupiter_prediction_claim(position_pubkey=PUBKEY)

# Polymarket (read-only, no wallet needed)
→ polymarket_search(query=bitcoin)
→ polymarket_trending(limit=10)
→ polymarket_event(slug=EVENT_SLUG)
→ polymarket_orderbook(token_id=TOKEN_ID)
```

### 9. Percolator Perp Exchange

Create and operate permissionless perpetual exchanges:

```
# Create a perp market
→ percolator_create_market(base_mint=MINT, quote_mint=USDC, max_leverage=10)

# Trade
→ percolator_long(market=MARKET, collateral=10, leverage=5)
→ percolator_short(market=MARKET, collateral=10, leverage=3)
→ percolator_close(market=MARKET)

# Run oracle keeper (pushes DEX prices to the exchange)
→ percolator_keeper_start(market=MARKET)
→ percolator_keeper_status()
→ percolator_keeper_stop()

# LP the insurance fund
→ percolator_insurance_lp(market=MARKET, action=deposit, amount=100)
```

### 10. Token Launches

```
# Launch on PumpFun
→ launchpad_create_coin(name=MyToken, symbol=MTK, metadata_uri=https://arweave.net/...)
```

## Supported DEXes (18)

| Category | Adapters |
|----------|----------|
| **Aggregators** | Jupiter Ultra, DFlow |
| **Raydium** | AMM v4, CPMM, CLMM, LaunchLab |
| **Meteora** | DAMM v2, DLMM, DAMM v1, DBC |
| **PumpFun** | PumpSwap AMM, Bonding Curve |
| **Others** | Orca, PancakeSwap CLMM, BYReal CLMM, Fusion AMM, Futarchy AMM, Futarchy Launchpad |

List all with capabilities:

```
→ dex_list_dexes()
→ dex_list_dexes(capability=canBuy)
```

## All 49 MCP Tools

| Category | Tools |
|----------|-------|
| **DEX (11)** | `dex_buy`, `dex_sell`, `dex_quote`, `dex_snipe`, `dex_find_pool`, `dex_create_pool`, `dex_add_liquidity`, `dex_remove_liquidity`, `dex_claim_fees`, `dex_list_positions`, `dex_list_dexes` |
| **LP Manager (4)** | `lp_manager_start`, `lp_manager_stop`, `lp_manager_status`, `lp_find_pool` |
| **Streaming (3)** | `stream_start`, `stream_stop`, `stream_status` |
| **Jupiter (9)** | `jupiter_shield`, `jupiter_prediction_events`, `jupiter_prediction_market`, `jupiter_prediction_order`, `jupiter_prediction_positions`, `jupiter_prediction_claim`, `jupiter_dca_create`, `jupiter_dca_list`, `jupiter_dca_cancel` |
| **Percolator (15)** | `percolator_create_market`, `percolator_init_user`, `percolator_deposit`, `percolator_withdraw`, `percolator_trade`, `percolator_long`, `percolator_short`, `percolator_close`, `percolator_push_oracle`, `percolator_crank`, `percolator_market_state`, `percolator_insurance_lp`, `percolator_keeper_start`, `percolator_keeper_stop`, `percolator_keeper_status` |
| **Polymarket (4)** | `polymarket_search`, `polymarket_trending`, `polymarket_event`, `polymarket_orderbook` |
| **Solana + Launchpad (3)** | `solana_token_info`, `solana_wallet_balance`, `launchpad_create_coin` |

## Guidelines

- **Always check `solana_token_info` before buying unknown tokens** — verify liquidity, age, and volume
- **Use `jupiter_shield` for security checks** — detects freeze authority, mint authority, rug patterns
- **Use `--dry-run` / `dry_run=true` for large trades** — simulate before committing
- **Start with `jupiter-ultra` for trading** — it finds the best route automatically
- **Never risk more than 5% on a single trade**
- **Keep at least 0.1 SOL for gas** — without gas you can't exit positions
- **DLMM bins go single-sided when out of range** — use wider bins (50+) for volatile tokens
- **DAMM v2 first-LP advantage is real** — 99% starting fee captures all early volume

## Common Errors

### Error: Pool not found
**Cause:** Wrong pool address or token hasn't graduated to that DEX yet.
**Solution:** Use `dex_find_pool` to discover the correct pool, or use `jupiter-ultra` which routes automatically.

### Error: Insufficient balance
**Cause:** Not enough SOL or tokens for the trade.
**Solution:** Check `solana_wallet_balance()` first. Keep 0.1 SOL reserve for gas.

### Error: Transaction failed (slippage)
**Cause:** Price moved during execution, common with volatile tokens.
**Solution:** Use a Jito tip (`tip` parameter) for priority execution, or increase slippage tolerance.

### Error: LP Manager already running
**Cause:** Only one LP manager instance can run at a time.
**Solution:** Stop the current one with `lp_manager_stop()` before starting a new one.

## References

- [outsmart CLI — GitHub](https://github.com/outsmartchad/outsmart-cli) (565+ stars)
- [outsmart-agent — GitHub](https://github.com/outsmartchad/outsmart-agent)
- [outsmart — npm](https://www.npmjs.com/package/outsmart)
- [outsmart-agent — npm](https://www.npmjs.com/package/outsmart-agent)
