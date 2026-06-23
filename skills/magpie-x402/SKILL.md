---
name: magpie-x402
description: Magpie Capital — the first x402-native permissionless lending protocol on Solana. AI agents borrow SOL against their own memecoin or tokenized-stock/RWA collateral, arm in-vault take-profit/stop-loss exits, post conditional borrow intents, repay, and provide liquidity — all pay-per-call over HTTP 402 with no signup, no API key, and zero custody (the service holds no keys; the agent signs every transaction locally). Use when an agent needs on-chain SOL liquidity against tokens it already holds, automated in-vault exits, conditional/triggered borrows, or wants to integrate Solana lending via the @magpieloans/magpie-agent SDK or @magpieloans/magpie-mcp MCP server.
creator: magpiecapital
---

# Magpie Capital — x402-Native Permissionless Lending on Solana

## Overview

Magpie is a **permissionless, x402-native lending protocol** on Solana built for AI agents. An agent borrows SOL against collateral it already owns, manages the loan with self-owned automated exits, and repays — without ever creating an account, requesting an API key, or handing custody to anyone.

- **x402 pay-per-call** — Every paid endpoint speaks HTTP `402 Payment Required`. The agent pays a few lamports of SOL per call and receives a settlement proof. No signup, no API key, payment IS authentication.
- **Zero custody** — The service holds no keys. Build endpoints return an **unsigned** Solana transaction; the agent signs it **locally** and submits it. Loan ownership is always scoped to the borrower's signature.
- **Borrow against your own tokens** — Collateralize with memecoins (V1) or tokenized stocks / real-world assets (V3). 170+ approved collateral tokens.
- **In-vault exits (V4)** — Arm take-profit / stop-loss orders that fire **inside the loan vault**: proceeds accumulate in the per-loan vault PDA and the loan stays Active. The only path to the user wallet is a borrower-signed repay.
- **Conditional intents** — Post a borrow that only executes when a price / time / liquidity trigger is met, then poll or cancel it.
- **Two integration surfaces** — the typed `@magpieloans/magpie-agent` SDK (one-line calls, signs locally) and the `@magpieloans/magpie-mcp` MCP server (native tools for Claude, Cursor, Windsurf, ChatGPT).

**Key differentiator:** Magpie is x402-native end to end — discovery, simulation, borrow, in-vault exits, and repay are all reachable by an autonomous agent over plain HTTP with per-call SOL payment and no onboarding.

## Quick Start

There are three ways to integrate, from highest to lowest level.

### Option A — MCP server (Claude / Cursor / Windsurf / ChatGPT)

Expose Magpie as native tools in any MCP-aware agent host. Tools include pool state, simulate-borrow, conditional intents, and arming in-vault exits.

```bash
npx -y @magpieloans/magpie-mcp
```

Claude Desktop / Cursor config (`mcpServers`):

```json
{
  "mcpServers": {
    "magpie": {
      "command": "npx",
      "args": ["-y", "@magpieloans/magpie-mcp"]
    }
  }
}
```

