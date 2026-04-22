---
name: wallet-analysis
description: Analyze Solana wallets and multichain portfolios with Zerion API. Use for Solana portfolio value, token positions, transaction history, wallet charts, and PnL. Prefer direct REST API integration, with hosted MCP and x402 on Solana as no-key alternatives for agent workflows.
metadata:
  author: Zerion
  version: "0.1.0"
  mcp-server: zerion-api
---

# Wallet Analysis with Zerion API

Build Solana-first wallet analysis features with Zerion's normalized wallet API. Use this skill when the user wants portfolio views, token balances, interpreted transactions, charts, or wallet-level PnL for Solana addresses, while still supporting the same flows across Zerion's broader multichain surface.

## Overview

Zerion is especially useful when you need:
- Solana wallet portfolio summaries without building your own indexer
- Solana token holdings and wallet activity in a normalized schema
- Wallet PnL and historical chart views for portfolio apps and agents
- API-first implementation guidance, with MCP available for agent-native environments

## Authentication

Prefer these auth modes in this order:

### 1. API key for app integrations

Use Zerion API directly when the user is building a product integration.

```bash
export ZERION_API_KEY="zk_dev_..."

curl -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/8BH9pjtgyZDC4iAQH5ZiYDZ1MDWC98xki2V8NzqqKW3K/portfolio"
```

For explicit headers, use HTTP Basic auth with `base64("${ZERION_API_KEY}:")`.

### 2. x402 for no-key agent workflows, including Solana

If the user does not want to provision an API key, Zerion documents x402 as a pay-per-request path for AI workflows. Zerion's official agent repo also documents Solana-backed x402, so a Solana wallet can be used instead of an API key when the runtime supports x402 payment handshakes.

```bash
export SOLANA_PRIVATE_KEY="5C1y..."
export ZERION_X402_PREFER_SOLANA=true
```

Use x402 when:
- the user explicitly wants no API key
- the environment already supports x402
- the workflow is agentic and Solana-funded

### 3. Hosted MCP for agent-native environments

If the user is in Claude Code, Cursor, or another MCP-native client, Zerion API provides a hosted MCP endpoint:

```text
https://developers.zerion.io/mcp
```

Treat MCP as an alternate interface, not a different product. The same wallet-analysis surface is available there, and Zerion's official AI docs/repo describe API key and x402 auth paths for AI workflows. Prefer direct REST API examples when the user is asking for app code.

## Routing

Start with Solana unless the user asks for another chain. Zerion's wallet-analysis endpoints support Solana addresses and the same normalized object model used across the rest of the API.

| User intent | Endpoint / Tool |
|---|---|
| Solana wallet overview | `GET /v1/wallets/{address}/portfolio` or MCP `wallet-portfolio` |
| Solana token balances | `GET /v1/wallets/{address}/positions/` or MCP `wallet-positions` |
| Solana recent activity | `GET /v1/wallets/{address}/transactions/` or MCP `wallet-transactions` |
| Solana wallet PnL | `GET /v1/wallets/{address}/pnl` or MCP `wallet-pnl` |
| Solana portfolio chart | `GET /v1/wallets/{address}/charts/{period}` |
| Supported chains | `GET /v1/chains/` or MCP `chains-list` |

## Solana-First Workflow

1. Confirm the wallet address is Solana if the user is building for Solana.
2. Fetch `portfolio` first to get total value and high-level composition.
3. Fetch `positions` next for token-level breakdown.
4. Fetch `transactions` for interpreted wallet activity.
5. Fetch `pnl` when the user needs performance, realized gains, or net invested amounts.
6. Add `charts` when the user needs historical portfolio value in the UI.
7. Only expand to EVM or multichain filters if the user's request actually needs them.

## API Patterns

### Portfolio

```bash
curl -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/${ADDRESS}/portfolio?currency=usd"
```

Use this first for Solana wallet dashboards, watchlists, and summary cards.

### Positions

```bash
curl -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/${ADDRESS}/positions/?filter[positions]=no_filter"
```

Use `filter[positions]=only_simple` when the user only wants token balances.

### Transactions

```bash
curl -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/${ADDRESS}/transactions/?page[size]=10&currency=usd"
```

Use this for interpreted Solana activity such as swaps, transfers, and approvals.

### PnL

```bash
curl -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/${ADDRESS}/pnl?currency=usd"
```

Use this when the user asks for realized gain, unrealized gain, net invested, or cost basis.

### Charts

```bash
curl -u "$ZERION_API_KEY:" \
  "https://api.zerion.io/v1/wallets/${ADDRESS}/charts/month?currency=usd"
```

Use this for portfolio trend charts and timeline visualizations.

## Guidelines

- Prefer Zerion API for implementation examples in app code.
- Use Solana wallet examples in prompts, code, and explanations whenever possible.
- Use Zerion MCP when the user wants agent-native querying in Claude Code, Cursor, or VS Code.
- Make x402 a first-class fallback, especially when the user wants a Solana-funded no-key setup.
- Keep Basic auth examples accurate: API key as username, empty password.
- Do not tell the user to build chain-specific parsers when Zerion already normalizes Solana wallet data.
- Do not invent x402 headers or payment flows; use Zerion's documented path when the runtime supports x402.

## Common Errors

### 401 Unauthorized
**Cause**: Missing or invalid API key in Basic auth.
**Fix**: Use `curl -u "$ZERION_API_KEY:" ...` or encode `ZERION_API_KEY:` into the `Authorization: Basic ...` header.

### 402 Payment Required
**Cause**: x402 path selected but the runtime has not completed the payment handshake.
**Fix**: Use a client/runtime that supports x402 and fund the Solana wallet with the required balance.

### Empty Solana positions on first request
**Cause**: Zerion docs note some Solana assets can need a short bootstrap period.
**Fix**: Retry with bounded polling instead of assuming the wallet is empty.

### Missing protocol positions on Solana
**Cause**: Zerion's current docs still list protocol-position support on Solana as a temporary limitation for the wallet positions surface.
**Fix**: Be explicit that token balances are available, but DeFi protocol position coverage may be incomplete for Solana right now.

## References

- [Zerion API Introduction](https://developers.zerion.io/introduction)
- [Build with AI](https://developers.zerion.io/reference/building-with-ai)
- [Hosted MCP](https://developers.zerion.io/build-with-ai/mcp)
- [Get wallet portfolio](https://developers.zerion.io/api-reference/wallets/get-wallet-portfolio)
- [Get wallet positions](https://developers.zerion.io/reference/listwalletpositions)
- [Get wallet transactions](https://developers.zerion.io/reference/listwallettransactions)
- [Get wallet PnL](https://developers.zerion.io/api-reference/wallets/get-wallet-pnl)
