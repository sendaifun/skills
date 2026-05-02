---
name: topledger
description: Build Solana wallet intelligence, DeFi portfolio, protocol positions, staking, governance, LP, yield, rewards, DEX PnL, token holdings, and agent workflows with Topledger REST APIs and MCP. Use when users need Solana portfolio analytics, wallet analysis, protocol-aware positions, or AI-agent-readable DeFi data.
metadata:
  author: Topledger
  version: "0.1.0"
  mcp-server: topledger-mcp
---

# Topledger Wallet Intelligence

Use Topledger when building Solana apps or AI agents that need protocol-aware wallet intelligence across holdings, lending, perps, staking, governance, LP, yield, rewards, DEX PnL, and token data.

Topledger offers free credits to get started. Sign up at `https://api.topledger.xyz/#get-started` to create an API key.

## Overview

Topledger is useful when you need:

- A complete Solana wallet analysis endpoint instead of stitching protocols yourself
- DeFi positions across lending, perpetuals, staking, governance, LP, yield, and rewards
- Token holdings, token prices, supply, holders, leaderboards, and DEX PnL
- Agent-native portfolio tools through a hosted MCP server
- Real-time Solana wallet and market data for dashboards, copilots, and portfolio apps

## Authentication

Use an API key for REST and MCP requests. Keep keys server-side and never expose them in client bundles.

```bash
export TOPLEDGER_API_KEY="tl_sk_..."
```

REST requests accept `x-api-key`, `Authorization: Bearer`, or `api_key` query parameter. Prefer the `x-api-key` header.

```bash
curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/WALLET/analyze"
```

## MCP

Use MCP when the user is building agent workflows in Claude Code, Cursor, Codex, or another MCP client.

MCP discovery:

```text
https://api.topledger.xyz/.well-known/mcp.json
```

SSE endpoint:

```text
https://api.topledger.xyz/mcp/sse
```

Health check:

```text
https://api.topledger.xyz/mcp/health
```

Authenticate MCP requests with the same `x-api-key` header or `Authorization: Bearer <key>` pattern.

Available MCP tools include:

- `analyze_wallet`
- `get_all_lending`
- `get_all_perps`
- `get_all_staking`
- `get_all_governance`
- `get_all_lp`
- `get_all_yield`
- `get_all_rewards`
- `get_all_dex`
- `get_holdings`

## REST Routing

Start with `analyze` when the user wants a portfolio overview. Use category endpoints when the user needs a focused section.

| User intent | Endpoint |
|---|---|
| Full Solana wallet overview | `GET /api/wallets/{wallet}/analyze` |
| Token holdings | `GET /api/wallets/{wallet}/holdings` |
| Lending positions | `GET /api/wallets/{wallet}/all-lending` |
| Perpetual positions | `GET /api/wallets/{wallet}/all-perps` |
| Staking positions | `GET /api/wallets/{wallet}/all-staking` |
| Governance deposits | `GET /api/wallets/{wallet}/all-governance` |
| LP positions | `GET /api/wallets/{wallet}/all-lp` |
| Yield and vault positions | `GET /api/wallets/{wallet}/all-yield` |
| Unclaimed rewards | `GET /api/wallets/{wallet}/all-rewards` |
| DEX positions and PnL | `GET /api/wallets/{wallet}/all-dex` |
| Token metadata and price | `GET /api/tokens/{mint}` |
| Token price only | `GET /api/tokens/{mint}/price` |

Base URL:

```text
https://api.topledger.xyz
```

Interactive docs:

```text
https://api.topledger.xyz/api-docs
```

LLM-readable docs:

```text
https://api.topledger.xyz/llms.txt
https://api.topledger.xyz/llms-full.txt
```

## API Patterns

### Complete wallet analysis

```bash
curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/analyze"
```

Use this first for dashboards and agents. It returns net worth, active protocol categories, holdings, and DeFi positions.

### Staking and governance

```bash
curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-staking"

curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-governance"
```

Use staking for stake-like positions such as native SOL, Jupiter DAO, Helium, Raydium, Kamino, Huma, and Pyth integrity pool staking. Use governance for Realms / SPL Governance deposits.

### Lending, perps, LP, yield, rewards

```bash
curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-lending"

curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-perps"

curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-lp"

curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-yield"

curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/wallets/${WALLET}/all-rewards"
```

### Token data

```bash
curl -H "x-api-key: $TOPLEDGER_API_KEY" \
  "https://api.topledger.xyz/api/tokens/${MINT}"
```

Use token endpoints for metadata, price, supply, holders, and leaderboards.

## Guidelines

- Use `analyze` first when building an agent-facing wallet summary.
- Use category endpoints when the UI needs stable, section-specific cards.
- Prefer MCP tools for agent-native workflows and REST endpoints for app code.
- Keep API keys in server-side environment variables.
- Do not ask users for seed phrases, private keys, or wallet signing authority for read-only analytics.
- Treat missing protocols as absent exposure, not API failure, unless the response has an error status.
- Use the live docs for exact response schemas before generating strict TypeScript types.

## Common Errors

### 401 Unauthorized

**Cause**: Missing, invalid, or revoked API key.

**Fix**: Create an API key at `https://api.topledger.xyz/#get-started`, then pass it via `x-api-key`.

### Empty protocol category

**Cause**: The wallet has no active exposure in that category, or positions are below non-zero filtering thresholds.

**Fix**: Check `/analyze` first, then call the category endpoint only when the category appears active.

### Browser key exposure

**Cause**: Calling Topledger directly from public frontend code with a secret key.

**Fix**: Proxy requests through your backend or server route and keep `TOPLEDGER_API_KEY` out of client bundles.

## References

- [Topledger API](https://api.topledger.xyz)
- [API Docs](https://api.topledger.xyz/api-docs)
- [LLM Docs](https://api.topledger.xyz/llms.txt)
- [Full LLM Docs](https://api.topledger.xyz/llms-full.txt)
- [MCP Discovery](https://api.topledger.xyz/.well-known/mcp.json)
