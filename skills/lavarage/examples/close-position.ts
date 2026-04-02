/**
 * Close a leveraged position on Lavarage.
 *
 * Supports full close and partial sell (close a percentage while keeping the rest).
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { LavaApiClient } from '../templates/client'

const client = new LavaApiClient(
  'https://api.lavarage.xyz',
  'lv2_prod_5e5f38fefc893ade780d8a2ccd7433ad8307808c83260e75',
  'your-wallet-pubkey',
)

async function closePosition() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  // 1. List active positions
  const positions = await client.getPositions('EXECUTED')
  if (positions.length === 0) {
    console.log('No active positions')
    return
  }

  const position = positions[0]
  console.log(
    `Closing: ${position.baseToken?.symbol} ${position.side} ` +
      `PnL: $${position.unrealizedPnlUsd} (${position.roiPercent}%)`,
  )

  // 2. Preview the close
  const closeQuote = await client.getCloseQuote({
    positionAddress: position.address,
    userPublicKey: walletAddress,
    slippageBps: 50,
  })
  console.log('Close quote:', JSON.stringify(closeQuote, null, 2))

  // 3. Build close transaction
  const { tipLamports } = await client.getTipFloor()
  const result = await client.buildCloseTx({
    positionAddress: position.address,
    userPublicKey: walletAddress,
    slippageBps: 50,
    astralaneTipLamports: tipLamports,
  })

  // 4. Sign and submit
  const txBytes = bs58.decode(result.transaction)
  const tx = VersionedTransaction.deserialize(txBytes)
  tx.sign([walletKeypair])

  const signedBase58 = bs58.encode(tx.serialize())
  const { result: txSignature } = await client.submitTransaction(
    signedBase58,
    true,
  )
  console.log(`Position closed! TX: ${txSignature}`)
}

async function partialSell() {
  const walletKeypair = Keypair.fromSecretKey(/* your secret key */)
  const walletAddress = walletKeypair.publicKey.toBase58()
  client.setWallet(walletAddress)

  const positions = await client.getPositions('EXECUTED')
  const position = positions[0]

  // Sell 50% of the position (keep the other 50% open)
  const result = await client.buildPartialSellTx({
    positionAddress: position.address,
    userPublicKey: walletAddress,
    splitRatioBps: 5000, // 50%
    slippageBps: 50,
  })

  // Partial sell returns two transactions — submit as Jito bundle
  const { tipLamports } = await client.getTipFloor()

  // Build a tip transaction (transfer tipLamports to Jito tip account)
  // Then sign all three and submit as bundle
  const splitTx = VersionedTransaction.deserialize(
    bs58.decode(result.splitTransaction),
  )
  const closeTx = VersionedTransaction.deserialize(
    bs58.decode(result.closeTransaction),
  )
  splitTx.sign([walletKeypair])
  closeTx.sign([walletKeypair])

  // Submit bundle: [tipTx, splitTx, closeTx]
  // Note: tip transaction construction omitted for brevity
  await client.submitBundle([
    /* tipTxBase58, */
    bs58.encode(splitTx.serialize()),
    bs58.encode(closeTx.serialize()),
  ])

  console.log('Partial sell complete — 50% sold, 50% still open')
  console.log('New position addresses:', result.newPositionAddresses)
}

closePosition().catch(console.error)
