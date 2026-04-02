/**
 * Borrow tokens against collateral on Lavarage — no directional bet.
 *
 * Use cases:
 * - Borrow USDC against SOL (keep SOL exposure, get liquid USDC)
 * - Borrow SOL against USDC
 * - Access liquidity without selling your holdings
 *
 * Repay anytime with full repay or partial repay.
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { LavaApiClient } from '../templates/client'

const client = new LavaApiClient(
  'https://api.lavarage.xyz',
  'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75',
  'your-wallet-pubkey',
)

async function borrow() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  // 1. Find an offer to borrow against
  const offers = await client.getOffers({ search: 'USDC' })
  if (offers.length === 0) throw new Error('No USDC offers found')
  const offer = offers[0]

  // 2. Borrow USDC against 1 SOL collateral
  //    leverage controls LTV:
  //    - 2x = borrow equal to collateral value (50% LTV)
  //    - 3x = borrow 2x collateral value (67% LTV)
  //    - Higher = more borrowed, higher liquidation risk
  const { tipLamports } = await client.getTipFloor()

  const result = await client.buildBorrowTx({
    offerPublicKey: offer.address,
    userPublicKey: walletAddress,
    collateralAmount: '1000000000', // 1 SOL
    leverage: 2,
    slippageBps: 50,
    astralaneTipLamports: tipLamports,
  })

  // 3. Sign and submit
  const txBytes = bs58.decode(result.transaction)
  const tx = VersionedTransaction.deserialize(txBytes)
  tx.sign([walletKeypair])

  const signedBase58 = bs58.encode(tx.serialize())
  const { result: txSignature } = await client.submitTransaction(
    signedBase58,
    true,
  )
  console.log(`Borrow complete! TX: ${txSignature}`)
  console.log('Borrowed tokens are now in your wallet.')
}

async function repayFull() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  // Find the borrow position
  const positions = await client.getPositions('EXECUTED')
  const borrowPosition = positions[0] // filter for your borrow position

  // Full repay
  const result = await client.buildRepayTx({
    positionAddress: borrowPosition.address,
    userPublicKey: walletAddress,
  })

  const txBytes = bs58.decode(result.transaction)
  const tx = VersionedTransaction.deserialize(txBytes)
  tx.sign([walletKeypair])

  const signedBase58 = bs58.encode(tx.serialize())
  await client.submitTransaction(signedBase58, true)
  console.log('Borrow fully repaid!')
}

async function repayPartial() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  const positions = await client.getPositions('EXECUTED')
  const borrowPosition = positions[0]

  // Repay 50% of the borrow
  const result = await client.buildPartialRepayTx({
    positionAddress: borrowPosition.address,
    userPublicKey: walletAddress,
    repaymentBps: 5000, // 50%
  })

  const txBytes = bs58.decode(result.transaction)
  const tx = VersionedTransaction.deserialize(txBytes)
  tx.sign([walletKeypair])

  const signedBase58 = bs58.encode(tx.serialize())
  await client.submitTransaction(signedBase58, true)
  console.log('50% of borrow repaid!')
}

borrow().catch(console.error)
