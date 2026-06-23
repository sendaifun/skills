/**
 * Borrow SOL against a token the agent already holds, using the Magpie SDK.
 *
 * Magpie is x402-native and zero-custody: the SDK performs the HTTP 402 payment
 * handshake for you, fetches an UNSIGNED transaction from the build endpoint,
 * signs it LOCALLY with the agent's own keypair, and submits it. The service
 * never holds a key. There is no signup and no API key — payment over x402 is
 * the authentication.
 *
 * Install:  npm install @magpieloans/magpie-agent
 */

import { MagpieAgent } from '@magpieloans/magpie-agent'
import { Keypair } from '@solana/web3.js'

// Load the agent's own keypair. Keep the secret local — never send it anywhere.
// (Here, from a base58/JSON secret in the environment; adapt to your key store.)
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.SOLANA_SECRET_KEY!)),
)

async function main() {
  const magpie = new MagpieAgent({ keypair })

  // 1. Confirm the collateral mint is approved (free endpoint).
  const eligible = await magpie.getEligibleCollateral()
  console.log(`Approved collateral tokens: ${eligible.length}`)

  // 2. Inspect the live pool — available liquidity and current rate (free).
  const pool = await magpie.getPool()
  console.log('Pool state:', pool)

  // 3. Borrow SOL against a token the agent holds.
  //    The SDK pays the x402 fee, fetches the unsigned tx, signs locally, submits.
  const { signature } = await magpie.borrow({
    collateralMint: 'So11111111111111111111111111111111111111112', // example mint
    collateralAmount: 1_000_000_000n, // smallest unit (e.g. 1 token at 9 decimals)
  })
  console.log(`Borrow submitted: https://solscan.io/tx/${signature}`)

  // 4. (Optional, V4 only) Arm an in-vault stop-loss. The exit fires inside the
  //    loan vault; proceeds stay in the vault and the loan stays Active. The only
  //    path back to the wallet is a borrower-signed repay.
  //
  // await magpie.armExit({ loanPda, type: 'stop_loss', triggerPrice })
}

main().catch((err) => {
  // A 402 is the EXPECTED first response on paid endpoints — the SDK handles it.
  // A thrown error here means the borrow itself failed (e.g. ineligible collateral
  // or a collateral value above the on-chain attestation). Re-check eligibility
  // and pool data, then rebuild.
  console.error('Borrow failed:', err)
  process.exit(1)
})
