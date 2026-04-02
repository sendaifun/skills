# Lavarage API Reference

Base URL: `https://api.lavarage.xyz`

All endpoints prefixed with `/api/v1/`. Authentication via `x-api-key` header where noted.

---

## Market Discovery

### GET /api/v1/offers

List available leveraged trading markets. Each offer is a liquidity pool with specific token pair, leverage, and rates.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| search | string | Search by token name, symbol, or mint address |
| side | string | `LONG` or `SHORT` |
| quoteToken | string | Filter by quote token mint address |
| tags | string | Comma-separated tag filter |
| includeTokens | boolean | Include full token metadata (recommended: `true`) |
| limit | number | Max results |
| offset | number | Pagination offset |

**Response:** Array of offer objects:
```json
{
  "address": "offer-public-key",
  "baseTokenAddress": "mint",
  "quoteTokenAddress": "mint",
  "side": "LONG",
  "maxLeverage": 12.61,
  "interestRate": 5.2,
  "totalLiquidity": "1000000000",
  "baseToken": { "symbol": "WBTC", "name": "Wrapped BTC", "decimals": 8, "priceUsd": "67000", "logoUri": "..." },
  "quoteToken": { "symbol": "SOL", "name": "Solana", "decimals": 9, "priceUsd": "150", "logoUri": "..." }
}
```

### GET /api/v1/tokens

List all tokens with metadata.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| search | string | Search by name, symbol, or mint |

---

## Quotes (Trade Preview)

### POST /api/v1/positions/quote

Preview opening a position. Returns expected output, fees, and risk metrics.

**Body:**
```json
{
  "offerPublicKey": "string",
  "userPublicKey": "string",
  "collateralAmount": "string (smallest units)",
  "leverage": 3,
  "slippageBps": 50
}
```

### POST /api/v1/positions/close-quote

Preview closing a position. Returns proceeds and PnL.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "slippageBps": 50
}
```

---

## Transaction Builders

All builders return `{ transaction: "base58-encoded", lastValidBlockHeight: number }`. Deserialize, sign, and submit.

### POST /api/v1/positions/open *(x-api-key)*

Build transaction to open a leveraged position.

**Body:**
```json
{
  "offerPublicKey": "string",
  "userPublicKey": "string",
  "collateralAmount": "string (smallest units)",
  "leverage": 3,
  "slippageBps": 50,
  "astralaneTipLamports": 1000000
}
```

### POST /api/v1/positions/close *(x-api-key)*

Build transaction to close a position.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "slippageBps": 50,
  "astralaneTipLamports": 1000000
}
```

### POST /api/v1/positions/split *(x-api-key)*

Split one position into two.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "splitRatioBps": 5000
}
```

### POST /api/v1/positions/merge *(x-api-key)*

Merge two positions (same token pair and side).

**Body:**
```json
{
  "firstPositionAddress": "string",
  "secondPositionAddress": "string",
  "userPublicKey": "string"
}
```

### POST /api/v1/positions/partial-sell *(x-api-key)*

Build split+close bundle for partial sell. Returns two transactions.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "splitRatioBps": 3000,
  "slippageBps": 50
}
```

**Response:**
```json
{
  "splitTransaction": "base58",
  "closeTransaction": "base58",
  "newPositionAddresses": ["addr1", "addr2"]
}
```

### POST /api/v1/positions/repay *(x-api-key)*

Fully repay a borrow position.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string"
}
```

### POST /api/v1/positions/partial-repay *(x-api-key)*

Partially repay a borrow position.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "repaymentBps": 5000
}
```

### POST /api/v1/positions/increase-borrow *(x-api-key)*

Increase leverage on existing position.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "additionalBorrowAmount": "string",
  "mode": "withdraw | compound",
  "slippageBps": 50,
  "astralaneTipLamports": 1000000
}
```

### POST /api/v1/positions/increase-borrow-quote *(x-api-key)*

Preview leverage increase impact.

### POST /api/v1/positions/add-collateral *(x-api-key)*

Add collateral to reduce LTV / liquidation risk.

**Body:**
```json
{
  "positionAddress": "string",
  "userPublicKey": "string",
  "collateralAmount": "string",
  "astralaneTipLamports": 1000000
}
```

### POST /api/v1/positions/add-collateral-quote *(x-api-key)*

Preview adding collateral.

---

## Positions

### GET /api/v1/positions *(x-api-key)*

Query positions with computed fields.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| owner | string | Wallet public key (required) |
| status | string | `EXECUTED`, `CLOSED`, `LIQUIDATED`, `ALL` |
| limit | number | Max results |
| offset | number | Pagination offset |

**Response includes computed fields:**
- `unrealizedPnlUsd`, `roiPercent`
- `liquidationPrice`, `currentLtv`
- `effectiveLeverage`
- `interestAccrued`, `dailyInterestCost`
- `entryPrice`, `currentPrice`
- `collateralAmount`, `borrowedAmount`
- `baseToken`, `quoteToken` metadata

### GET /api/v1/positions/trade-history *(x-api-key)*

Trade event history.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| owner | string | Wallet public key (required) |
| positionAddress | string | Filter by position |
| eventType | string | `OPEN`, `CLOSE`, `LIQUIDATION`, `SPLIT`, `MERGE`, `REPAY` |
| limit | number | Max results |
| offset | number | Pagination offset |

---

## Bundle / MEV Protection

### GET /api/v1/bundle/tip

Get current Jito tip floor in lamports.

**Response:** `{ "tipLamports": 1000000 }`

### POST /api/v1/bundle/submit

Submit a single signed transaction with MEV protection.

**Body:**
```json
{
  "transaction": "base58-encoded-signed-tx",
  "mevProtect": true
}
```

### POST /api/v1/bundle

Submit a Jito bundle (multiple transactions).

**Body:**
```json
{
  "transactions": ["base58-tx-1", "base58-tx-2", "base58-tx-3"]
}
```
