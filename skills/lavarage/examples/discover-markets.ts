/**
 * Discover available leveraged trading markets on Lavarage.
 *
 * Lavarage is permissionless — any SPL token with a liquidity pool can be traded
 * with leverage. Always search before assuming a market doesn't exist.
 */
import { LavaApiClient } from '../templates/client'

const client = new LavaApiClient(
  'https://api.lavarage.xyz',
  'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75',
  'your-wallet-pubkey',
)

async function main() {
  // Search for a specific token (by name, symbol, or mint address)
  const btcOffers = await client.getOffers({ search: 'BTC' })
  console.log(`Found ${btcOffers.length} BTC offers:`)
  for (const offer of btcOffers) {
    console.log(
      `  ${offer.baseToken.symbol}/${offer.quoteToken.symbol}` +
        `  side=${offer.side}  maxLev=${offer.maxLeverage}x` +
        `  rate=${offer.interestRate}%`,
    )
  }

  // Search for stocks / real-world assets
  const stockOffers = await client.getOffers({ search: 'OPENAI' })
  console.log(`\nOPENAI offers: ${stockOffers.length}`)

  // Filter by side — find all tokens you can SHORT
  const shortOffers = await client.getOffers({ side: 'SHORT' })
  console.log(`\nAll SHORT markets: ${shortOffers.length}`)
  for (const offer of shortOffers) {
    console.log(`  SHORT ${offer.quoteToken?.symbol ?? offer.baseToken.symbol}  maxLev=${offer.maxLeverage}x`)
  }

  // Filter by side — find all tokens you can LONG
  const longOffers = await client.getOffers({ side: 'LONG' })
  console.log(`\nAll LONG markets: ${longOffers.length}`)
  for (const offer of longOffers) {
    console.log(`  LONG ${offer.baseToken.symbol}  maxLev=${offer.maxLeverage}x`)
  }

  // List all available tokens
  const tokens = await client.getTokens()
  console.log(`\nTotal tokens available: ${tokens.length}`)

  // Search by mint address
  const byMint = await client.getOffers({
    search: 'So11111111111111111111111111111111111111112', // WSOL
  })
  console.log(`\nOffers for WSOL mint: ${byMint.length}`)
}

main().catch(console.error)
