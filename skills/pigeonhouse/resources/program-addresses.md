# Program Addresses

## PigeonHouse Protocol

| Program | Address | Description |
|---------|---------|-------------|
| PigeonHouse | `BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL` | Main protocol (Anchor) |
| Hook Program | `49NjaVFxXUhWg59g4bEDtcNQxsArFz9MnyeQGPxUDugi` | Token-2022 TransferHook |
| Raydium CPMM | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | Graduation target DEX |

## Token Mints

| Token | Mint | Standard |
|-------|------|----------|
| PIGEON | `4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump` | Token-2022 (6 dec) |
| SOL (wSOL) | `So11111111111111111111111111111111111111112` | SPL Token (9 dec) |
| SKR | `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` | SPL Token (6 dec) |

## PDAs

| PDA | Seeds | Description |
|-----|-------|-------------|
| GlobalConfig | `["pigeon_house_config"]` | Protocol configuration |
| BondingCurve | `["bonding_curve", token_mint]` | Per-token curve state |
| FeeVault | `["fee_vault"]` | Fee collection vault |
| QuoteAssetConfig | `["quote_asset", quote_mint]` | Per-quote-asset config |
| BurnAccrualVault | `["burn_accrual", quote_mint]` | Accrued fees for burn |
| StrategicReserve | `["strategic_reserve", quote_mint]` | Reserve vault |

## Verification

- OtterSec: https://verify.osec.io/status/BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL
- IDL: https://941pigeon.fun/idl/pigeon_house.json
- Source: https://github.com/noegppgeon-boop/Pigeonhouse
