# API Reference — Krexa REST API

Base URL: `https://tcredit-backend.onrender.com/api/v1`

All endpoints return JSON. POST endpoints accept `Content-Type: application/json`.

---

## Agent & Wallet

### GET /solana/wallets/:agent
Get agent wallet info and status.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/wallets/AGENT_ADDRESS
```

Response:
```json
{
  "success": true,
  "data": {
    "agent": "AGENT_ADDRESS",
    "wallet": "PDA_WALLET_ADDRESS",
    "type": "trader",
    "status": "active",
    "creditLevel": 1,
    "owner": "OWNER_ADDRESS"
  }
}
```

### GET /solana/wallets/:agent/balance
Get wallet USDC and SOL balance.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/wallets/AGENT_ADDRESS/balance
```

Response:
```json
{
  "success": true,
  "data": {
    "usdc": 450.25,
    "sol": 0.05,
    "walletPda": "PDA_WALLET_ADDRESS"
  }
}
```

---

## Credit

### GET /solana/credit/:agent/eligibility
Check credit eligibility and available limits.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/credit/AGENT_ADDRESS/eligibility
```

Response:
```json
{
  "success": true,
  "data": {
    "eligible": true,
    "creditLevel": 1,
    "maxCredit": 500,
    "availableCredit": 500,
    "outstandingDebt": 0,
    "apr": 36.50,
    "dailyRate": 0.10,
    "score": 350
  }
}
```

### POST /solana/credit/:agent/request
Request a credit draw (borrow USDC).

```bash
curl -X POST https://tcredit-backend.onrender.com/api/v1/solana/credit/AGENT_ADDRESS/request \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

Response:
```json
{
  "success": true,
  "data": {
    "txSignature": "5K7x...",
    "amount": 500,
    "outstandingDebt": 500,
    "dailyInterest": 0.50,
    "creditLevel": 1
  }
}
```

### POST /solana/credit/:agent/repay
Repay outstanding credit.

```bash
curl -X POST https://tcredit-backend.onrender.com/api/v1/solana/credit/AGENT_ADDRESS/repay \
  -H "Content-Type: application/json" \
  -d '{"amount": 50}'
```

Response:
```json
{
  "success": true,
  "data": {
    "txSignature": "3Jm2...",
    "amountRepaid": 50,
    "principalReduced": 45,
    "interestPaid": 5,
    "remainingDebt": 455
  }
}
```

---

## Score

### GET /solana/score/:agent
Get Krexit Score with component breakdown.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/score/AGENT_ADDRESS
```

Response:
```json
{
  "success": true,
  "data": {
    "agent": "AGENT_ADDRESS",
    "score": 350,
    "components": {
      "repayment": 5000,
      "profitability": 5000,
      "behavioral": 5000,
      "usage": 0,
      "maturity": 0
    },
    "creditLevel": 1,
    "maxCredit": 500,
    "apr": 36.50,
    "lastUpdated": "2026-04-04T12:00:00Z",
    "isBlacklisted": false,
    "expiresAt": "2026-07-03T12:00:00Z"
  }
}
```

---

## Vault

### GET /solana/vault/stats
Get vault statistics including TVL, utilization, and tranche data.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/vault/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "totalDeposits": 50000,
    "totalBorrowed": 35000,
    "utilization": 0.70,
    "utilizationCap": 0.80,
    "tranches": {
      "senior": { "allocation": 0.50, "apr": 10.0 },
      "mezzanine": { "allocation": 0.30, "apr": 12.0 },
      "junior": { "allocation": 0.20, "apr": 20.0 }
    },
    "insuranceFund": 8000,
    "insuranceFundTarget": 10000
  }
}
```

