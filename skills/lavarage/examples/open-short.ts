/**
 * Open a leveraged SHORT position on Lavarage.
 *
 * SHORT positions use USDC as collateral. You borrow the target token, sell it,
 * and profit when the price drops.
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { LavaApiClient } from '../templates/client'

const client = new LavaApiClient(
  'https://api.lavarage.xyz',
  'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75',
  'your-wallet-pubkey',
)

async function openShort() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  // 1. Find SHORT offers for the target token
  const offers = await client.getOffers({ search: 'ETH', side: 'SHORT' })
  if (offers.length === 0) throw new Error('No ETH SHORT offers found')

  const bestOffer = offers.sort(
    (a: any, b: any) => b.maxLeverage - a.maxLeverage,
  )[0]
  console.log(
    `Using SHORT offer: ${bestOffer.address} (${bestOffer.maxLeverage}x max)`,
  )

  // 2. For SHORT positions, collateral is in USDC (6 decimals)
  //    100 USDC = 100_000_000 micro-USDC
  const collateralMicroUsdc = '100000000' // 100 USDC
  const leverage = 2

  // 3. Build and submit (same pattern as LONG)
  const { tipLamports } = await client.getTipFloor()

  const result = await client.buildOpenTx({
    offerPublicKey: bestOffer.address,
    userPublicKey: walletAddress,
    collateralAmount: collateralMicroUsdc,
    leverage,
    slippageBps: 100, // 1% slippage for shorts
    astralaneTipLamports: tipLamports,
  })

  const txBytes = bs58.decode(result.transaction)
  const tx = VersionedTransaction.deserialize(txBytes)
  tx.sign([walletKeypair])

  const signedBase58 = bs58.encode(tx.serialize())
  const { result: txSignature } = await client.submitTransaction(
    signedBase58,
    true,
  )
  console.log(`SHORT position opened! TX: ${txSignature}`)
}

openShort().catch(console.error)
