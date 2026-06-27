/**
 * send-and-confirm.ts — complete, runnable reference for reliably landing a
 * Solana transaction with @solana/web3.js v1.x.
 *
 * Implements all five decisions from SKILL.md:
 *   1. right-size compute units (simulate)
 *   2. price the priority fee (getRecentPrioritizationFees, percentile + buffer)
 *   3. choose a lifetime (recent blockhash + lastValidBlockHeight)
 *   4. submit + rebroadcast the SAME signed bytes
 *   5. confirm against signature status, stop at blockhash expiry
 *
 * Plus the agentic safe-retry wrapper that verifies on-chain state before
 * rebuilding, so an interrupted run never double-executes.
 *
 *   npm install @solana/web3.js bs58
 *   RPC_URL=https://api.devnet.solana.com ts-node send-and-confirm.ts
 */

import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';

// ---------------------------------------------------------------------------
// 1. Right-size compute units
// ---------------------------------------------------------------------------
async function estimateComputeUnits(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const probe = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ...instructions,
      ],
    }).compileToV0Message(),
  );
  probe.sign([payer]);

  const sim = await connection.simulateTransaction(probe, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });
  if (sim.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(sim.value.err)}\n${sim.value.logs?.join('\n')}`,
    );
  }
  const used = sim.value.unitsConsumed ?? 200_000;
  return Math.min(1_400_000, Math.max(1_000, Math.ceil(used * 1.1)));
}

// ---------------------------------------------------------------------------
// 2. Price the priority fee (provider-agnostic baseline)
// ---------------------------------------------------------------------------
async function estimatePriorityFee(
  connection: Connection,
  writableAccounts: PublicKey[],
  percentile = 0.75,
): Promise<number> {
  const recent = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: writableAccounts,
  });
  const fees = recent
    .map((r) => r.prioritizationFee)
    .filter((f) => f > 0)
    .sort((a, b) => a - b);
  if (fees.length === 0) return 10_000;
  const pick = fees[Math.min(fees.length - 1, Math.floor(fees.length * percentile))];
  return Math.ceil(pick * 1.2);
}

// ---------------------------------------------------------------------------
// 3 + build. Assemble a signed, ready-to-broadcast transaction
// ---------------------------------------------------------------------------
interface Built {
  raw: Uint8Array;
  signature: string;
  lastValidBlockHeight: number;
}

async function buildTransaction(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  writableAccounts: PublicKey[],
): Promise<Built> {
  const computeUnits = await estimateComputeUnits(connection, payer, instructions);
  const microLamports = await estimatePriorityFee(connection, writableAccounts);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...instructions,
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]); // sign ONCE — these exact bytes get rebroadcast

  return {
    raw: tx.serialize(),
    signature: bs58.encode(tx.signatures[0]),
    lastValidBlockHeight,
  };
}

// ---------------------------------------------------------------------------
// 4 + 5. Submit, rebroadcast the same bytes, confirm, stop at expiry
// ---------------------------------------------------------------------------
class BlockhashExpiredError extends Error {
  constructor(public signature: string) {
    super(`Blockhash expired before confirmation: ${signature}`);
  }
}

async function sendAndConfirm(
  connection: Connection,
  built: Built,
  { pollMs = 2_000, timeoutMs = 90_000 } = {},
): Promise<string> {
  const { raw, signature, lastValidBlockHeight } = built;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (e: any) {
      if (/already.*processed/i.test(e.message)) return signature; // landed
      // otherwise let status polling decide
    }

    const { value } = await connection.getSignatureStatuses([signature]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
        return signature;
      }
    }

    const height = await connection.getBlockHeight('confirmed');
    if (height > lastValidBlockHeight) throw new BlockhashExpiredError(signature);

    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Confirmation timed out (still unexpired): ${signature}`);
}

// ---------------------------------------------------------------------------
// Agentic safe-retry: verify on-chain state before rebuilding (never double-spend)
// ---------------------------------------------------------------------------
async function landWithSafeRetry(
  connection: Connection,
  build: () => Promise<Built>,
  maxRebuilds = 3,
): Promise<string> {
  for (let attempt = 0; attempt < maxRebuilds; attempt++) {
    const built = await build();
    try {
      return await sendAndConfirm(connection, built);
    } catch (e) {
      if (!(e instanceof BlockhashExpiredError)) throw e; // real on-chain failure: don't retry

      // EXPIRED is ambiguous — the prior tx might have landed in a race. Verify.
      const { value } = await connection.getSignatureStatuses([e.signature], {
        searchTransactionHistory: true,
      });
      if (value[0] && !value[0].err) return e.signature; // it DID land — do not resend
      // confirmed not-landed → safe to rebuild with a fresh blockhash
    }
  }
  throw new Error('Exhausted safe rebuild attempts without landing');
}

// ---------------------------------------------------------------------------
// Demo: land a 0.001 SOL self-transfer on devnet
// ---------------------------------------------------------------------------
async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = process.env.SECRET_KEY
    ? Keypair.fromSecretKey(bs58.decode(process.env.SECRET_KEY))
    : Keypair.generate();

  if (!process.env.SECRET_KEY) {
    console.log('No SECRET_KEY set — airdropping 0.5 SOL on devnet for the demo...');
    const sig = await connection.requestAirdrop(payer.publicKey, 0.5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
  }

  const instructions = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey, // self-transfer for a harmless demo
      lamports: 0.001 * LAMPORTS_PER_SOL,
    }),
  ];
  const writableAccounts = [payer.publicKey];

  const signature = await landWithSafeRetry(connection, () =>
    buildTransaction(connection, payer, instructions, writableAccounts),
  );

  console.log(`Landed: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export {
  estimateComputeUnits,
  estimatePriorityFee,
  buildTransaction,
  sendAndConfirm,
  landWithSafeRetry,
  BlockhashExpiredError,
};
