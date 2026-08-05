/**
 * Priority Fee Transfer — full end-to-end example
 *
 * Builds a SOL transfer that:
 *   1. Simulates the transaction to measure the real compute units (CUs) used.
 *   2. Fetches a network priority fee from getRecentPrioritizationFees.
 *   3. Prepends the two ComputeBudget instructions (limit + price).
 *   4. Sends it as a VersionedTransaction.
 *   5. Confirms it with blockhash-expiry polling (no stuck promises).
 *
 * Defaults to devnet. Run with:  npx ts-node example.ts
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { loadOrAirdropPayer } from '../_shared/util';

// ============================================================================
// CONFIGURATION
// ============================================================================

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

const recipient = Keypair.generate().publicKey;

// Hard per-transaction compute-unit ceiling enforced by the runtime.
const MAX_CU_LIMIT = 1_400_000;

// ============================================================================
// STEP 1 — Estimate compute units via simulation
// ============================================================================

/**
 * Simulate the transaction to learn how many compute units it actually
 * consumes, then add ~10% headroom.
 *
 * IMPORTANT: we prepend a temporary HIGH limit (the 1,400,000 max) to the
 * simulated message. Without an explicit limit the runtime budgets the
 * simulation at the 200,000-per-instruction default, so a complex transaction
 * that genuinely needs more will hit that cap mid-simulation and report a
 * truncated `unitsConsumed` (or fail outright) — giving an estimate that is too
 * low. Simulating under the max ceiling lets the tx report its TRUE usage.
 *
 * `replaceRecentBlockhash` lets the RPC swap in a valid blockhash so we don't
 * need a fresh one just to simulate. `sigVerify: false` skips signing.
 */
async function estimateComputeUnits(
  instructions: TransactionInstruction[],
  payerKey: PublicKey,
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();

  // Prepend a max CU limit so simulation reports true consumption.
  const simInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU_LIMIT }),
    ...instructions,
  ];

  const simMessage = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: simInstructions,
  }).compileToV0Message();

  const simTx = new VersionedTransaction(simMessage);

  const sim = await connection.simulateTransaction(simTx, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });

  if (sim.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }

  const unitsConsumed = sim.value.unitsConsumed ?? 200_000;
  // Add 10% headroom; enforce a small floor so trivial txs never request 0.
  const withHeadroom = Math.max(1_000, Math.ceil(unitsConsumed * 1.1));

  // Clamp to the per-transaction max. If we're already brushing the ceiling,
  // the work cannot fit in one transaction — fail loudly instead of silently
  // requesting an impossible budget.
  if (withHeadroom > MAX_CU_LIMIT) {
    throw new Error(
      `Estimated compute units (${withHeadroom}) exceed the ${MAX_CU_LIMIT} ` +
        'per-transaction maximum — split the work across multiple transactions.',
    );
  }
  return withHeadroom;
}

// ============================================================================
// STEP 2 — Fetch a priority fee from the network
// ============================================================================

/**
 * Reads recent prioritization fees for the writable accounts this transaction
 * touches and returns a microLamports-per-CU price. We use a high percentile
 * so the transaction is competitive without overpaying for the worst outlier.
 *
 * Pass the fee PAYER plus every writable account: the payer is always writable
 * (its lamports are debited), and the fee market is per-writable-account, so
 * omitting it underestimates contention on the account you contend on most.
 *
 * For a managed estimate, swap this out for Helius `getPriorityFeeEstimate`.
 *
 * NOTE: on devnet these fees are noisy and frequently 0 — they are NOT
 * predictive of mainnet. Use devnet for mechanics; use a provider estimate
 * (Helius) or live mainnet data to set a real fee policy.
 */
async function getPriorityFeeMicroLamports(
  writableAccounts: PublicKey[],
): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: writableAccounts,
  });

  if (fees.length === 0) return 10_000; // sane fallback

  const sorted = fees
    .map((f) => f.prioritizationFee)
    .sort((a, b) => a - b);

  // 75th percentile of observed fees.
  const idx = Math.floor(sorted.length * 0.75);
  const fee = sorted[Math.min(idx, sorted.length - 1)];

  // Never go to zero — a 0 price gives the transaction no priority at all.
  return Math.max(1, fee);
}

// ============================================================================
// STEP 3 — Reliable send + confirm with blockhash-expiry polling
// ============================================================================

/**
 * Sends a raw transaction and polls signature status until it confirms OR the
 * blockhash expires. A blockhash is valid only until the chain passes
 * `lastValidBlockHeight`; once it does, the transaction can never land, so we
 * stop polling instead of hanging forever.
 */
async function sendAndConfirm(
  tx: VersionedTransaction,
  lastValidBlockHeight: number,
): Promise<string> {
  const raw = tx.serialize();

  // skipPreflight: we already simulated above, so skip the redundant check.
  // maxRetries: 0 lets us own the rebroadcast loop below.
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: true,
    maxRetries: 0,
  });

  while (true) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }

    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return signature;
    }

    // Has the blockhash expired? If the chain has moved past lastValidBlockHeight
    // the transaction is permanently dead — give up.
    const blockHeight = await connection.getBlockHeight();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error('Blockhash expired before confirmation (block height exceeded)');
    }

    // Re-broadcast and wait before polling again. A resend can throw transient
    // errors ("already processed", blockhash complaints) once the tx is in
    // flight — swallow them and keep polling status; the signature is what we
    // confirm against, not the resend result.
    try {
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (err) {
      console.warn('Rebroadcast failed (continuing to poll):', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  // Load a funded wallet from SOLANA_KEYPAIR, or airdrop a devnet keypair.
  const payer = await loadOrAirdropPayer(connection);
  console.log('Payer:', payer.publicKey.toBase58());

  // The core instruction(s) we want to run.
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: LAMPORTS_PER_SOL / 100, // 0.01 SOL
  });

  // 1. Estimate CUs from a limit-less simulation.
  const computeUnits = await estimateComputeUnits([transferIx], payer.publicKey);
  console.log('Estimated compute units:', computeUnits);

  // 2. Fetch a priority fee for the accounts this tx writes to.
  const microLamports = await getPriorityFeeMicroLamports([
    payer.publicKey,
    recipient,
  ]);
  console.log('Priority fee (microLamports/CU):', microLamports);

  // Priority fee paid (lamports) ~= (CU limit * microLamports) / 1e6
  const priorityFeeLamports = (computeUnits * microLamports) / 1e6;
  console.log('Approx priority fee (lamports):', priorityFeeLamports);

  // 3. Build the final instruction list — compute-budget ixs FIRST.
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    transferIx,
  ];

  // 4. Compile a v0 (versioned) transaction.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  // 5. Send and confirm with expiry awareness.
  const signature = await sendAndConfirm(tx, lastValidBlockHeight);
  console.log('Confirmed:', signature);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
