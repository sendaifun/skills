# Troubleshooting

## Common Errors

### SIMULATION_FAILED

**Cause:** The Solana transaction simulation failed before submission.

**Solutions:**
- Increase `slippageBps` (try 100-300 for volatile tokens)
- Check if the offer still has sufficient liquidity
- The token price may have moved — rebuild the transaction
- Ensure the wallet has enough SOL for rent + fees (~0.01 SOL)

### INSUFFICIENT_BALANCE

**Cause:** Wallet doesn't have enough collateral tokens.

**Solutions:**
- Check wallet balance for the collateral token (SOL for longs, USDC for shorts)
- Reduce collateral amount
- Account for transaction fees (~0.005 SOL)

### POSITION_NOT_FOUND

**Cause:** Position address is invalid or not owned by the specified wallet.

**Solutions:**
- Verify the position address is correct
- Ensure `owner` query param matches the wallet that opened the position
- Position may have already been closed or liquidated — check with status `ALL`

### OFFER_NOT_FOUND

**Cause:** The offer/pool doesn't exist or is inactive.

**Solutions:**
- Re-search for available offers: `GET /offers?search=TOKEN`
- The pool may have been deactivated — look for alternative offers for the same token

### SLIPPAGE_EXCEEDED

**Cause:** Price moved beyond the specified slippage tolerance during transaction building.

**Solutions:**
- Increase `slippageBps` (e.g., 50 → 100 or 200)
- For low-liquidity tokens, use higher slippage (300-500 bps)
- Retry immediately — price movement may be temporary

### INVALID_LEVERAGE

**Cause:** Requested leverage exceeds the offer's maximum or is below minimum (1.1x).

**Solutions:**
- Check `maxLeverage` on the offer object
- Reduce leverage to within the allowed range
- Different offers for the same token may have different max leverage

### Transaction expired (blockhash not found)

**Cause:** Transaction was signed but not submitted before the blockhash expired (~60 seconds).

**Solutions:**
- Rebuild the transaction (gets fresh blockhash)
- Submit faster after signing
- Check network congestion

## Tips

- **Always quote before trading** to verify expected output and catch issues early
- **Use MEV protection** (`astralaneTipLamports` + submit via `/bundle/submit`) to prevent sandwich attacks
- **Monitor liquidation price** — if current price is within 15% of liquidation, consider adding collateral or reducing position
- **Partial sell vs full close** — use partial sell to take profits while maintaining exposure
- **Rate comparison** — multiple offers may exist for the same token; compare interest rates and max leverage
