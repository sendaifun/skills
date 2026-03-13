# Troubleshooting

## Common Issues

### "Account not found" on buy/sell
- Ensure the bonding curve exists: check `getBondingCurvePDA(tokenMint)` account exists on-chain
- Ensure user has an ATA for the quote asset (PIGEON/SOL/SKR)
- For Token-2022 tokens (PIGEON), use `TOKEN_2022_PROGRAM_ID` not `TOKEN_PROGRAM_ID`

### Token program mismatch
- PIGEON is Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)
- SOL (wSOL) and SKR are SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)
- All PigeonHouse-created tokens are Token-2022
- Use the correct program ID when deriving ATAs

### Slippage errors
- Bonding curve prices change with each trade
- Use 5-10% slippage (500-1000 bps) for normal trades
- For large trades relative to liquidity, increase slippage

### Graduation fails
- Token must reach graduation threshold (check `globalConfig.graduationPigeonAmount`)
- Graduation is permissionless — anyone can call it
- Ensure all ~27 required accounts are provided (see IDL)

### wSOL wrapping
- SOL-paired tokens require wSOL (wrapped SOL)
- Frontend should handle wrap/unwrap automatically
- Use `@solana/spl-token` `createSyncNativeInstruction` for wrapping

### API rate limits
- All API endpoints: 30 requests/minute per IP
- Use caching for token lists and burn stats
- Poll at reasonable intervals (30s+ for live data)

## Useful Links

- IDL (on-chain): https://941pigeon.fun/idl/pigeon_house.json
- Explorer: https://solscan.io/account/BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL
- OtterSec Verification: https://verify.osec.io/status/BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL
