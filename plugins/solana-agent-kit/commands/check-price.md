---
name: check-price
description: Get the current price of a Solana token using CoinGecko API
---

# Check Token Price

Get the current USD price and market data for a Solana token.

## Usage

```
/check-price <token_address_or_symbol>
```

## Steps

1. **Identify the token**
   - If `$ARGUMENTS` is a token symbol (SOL, USDC, JUP, etc.), look up the contract address
   - If `$ARGUMENTS` is already a contract address, use it directly

2. **Common Token Addresses**
   | Symbol | Address |
   |--------|---------|
   | USDC | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v |
   | USDT | Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB |
   | SOL | So11111111111111111111111111111111111111112 |
   | JUP | JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN |
   | BONK | DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 |
   | WIF | EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm |
   | RAY | 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R |

3. **Fetch price data using CoinGecko API**
   ```typescript
   const response = await fetch(
     `https://api.coingecko.com/api/v3/onchain/simple/networks/solana/token_price/${address}?include_market_cap=true&include_24hr_vol=true&include_24hr_price_change=true`,
     {
       headers: {
         'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || '',
         'Accept': 'application/json'
       }
     }
   );
   ```

4. **Display results**
   - Current USD price
   - 24h price change percentage
   - 24h trading volume
   - Market cap (if available)

## Example Output

```
Token: JUP (JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN)
Price: $0.8234
24h Change: +5.67%
24h Volume: $45,234,567
Market Cap: $1,234,567,890
```

## Notes

- Requires COINGECKO_API_KEY for higher rate limits
- Free tier allows 30 calls/minute
- Some tokens may not have market cap data
