/**
 * Open a leveraged LONG position on Lavarage.
 *
 * Flow: search for offer → quote → build TX → sign → submit with MEV protection
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { LavaApiClient } from '../templates/client'

const client = new LavaApiClient(
  'https://api.lavarage.xyz',
  'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75',
  'your-wallet-pubkey',
)

async function openLong() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  // 1. Find best offer for LONG WBTC
  const offers = await client.getOffers({ search: 'WBTC', side: 'LONG' })
  if (offers.length === 0) throw new Error('No WBTC LONG offers found')

  // Pick the offer with highest max leverage (or sort by liquidity/rate as needed)
  const bestOffer = offers.sort(
    (a: any, b: any) => b.maxLeverage - a.maxLeverage,
  )[0]
  console.log(
    `Using offer: ${bestOffer.address} (${bestOffer.maxLeverage}x max, ${bestOffer.interestRate}% rate)`,
  )

  // 2. Preview the trade
  const collateralLamports = '1000000000' // 1 SOL
  const leverage = 3

  const quote = await client.getOpenQuote({
    offerPublicKey: bestOffer.address,
    userPublicKey: walletAddress,
    collateralAmount: collateralLamports,
    leverage,
    slippageBps: 50,
  })
  console.log('Quote:', JSON.stringify(quote, null, 2))

  // 3. Build the transaction with MEV protection
  const { tipLamports } = await client.getTipFloor()

  const result = await client.buildOpenTx({
    offerPublicKey: bestOffer.address,
    userPublicKey: walletAddress,
    collateralAmount: collateralLamports,
    leverage,
    slippageBps: 50,
    astralaneTipLamports: tipLamports,
  })

  // 4. Sign the transaction
  const txBytes = bs58.decode(result.transaction)
  const tx = VersionedTransaction.deserialize(txBytes)
  tx.sign([walletKeypair])

  // 5. Submit with MEV protection
  const signedBase58 = bs58.encode(tx.serialize())
  const { result: txSignature } = await client.submitTransaction(
    signedBase58,
    true,
  )
  console.log(`Position opened! TX: ${txSignature}`)
  console.log(`https://solscan.io/tx/${txSignature}`)
}

openLong().catch(console.error)
