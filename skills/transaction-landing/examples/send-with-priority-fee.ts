/**
 * send-with-priority-fee.ts — the minimal end-to-end "land it" pipeline.
 *
 * Demonstrates SKILL.md checklist steps 1–6 + "Estimating the price":
 *   1. Build a real SOL transfer.
 *   2. Simulate the tx to SIZE the compute-unit (CU) limit (unitsConsumed × 1.1).
 *   3. Fetch a LIVE priority-fee estimate (µLamports/CU) — Helius getPriorityFeeEstimate
 *      if HELIUS_API_KEY is set, else native getRecentPrioritizationFees (p75).
 *   4. Set BOTH ComputeBudget instructions (limit + price).
 *   5. Fetch a fresh blockhash + lastValidBlockHeight, sign once.
 *   6. Send with skipPreflight:true + maxRetries:0, confirm against lastValidBlockHeight.
 *
 * For a production-grade send with a manual rebroadcast loop on top of this, see
 * examples/robust-send-and-confirm.ts and templates/robust-sender.ts.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+ (global fetch). Run: npx tsx examples/send-with-priority-fee.ts
 *
 * Env:
 *   RPC_URL         RPC endpoint (default: devnet). Use a mainnet URL for real sends.
 *   KEYPAIR_PATH    path to a funded keypair JSON (default: ~/.config/solana/id.json).
 *   RECIPIENT       base58 pubkey to send to (default: self-transfer back to payer).
 *   HELIUS_API_KEY  optional — enables Helius getPriorityFeeEstimate (mainnet only).
 *
 * Devnet vs mainnet: priority fees exist on every cluster, but contention (and therefore the
 * RIGHT price) only matters on mainnet. getPriorityFeeEstimate is a Helius mainnet method —
 * on devnet the native getRecentPrioritizationFees fallback is used. Always size CU from
 * simulation regardless of cluster.
 *
 * Kit (@solana/kit 7.0.0) equivalents are noted inline as `// kit:` comments.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 32-byte all-zero blockhash ("111…1"). Valid base58 placeholder; the RPC swaps in a real
// blockhash when simulating with replaceRecentBlockhash:true, so we avoid a pre-fetch here.
const SIM_PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();
const MAX_CU = 1_400_000; // MAX_COMPUTE_UNIT_LIMIT (Anza agave execution_budget.rs)

function loadKeypair(): Keypair {
  const path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/**
 * Size the CU limit from a simulation. Build the tx with a placeholder max limit + a
 * representative price ix so the simulator sees a realistic tx, read value.unitsConsumed,
 * then add ~10% headroom (consumption varies slightly with account state).
 *
 * kit: estimateComputeUnitLimitFactory({ rpc }) does the same simulate-and-estimate round-trip;
 *      then append getSetComputeUnitLimitInstruction({ units }). (In @solana/kit 7.0.0 this factory
 *      is @deprecated in favor of estimateResourceLimitsFactory({ rpc }).)
 */