The MCP manifest lives at `mcp/smithery.yaml` in the [magpie-x402 repo](https://github.com/magpiecapital/magpie-x402).

### Option B — TypeScript SDK (typed one-liners, signs locally)

```bash
npm install @magpieloans/magpie-agent
```

```typescript
import { MagpieAgent } from '@magpieloans/magpie-agent'

// The agent signs every transaction locally — the SDK never sees a server-held key.
const magpie = new MagpieAgent({ keypair: myKeypair }) // your Solana Keypair

// Inspect the live pool (free)
const pool = await magpie.getPool()

// Borrow SOL against a token the agent already holds (signs + submits locally)
const { signature } = await magpie.borrow({
  collateralMint: 'So11111111111111111111111111111111111111112',
  collateralAmount: 1_000_000_000n,
})
```

### Option C — Raw x402 HTTP

Call the API directly. Free endpoints respond immediately; paid endpoints return `402` first, then `200` once payment is attached.

```
Base URL: https://x402.magpie.capital
Catalog:  https://x402.magpie.capital/.well-known/x402.json
```

## Core Concepts

### x402 Payment Flow

Every **paid** endpoint uses a two-step handshake. Free endpoints skip it entirely.

```
Agent                          Magpie x402                    Solana
  |                               |                             |
  |-- request paid endpoint ----->|                             |
  |<-- 402 + payment requirements |                             |
  |   [pay + sign locally]        |                             |
  |-- retry + X-Payment header -->|                             |
  |                               |-- verify / settle --------->|
  |                               |<-- confirmed ---------------|
  |<-- 200 + data + settlement ---|                             |
```

- **Scheme:** `x402/solana/v1`
- **Network:** Solana
- **Asset:** SOL (lamports), priced per endpoint
- **Pay-to:** `4JSSSaG3xRomQsrxmdQEsahfyFjBVjvuoBKJUUZgzPAx`
- **Auth:** none — the payment is the authentication

The machine-readable catalog at `/.well-known/x402.json` lists every endpoint, its price, and its payment requirements. Read it first to discover current pricing.

### Loan Versions (route to the correct one)

| Version | Collateral type | Exits |
|---------|-----------------|-------|
| V1 | Memecoins (SPL) | No automated exits |
| V3 | Tokenized stocks / RWAs | No automated exits |
| V4 | Memecoin **or** RWA | In-vault TP/SL, ladders, brackets, trailing |

Borrows that arm exits use V4. Plain borrows use V1 (memecoin) or V3 (RWA). The build endpoints select the correct program for you based on the collateral and whether exits are requested.

### In-Vault Exits (V4)

When an agent arms a take-profit or stop-loss, the sell fires **inside the loan vault**:

- SOL proceeds accumulate in the per-loan `sol_proceeds_vault` PDA.
- The loan stays **Active** after the exit fires.
- The only path to the agent's wallet is a **borrower-signed repay**.

This lets an agent set automated risk management without ever giving up custody or closing the loan prematurely.

### Zero Custody — Always Sign Locally

Build endpoints (`build-borrow`, `build-deposit`, `build-withdraw`, `build-liquidate`) return an **unsigned, serialized** Solana transaction. The agent must:

1. Deserialize the transaction.
2. Sign it with its **own** keypair, locally.
3. Submit it (or let the SDK submit it).

The service never holds a private key and never moves funds on the agent's behalf.

## Core Operations

### 1. Inspect the pool (free)

```
GET /api/v1/pool        # one strategy pool, 15s cache
GET /api/v1/pools       # all three strategy pools at once
```

### 2. Check eligible collateral (free)

```
GET /api/v1/collateral/eligible   # approved collateral catalog, 1h cache
```

Always confirm a token is eligible before attempting to borrow against it.

### 3. Borrow SOL against your collateral (paid: build, then sign locally)

```
POST /api/v1/agent/build-borrow    # 0.005 SOL — returns an UNSIGNED tx
```

Pass the collateral mint and amount. The endpoint returns a serialized transaction; the agent signs locally and submits. With the SDK this is a single `magpie.borrow(...)` call.

### 4. Arm an in-vault take-profit / stop-loss (paid)

```
POST /api/v1/agent/self-limit-close/arm    # 0.001 SOL
GET  /api/v1/agent/self-limit-close/list   # free — list armed orders
```

Arms a V4 in-vault exit on an existing loan. Proceeds stay in the loan vault; the loan stays Active.

### 5. Post a conditional borrow intent (paid)

```
POST   /api/v1/agent/intent     # 0.01 SOL   — create a price/time/liquidity-triggered borrow
GET    /api/v1/agent/intent     # 0.0005 SOL — poll a single intent's status
GET    /api/v1/agent/intents    # 0.001 SOL  — list a wallet's intents
DELETE /api/v1/agent/intent     # free       — cancel a pending intent
```

### 6. Provide liquidity (paid: build, then sign locally)

```
POST /api/v1/agent/build-deposit    # 0.002 SOL — returns an UNSIGNED LP deposit tx
POST /api/v1/agent/build-withdraw   # 0.002 SOL — returns an UNSIGNED LP withdrawal tx
GET  /api/v1/agent/lp-state         # free — depositor position state
```

### 7. Liquidate a past-due loan (paid: build, then sign locally)

```
GET  /api/v1/markets/liquidatable      # free — active past-due loans, 8s cache
POST /api/v1/agent/build-liquidate     # 0.003 SOL — returns an UNSIGNED liquidation tx
```

### 8. Read loan + risk + activity (free / cheap)

```
GET /api/v1/loan/by-pda/{loanPda}      # free — single loan lookup
GET /api/v1/wallet/{wallet}/loans      # free — a wallet's loans
GET /api/v1/agent/token-risk           # 0.001 SOL — token risk profile
GET /api/v1/credit-score               # 0.001 SOL — credit score + tier benefits
GET /api/v1/agent/activity             # free — recent protocol activity
GET /api/v1/agent/protocol-pulse       # free — 24h aggregates
```

## Endpoint Reference

| Method | Path | Price (SOL) | Returns |
|--------|------|-------------|---------|
| GET | `/api/v1/pool` | Free | Live pool state |
| GET | `/api/v1/pools` | Free | All three strategy pools |
| GET | `/api/v1/collateral/eligible` | Free | Approved collateral catalog |
| GET | `/api/v1/credit-score` | 0.001 | Credit score + tier benefits |
| GET | `/api/v1/agent/token-risk` | 0.001 | Token risk profile |
| POST | `/api/v1/agent/build-borrow` | 0.005 | **Unsigned** borrow tx |
| POST | `/api/v1/agent/build-deposit` | 0.002 | **Unsigned** LP deposit tx |
| POST | `/api/v1/agent/build-withdraw` | 0.002 | **Unsigned** LP withdrawal tx |
| POST | `/api/v1/agent/build-liquidate` | 0.003 | **Unsigned** liquidation tx |
| POST | `/api/v1/agent/self-limit-close/arm` | 0.001 | Arm in-vault TP/SL |
| GET | `/api/v1/agent/self-limit-close/list` | Free | Armed exit orders |
| POST | `/api/v1/agent/intent` | 0.01 | Create conditional borrow |
| GET | `/api/v1/agent/intent` | 0.0005 | Poll intent status |
| GET | `/api/v1/agent/intents` | 0.001 | List wallet intents |
| DELETE | `/api/v1/agent/intent` | Free | Cancel pending intent |
| GET | `/api/v1/markets/liquidatable` | Free | Past-due loans |
| GET | `/api/v1/agent/activity` | Free | Recent activity |
| GET | `/api/v1/agent/protocol-pulse` | Free | 24h aggregates |
| GET | `/api/v1/agent/leaderboard` | Free | Top credit scores |
| GET | `/api/v1/agent/lp-state` | Free | Depositor position |
| GET | `/api/v1/loan/by-pda/{loanPda}` | Free | Single loan lookup |
| GET | `/api/v1/wallet/{wallet}/loans` | Free | A wallet's loans |

Base URL: `https://x402.magpie.capital`. Prices are SOL per call. Always read `/.well-known/x402.json` for current pricing.

## Examples

### Basic Usage

When the user asks: *"My agent holds a memecoin and needs SOL liquidity without selling it."*

The agent should:
1. `GET /api/v1/collateral/eligible` — confirm the token is approved collateral (free).
2. `GET /api/v1/pool` — read available liquidity and rates (free).
3. `POST /api/v1/agent/build-borrow` with the collateral mint + amount (0.005 SOL) — receive an **unsigned** tx.
4. Sign the tx **locally** with the agent's keypair and submit.
5. Later, repay (borrower-signed) or arm an exit — proceeds stay in-vault; only a borrower-signed repay returns funds to the wallet.

### Automated Risk Management

When the user asks: *"Borrow, then auto-sell to a stop-loss if the token drops, but keep the loan open."*

The agent should:
1. Borrow via V4 (collateral that supports exits).
2. `POST /api/v1/agent/self-limit-close/arm` with the stop-loss trigger (0.001 SOL).
3. The exit fires **in-vault** when triggered; SOL proceeds accrue in the loan vault and the loan stays Active.
4. `GET /api/v1/agent/self-limit-close/list` to confirm the order is armed (free).

### One-Line SDK Borrow

When the user asks: *"Integrate Magpie borrowing into my TypeScript agent."*

Use `@magpieloans/magpie-agent`, instantiate `MagpieAgent` with the agent's keypair, and call `magpie.borrow(...)`. The SDK fetches the unsigned tx, signs locally, and submits.

## Guidelines

- **DO** read `/.well-known/x402.json` first to discover live endpoints and current prices.
- **DO** check `/api/v1/collateral/eligible` before borrowing — only approved tokens work as collateral.
- **DO** sign every build-endpoint transaction **locally** with the agent's own keypair. The service never signs for you.
- **DO** route exits through V4 only — in-vault TP/SL is a V4 feature. V1/V3 loans have no automated exits.
- **DO** remember that after an in-vault exit fires, proceeds stay in the loan vault; the **only** way to the wallet is a borrower-signed repay.
- **DON'T** expect an API key or login flow — there is none. Payment over x402 is the authentication.
- **DON'T** send a collateral value above what the protocol attests on-chain; the program rejects an over-valued borrow. Size the request against pool/eligible data.
- **DON'T** treat a `402` as an error — it is the expected first response on paid endpoints. Attach payment and retry.

## Common Errors

### Error: 402 Payment Required on a paid endpoint
**Cause**: This is the normal first response for any paid endpoint — payment has not been attached yet.
**Solution**: Read the returned payment requirements, pay the quoted SOL amount on Solana, and retry the request with the `X-Payment` header (the SDK and MCP server handle this for you).

### Error: Borrow transaction rejected on submit
**Cause**: The submitted collateral value exceeded the on-chain attestation, or the collateral mint is not currently eligible.
**Solution**: Re-check `/api/v1/collateral/eligible`, size the borrow against live pool data, and rebuild the tx. Never inflate collateral value beyond the attested amount.

### Error: Exit cannot be armed on this loan
**Cause**: In-vault take-profit / stop-loss is a V4 feature. The loan is V1 or V3, which have no automated exits.
**Solution**: Only arm exits on V4 loans. For plain memecoin/RWA borrows without exits, use V1/V3 and manage manually.

## References

- **Site**: https://x402.magpie.capital
- **Catalog (machine-readable)**: https://x402.magpie.capital/.well-known/x402.json
- **Repo**: https://github.com/magpiecapital/magpie-x402
- **SDK**: [`@magpieloans/magpie-agent`](https://www.npmjs.com/package/@magpieloans/magpie-agent)
- **MCP server**: [`@magpieloans/magpie-mcp`](https://www.npmjs.com/package/@magpieloans/magpie-mcp) — manifest at `mcp/smithery.yaml` in the repo
- **$MAGPIE mint**: `9UuLsJ3jf8ViBNeRcwXD53re5G3ypgfKK3s2EiMMpump` — $MAGPIE holders receive a share of protocol fees, distributed pro-rata in SOL with no staking or lockup (70% governance-ratified target, MGP-001)

## Skill Structure

```
magpie-x402/
├── SKILL.md                  # This file — main agent instructions
├── resources/
│   └── api-reference.md      # Full endpoint catalog with prices and payment details
└── examples/
    └── borrow.ts             # Borrow against collateral via the SDK (signs locally)
```
