---
name: dexra
description: Check Solana tokens, fresh launches (pump.fun, LetsBonk, PumpSwap, Raydium, Meteora), wallets, pools and planned swaps for risk with the Dexra API before an agent or trading bot acts. Each call answers with a verdict (ok, caution, avoid, unknown) and its reasons. Use for rug and honeypot checks, pre-buy gates in sniper and copy-trading bots, linked-holder concentration, creator history, first-buyer and sniper analysis, wallet screening, LP pool health and swap preflight. REST, hosted MCP and x402 pay-per-call in USDC.
metadata:
  author: Dexra
  version: "0.1.0"
  mcp-server: dexra
---

# Dexra: risk verdicts for Solana

Dexra answers "should I touch this?" for a Solana token, launch, wallet, pool or swap. A call returns a `verdict` (`ok`, `caution`, `avoid` or `unknown`), the `reasons` behind it (worst first), a one-line `summary`, and the evidence: authorities, liquidity and its lock, the creator's earlier launches, the first buyers' funding graph, linked top holders and so on.

## Overview

Use Dexra when the user is:
- building a sniper, copy-trading or memecoin bot and needs a check before each buy;
- building an AI agent that buys, swaps or deals with addresses on Solana;
- asking whether a specific token, launch, wallet or pool is safe;
- choosing a range for a concentrated liquidity position, or comparing perp venues by execution cost.

Dexra is not a price or market-data API. Pair it with Birdeye, CoinGecko or Jupiter for prices and with a trading SDK for execution.

## Authentication

Base URL `https://api.dexra.dev`. Three ways in, in order of preference:

1. **API key** (`dxr_...`) for apps and bots. A free account at https://dexra.dev/app/keys includes 100 credits a day. Send `Authorization: Bearer $DEXRA_API_KEY` (or `X-Api-Key`).
2. **x402** for no-account agents. Without a key, paid tools answer `402` with a standard x402 challenge; a client that pays x402 in USDC on Solana or Base retries and gets the answer. Prices: `GET /.well-known/x402`.
3. **Hosted MCP** for Claude Code, Cursor, VS Code and other MCP clients: `https://api.dexra.dev/mcp` (Streamable HTTP), the same tools under the same names.

```bash
# MCP: adds Dexra to every MCP client installed on the machine
npx -y @dexra-dev/mcp install --key dxr_...
# or one client
claude mcp add --transport http dexra https://api.dexra.dev/mcp --header "Authorization: Bearer dxr_..."
```

SDK: `npm install @dexra-dev/client` (TypeScript, no dependencies).

## Routing

| User intent | Tool (REST path) | Credits |
|---|---|---|
| "What is this address?" (unsure if wallet, mint, pool) | `describe_address` (`GET /describe_address?address=`) | free |
| Fresh launches worth a look, already checked | `new_launches` (`GET /new_launches?minutes=15`) | 1 (2 over 60 min or 20 launches) |
| Check mints a bot just saw, before buying | `new_launches_batch` (`POST /new_launches/batch`, `{"mints": [...]}`) | 3 |
| Who really holds a token, linked holders, blacklist proximity | `token_deep_check` (`GET /token_deep_check?mint=`) | 6 |
| Are insiders leaving? | `token_holders_delta` (`GET /token_holders_delta?mint=`) | 6 |
| Is this wallet a bot, exchange, sanctioned or hack-linked? | `wallet_check` (`GET /wallet_check?address=`) | 6 |
| Is this pool deep, sandwiched, worth LPing? | `pool_health` (`GET /pool_health?pool=`) | 6 |
| Which range to hold in a CLMM/DLMM pool | `clmm_range_stats` (`GET /clmm_range_stats?pool=&width_pct=10`) | 4 |
| Cheapest perp venue, funding and OI for a ticker | `market_snapshot` (`GET /market_snapshot?symbol=SOL&size_usd=10000`) | 2 |
| Is this swap safe to send now? | `swap_preflight` (`GET /swap_preflight?mint=&side=buy&amount=`) | 1 |
| How accurate are the verdicts? | `score_performance` (`GET /score_performance`) | free |

1 credit = 0.005 USDC when paid per call. Full parameters and response fields: [resources/api-reference.md](resources/api-reference.md).

## Workflow