### GET /solana/vault/lp/:depositor
Get LP position for a depositor.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/vault/lp/DEPOSITOR_ADDRESS
```

Response:
```json
{
  "success": true,
  "data": {
    "depositor": "DEPOSITOR_ADDRESS",
    "shares": 1000,
    "currentValue": 1025.50,
    "depositedAmount": 1000,
    "yieldEarned": 25.50,
    "tranche": "senior",
    "effectiveApr": 10.2
  }
}
```

---

## Faucet

### POST /solana/faucet/usdc
Request devnet USDC (100 USDC per 24h).

```bash
curl -X POST https://tcredit-backend.onrender.com/api/v1/solana/faucet/usdc \
  -H "Content-Type: application/json" \
  -d '{"recipient": "WALLET_ADDRESS", "amountUsdc": 100}'
```

Response:
```json
{
  "success": true,
  "data": {
    "txSignature": "4Rx8...",
    "amount": 100,
    "recipient": "WALLET_ADDRESS"
  }
}
```

---

## Trading

### POST /solana/trading/:agent/quote
Get a swap quote via Jupiter without executing.

```bash
curl -X POST https://tcredit-backend.onrender.com/api/v1/solana/trading/AGENT_ADDRESS/quote \
  -H "Content-Type: application/json" \
  -d '{"from": "USDC", "to": "SOL", "amount": 50}'
```

Response:
```json
{
  "success": true,
  "data": {
    "from": "USDC",
    "to": "SOL",
    "amountIn": 50,
    "amountOut": 0.385,
    "route": "Jupiter v6",
    "priceImpact": 0.01,
    "fee": 0.05
  }
}
```

### POST /solana/trading/:agent/swap
Execute a token swap via Jupiter.

```bash
curl -X POST https://tcredit-backend.onrender.com/api/v1/solana/trading/AGENT_ADDRESS/swap \
  -H "Content-Type: application/json" \
  -d '{"from": "USDC", "to": "SOL", "amount": 50, "slippage": 0.5}'
```

Response:
```json
{
  "success": true,
  "data": {
    "txSignature": "2Lk9...",
    "from": "USDC",
    "to": "SOL",
    "amountIn": 50,
    "amountOut": 0.384,
    "route": "Jupiter v6"
  }
}
```

### GET /solana/trading/:agent/portfolio
Get all token balances and positions.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/trading/AGENT_ADDRESS/portfolio
```

Response:
```json
{
  "success": true,
  "data": {
    "tokens": [
      { "symbol": "USDC", "balance": 400, "valueUsd": 400 },
      { "symbol": "SOL", "balance": 0.384, "valueUsd": 50 }
    ],
    "totalValueUsd": 450
  }
}
```

### GET /solana/trading/yield
Scan available yield opportunities on Solana.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/trading/yield
```

Response:
```json
{
  "success": true,
  "data": {
    "opportunities": [
      {
        "protocol": "Meteora",
        "pool": "USDC-SOL",
        "apr": 15.2,
        "tvl": 5000000,
        "risk": "medium"
      }
    ]
  }
}
```

---

## KYA (Know Your Agent)

### POST /solana/kya/:agent/basic
Submit basic KYA verification for an agent.

```bash
curl -X POST https://tcredit-backend.onrender.com/api/v1/solana/kya/AGENT_ADDRESS/basic \
  -H "Content-Type: application/json" \
  -d '{"ownerName": "Agent Owner", "purpose": "trading", "expectedVolume": "medium"}'
```

Response:
```json
{
  "success": true,
  "data": {
    "status": "pending",
    "submittedAt": "2026-04-04T12:00:00Z",
    "requiredFor": "L2+"
  }
}
```

### GET /solana/kya/:agent/status
Check KYA verification status.

```bash
curl https://tcredit-backend.onrender.com/api/v1/solana/kya/AGENT_ADDRESS/status
```

Response:
```json
{
  "success": true,
  "data": {
    "status": "approved",
    "level": "basic",
    "approvedAt": "2026-04-04T14:00:00Z",
    "expiresAt": "2027-04-04T14:00:00Z"
  }
}
```