async function sizeComputeUnits(
  connection: Connection,
  payer: PublicKey,
  workIxs: TransactionInstruction[],
): Promise<{ units: number; sizingTx: VersionedTransaction }> {
  const sizingTx = buildV0(payer, SIM_PLACEHOLDER_BLOCKHASH, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }), // placeholder: don't cap the sim
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ...workIxs,
  ]);

  const sim = await connection.simulateTransaction(sizingTx, {
    replaceRecentBlockhash: true, // RPC supplies a valid blockhash for the simulation only
    sigVerify: false, // the tx is unsigned during sizing — don't verify signatures
  });
  if (sim.value.err) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)} logs=${sim.value.logs?.join("\n")}`);
  }
  const consumed = sim.value.unitsConsumed ?? 200_000; // fall back to the per-ix default
  const units = Math.min(MAX_CU, Math.ceil(consumed * 1.1));
  return { units, sizingTx };
}

/**
 * Live price estimate in micro-lamports per CU. Prefers Helius getPriorityFeeEstimate
 * (pass the serialized tx so the estimate reflects YOUR exact write-locks); otherwise
 * aggregates native getRecentPrioritizationFees to a p75 over the write-locked accounts.
 */
async function estimatePriceMicroLamports(
  connection: Connection,
  sizingTx: VersionedTransaction,
  writableAccounts: PublicKey[],
): Promise<number> {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) {
    const body = {
      jsonrpc: "2.0",
      id: "1",
      method: "getPriorityFeeEstimate",
      params: [
        {
          transaction: Buffer.from(sizingTx.serialize()).toString("base64"),
          options: { transactionEncoding: "Base64", priorityLevel: "High" }, // High ≈ p75
        },
      ],
    };
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { result?: { priorityFeeEstimate?: number } };
    if (json.result?.priorityFeeEstimate != null) return Math.max(Math.ceil(json.result.priorityFeeEstimate), 1);
  }

  // Native fallback: raw per-slot samples over ~150 slots; the RPC does NO aggregation.
  // kit: rpc.getRecentPrioritizationFees(addresses).send()
  const fees = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts });
  const samples = fees
    .map((f) => f.prioritizationFee)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const p75 = samples[Math.floor(samples.length * 0.75)] ?? 0;
  return Math.max(p75, 1); // never 0 if you actually want priority
}

function buildV0(payer: PublicKey, recentBlockhash: string, instructions: TransactionInstruction[]): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions }).compileToV0Message();
  // kit: pipe(createTransactionMessage({version:0}), m => setTransactionMessageFeePayer(payer, m),
  //            m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  //            m => appendTransactionMessageInstructions(ixs, m))
  return new VersionedTransaction(msg);
}

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const payer = loadKeypair();
  const recipient = process.env.RECIPIENT ? new PublicKey(process.env.RECIPIENT) : payer.publicKey;

  // 1. The work instruction(s): a 0.001 SOL transfer. Both accounts are write-locked.
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 1_000_000,
  });
  const writableAccounts = [payer.publicKey, recipient];

  // 2. Size the CU limit from simulation.
  const { units, sizingTx } = await sizeComputeUnits(connection, payer.publicKey, [transferIx]);

  // 3. Estimate the price (µLamports/CU) — pass the sized tx for an accurate, contention-aware bid.
  const microLamports = await estimatePriceMicroLamports(connection, sizingTx, writableAccounts);

  // 4. Set BOTH ComputeBudget instructions. Convention: budget ixs first (placement is not
  //    load-bearing for correctness — the runtime parses them at any index).
  const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units });
  const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

  const priorityLamports = Math.ceil((microLamports * units) / 1_000_000); // canonical fee math
  console.log(
    `CU limit ${units}, price ${microLamports} µLamports/CU → priority fee ${priorityLamports} lamports ` +
      `(+5000 base/signature) ≈ ${((priorityLamports + 5000) / 1e9).toFixed(9)} SOL total`,
  );

  // 5. Fresh blockhash + lastValidBlockHeight (your hard expiry), then sign once.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = buildV0(payer.publicKey, blockhash, [cuLimitIx, cuPriceIx, transferIx]);
  tx.sign([payer]); // kit: signTransactionMessageWithSigners(msg)

  // 6. Send with skipPreflight + maxRetries:0 (you own retransmission), confirm vs expiry.
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  console.log(`submitted ${signature} — confirming against lastValidBlockHeight ${lastValidBlockHeight}`);

  // Blockhash-aware confirm: resolves on success OR when block height passes
  // lastValidBlockHeight (→ expired), so it never hangs forever. (This single confirm does
  // not rebroadcast; for the manual-rebroadcast loop see robust-send-and-confirm.ts.)
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) throw new Error(`tx failed on-chain: ${JSON.stringify(result.value.err)}`);
  console.log(`confirmed ✓ https://solscan.io/tx/${signature}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
