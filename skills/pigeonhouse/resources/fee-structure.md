# Fee Structure

## Fee Breakdown by Quote Asset

| Quote | Total Fee | Burn | Reserve | Treasury | Referrer |
|-------|-----------|------|---------|----------|----------|
| PIGEON | 2% | 1.5% | — | 0.5% | 0.5%* |
| SOL | 2% | — | 1.5% | 0.5% | 0.5%* |
| SKR | 2% | — | 1.5% | 0.5% | 0.5%* |

*Referrer fee comes from the burn/reserve portion. No referrer → extra burn/reserve.

## How It Works

### PIGEON-paired tokens
1. User buys/sells on bonding curve
2. 2% fee deducted from quote amount
3. 1.5% of PIGEON is **permanently burned** (sent to burn address)
4. 0.5% goes to treasury

### SOL/SKR-paired tokens
1. User buys/sells on bonding curve
2. 2% fee deducted from quote amount
3. 1.5% accrues in StrategicReserveVault (not burned)
4. 0.5% goes to treasury

## On-Chain Parameters

Fee values stored in `QuoteAssetConfig`:
- `pigeon_burn_bps`: Basis points for PIGEON burn (1500 = 1.5%)
- `reserve_bps`: Basis points for strategic reserve (1500 = 1.5%)
- `treasury_bps`: Basis points for treasury (500 = 0.5%)
- `referral_bps`: Basis points for referrer (500 = 0.5%)
