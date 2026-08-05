# Magpie x402 — API Reference

Base URL: `https://x402.magpie.capital`
Machine-readable catalog: `https://x402.magpie.capital/.well-known/x402.json`

The catalog is the single source of truth for live endpoints and prices. Read it
at the start of a session — prices and routes can change there before this file does.

## Payment (x402)

- **Scheme:** `x402/solana/v1`
- **Network:** Solana
- **Asset:** SOL (lamports)
- **Pay-to:** `4JSSSaG3xRomQsrxmdQEsahfyFjBVjvuoBKJUUZgzPAx`
- **Auth:** none — payment IS authentication. No signup, no API key.

### Two-step handshake (paid endpoints only)

1. Send the request with no payment → `402 Payment Required` plus the payment
   requirements (amount in SOL, pay-to address, network).
2. Pay on Solana, then retry the same request with the `X-Payment` header set to
   the payment proof. → `200 OK` with the data and a settlement proof.

Free endpoints respond with `200` directly and never require payment.

The `@magpieloans/magpie-agent` SDK and `@magpieloans/magpie-mcp` MCP server
perform this handshake automatically.

## Zero custody

Every `build-*` endpoint returns an **unsigned, serialized** Solana transaction.
The agent deserializes it, signs it **locally** with its own keypair, and submits
it. The service never holds a key and never signs on the agent's behalf. Loan
ownership is scoped to the borrower's signature.

## Endpoint catalog

| Method | Path | Price (SOL) | Cache | Description |
|--------|------|-------------|-------|-------------|
| GET | `/api/v1/pool` | Free | 15s | Live lending pool state |
| GET | `/api/v1/pools` | Free | 15s | All three strategy pools at once |
| GET | `/api/v1/collateral/eligible` | Free | 1h | Approved collateral catalog (170+ tokens) |
| GET | `/api/v1/credit-score` | 0.001 | — | Credit score lookup + tier benefits |
| GET | `/api/v1/agent/token-risk` | 0.001 | — | Token risk profile assessment |
| POST | `/api/v1/agent/build-borrow` | 0.005 | — | Build borrow tx (returns **unsigned** tx) |
| POST | `/api/v1/agent/build-deposit` | 0.002 | — | Build LP deposit tx (returns **unsigned** tx) |
| POST | `/api/v1/agent/build-withdraw` | 0.002 | — | Build LP withdrawal tx (returns **unsigned** tx) |
| POST | `/api/v1/agent/build-liquidate` | 0.003 | — | Build liquidation tx (returns **unsigned** tx) |
| POST | `/api/v1/agent/self-limit-close/arm` | 0.001 | — | Arm in-vault take-profit / stop-loss (V4) |
| GET | `/api/v1/agent/self-limit-close/list` | Free | — | List armed exit orders |
| POST | `/api/v1/agent/intent` | 0.01 | — | Create conditional borrow (price/time/liquidity trigger) |
| GET | `/api/v1/agent/intent` | 0.0005 | — | Poll a single conditional borrow's status |
| GET | `/api/v1/agent/intents` | 0.001 | — | List a wallet's intents |
| DELETE | `/api/v1/agent/intent` | Free | — | Cancel a pending intent |
| GET | `/api/v1/markets/liquidatable` | Free | 8s | Active past-due loans |
| GET | `/api/v1/agent/activity` | Free | 15s | Recent protocol activity |
| GET | `/api/v1/agent/protocol-pulse` | Free | 30s | 24h aggregates |
| GET | `/api/v1/agent/leaderboard` | Free | 60s | Top credit scores |
| GET | `/api/v1/agent/lp-state` | Free | 10s | Depositor position state |
| GET | `/api/v1/loan/by-pda/{loanPda}` | Free | 10s | Single loan lookup |
| GET | `/api/v1/wallet/{wallet}/loans` | Free | 8s | A wallet's loans |

## Loan version routing

| Version | Collateral | Automated exits |
|---------|------------|-----------------|
| V1 | Memecoins (SPL) | No |
| V3 | Tokenized stocks / RWAs | No |
| V4 | Memecoin or RWA | In-vault TP/SL, ladders, brackets, trailing |

In-vault exits (V4) fire **inside the loan vault**: SOL proceeds accumulate in the
per-loan vault PDA and the loan stays **Active**. The only path to the agent's
wallet is a **borrower-signed repay**.

## Integration surfaces

- **SDK:** `@magpieloans/magpie-agent` (npm) — typed one-liners, signs locally.
- **MCP server:** `@magpieloans/magpie-mcp` (npm) — native tools for Claude,
  Cursor, Windsurf, ChatGPT. Manifest at `mcp/smithery.yaml` in the
  [magpie-x402 repo](https://github.com/magpiecapital/magpie-x402).
