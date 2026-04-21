# Zerion Wallet Analysis Reference

## Core endpoints

| Purpose | Endpoint |
|---|---|
| Wallet portfolio | `GET /v1/wallets/{address}/portfolio` |
| Wallet positions | `GET /v1/wallets/{address}/positions/` |
| Wallet transactions | `GET /v1/wallets/{address}/transactions/` |
| Wallet PnL | `GET /v1/wallets/{address}/pnl` |
| Wallet chart | `GET /v1/wallets/{address}/charts/{period}` |
| Chains list | `GET /v1/chains/` |

## MCP tools

These names come from Zerion's hosted MCP tool catalog:

| Purpose | MCP tool |
|---|---|
| Wallet portfolio | `wallet-portfolio` |
| Wallet positions | `wallet-positions` |
| Wallet transactions | `wallet-transactions` |
| Wallet PnL | `wallet-pnl` |
| Chains list | `chains-list` |
| Token search | `search` |

## Auth summary

- API-first app integrations: Basic auth with `ZERION_API_KEY`
- No-key AI workflows: x402
- Solana-funded x402: supported by Zerion's official agent repo
- Hosted MCP endpoint: `https://developers.zerion.io/mcp`
