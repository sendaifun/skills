# Lavarage Types Reference

## Position Side

```typescript
type Side = 'LONG' | 'SHORT'
```

- **LONG**: Collateral is SOL or non-USDC token. You profit when the base token price rises.
- **SHORT**: Collateral is USDC. You borrow the target token and sell it. You profit when the price drops.

## Position Status

```typescript
type PositionStatus = 'NEW' | 'EXECUTED' | 'CLOSED' | 'LIQUIDATED'
```

| Status | Meaning |
|--------|---------|
| NEW | Transaction submitted, awaiting on-chain confirmation |
| EXECUTED | Active, open position |
| CLOSED | User closed the position |
| LIQUIDATED | Position was liquidated (LTV exceeded threshold) |

## Increase Borrow Mode

```typescript
type IncreaseBorrowMode = 'withdraw' | 'compound'
```

- **withdraw**: Borrow more tokens and receive them in your wallet
- **compound**: Borrow more and swap into the base token (increases position size and leverage)

## Trade Event Types

```typescript
type TradeEventType = 'OPEN' | 'CLOSE' | 'LIQUIDATION' | 'SPLIT' | 'MERGE' | 'REPAY'
```

## Unit Conversions

| Token | Decimals | 1 Token = |
|-------|----------|-----------|
| SOL | 9 | 1,000,000,000 lamports |
| USDC | 6 | 1,000,000 micro-USDC |
| WBTC | 8 | 100,000,000 satoshis |
| WETH | 8 | 100,000,000 gwei |

When passing `collateralAmount` to the API, always use the smallest unit:
```typescript
// 1 SOL
const lamports = '1000000000'

// 100 USDC
const microUsdc = '100000000'

// 0.01 WBTC
const sats = '1000000'
```

## Basis Points

Slippage and split ratios use basis points (bps):

| Value | Percentage |
|-------|-----------|
| 50 | 0.5% |
| 100 | 1% |
| 500 | 5% |
| 5000 | 50% |
| 10000 | 100% |