1. If the user gives an address without saying what it is, call `describe_address` first (free); it names the paid tool for the next question.
2. For a bot's pre-buy check, call `new_launches_batch` with the mints the bot is about to buy (up to 5 per call on Free, 50 paid per call). For a token that has been trading for a while, `token_deep_check` goes deeper on holders.
3. Act on `verdict`, and show the user the `reasons`. Recommended default for automated buys: buy only on `ok`, never on `avoid`, and treat `unknown` as "not yet" and check again later rather than as safe.
4. Before sending a swap, `swap_preflight` catches Token-2022 traps (transfer fee, hook, permanent delegate), active mint or freeze authority and pools with heavy sandwiching.
5. When the user asks whether to trust the verdicts, call `score_performance` and quote its live numbers. Don't quote accuracy from memory.

## Examples

### "Is this pump.fun coin a rug?"

```bash
curl -s -X POST https://api.dexra.dev/new_launches/batch \
  -H "Authorization: Bearer $DEXRA_API_KEY" -H "Content-Type: application/json" \
  -d '{"mints": ["<MINT>"]}' | jq '.result.results[].launches[] | {platform, verdict, reasons}'
```

Answer with the verdict and its first reasons, e.g. "avoid: the creator's 4 earlier launches collapsed; 6 first buyers were funded by one wallet".

### Pre-buy gate in a TypeScript bot

See [examples/pre-buy/gate.ts](examples/pre-buy/gate.ts): it batches the mints a bot is about to buy, buys only those rated `ok`, and rechecks `unknown` mints until their first buyers are analyzed.

### Rust bots on sol-trade-sdk

`sol-trade-sdk` has a synchronous `TradeRiskGate` hook. Refresh Dexra verdicts in a background task, publish them as an immutable snapshot, and read only the snapshot inside `check_buy`. Never call HTTP from the hot path.

## Guidelines

- **DO** show `reasons` with the verdict; the reasons are the product, not just the label.
- **DO** treat `unknown` as missing data (fresh launch, holders not snapshotted yet), not as `ok`.
- **DO** batch mints into one `new_launches_batch` call instead of one call per mint.
- **DO** handle `402` and tell the user why (see below) rather than retrying in a loop.
- **DON'T** describe `ok` as "will go up" or "safe to buy". It means none of the checked risks were found; Dexra measures survival over 24 hours, not price.
- **DON'T** call `token_deep_check` or `token_holders_delta` on SOL, USDC or USDT: tokens with millions of holders answer `400`.
- **DON'T** poll `new_launches` every few seconds on a Free key; 100 credits a day is about one call every 15 minutes. Use a plan or a webhook watch for live feeds.

## Common Errors

### 402 Payment Required
**Cause**: no key and no x402 payment, a key not recognized (keys start with `dxr_`), today's credits spent (`X-Dexra-Subscription: quota_exceeded`), or a call the plan does not cover such as a feed over an hour on Free (`plan_required`).
**Fix**: check the key; pay the x402 challenge; or move to a plan at https://dexra.dev/#pricing.

### 401 Unauthorized
**Cause**: a `dxr_` key that was revoked.
**Fix**: create a new key at https://dexra.dev/app/keys.

### 400 on a well-known token
**Cause**: the RPC lists only the top 20 holder accounts of tokens with millions of holders.
**Fix**: skip holder checks for majors; use `swap_preflight` or `pool_health` instead.

### `found: false` in a batch
**Cause**: the mint is not a launch Dexra tracks, or it was created seconds ago.
**Fix**: retry after a few seconds; for older tokens use `token_deep_check`.

### 429 Too Many Requests
**Cause**: over the per-second limit (2 rps on Free).
**Fix**: back off and batch mints.

## References

- [Docs](https://dexra.dev/docs)
- [OpenAPI](https://api.dexra.dev/openapi.json)
- [Pricing and plans](https://dexra.dev/#pricing), live at `GET https://api.dexra.dev/billing/plans`
- [Accuracy report](https://dexra.dev/accuracy)
- [x402 catalog](https://api.dexra.dev/.well-known/x402)
- [TypeScript client](https://www.npmjs.com/package/@dexra-dev/client), [MCP setup](https://www.npmjs.com/package/@dexra-dev/mcp)
