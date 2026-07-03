/**
 * robust-send-and-confirm.ts — the canonical production send loop.
 *
 * This is the full implementation of SKILL.md checklist steps 4–7: the manual rebroadcast
 * loop with blockhash-expiry handling and bounded blockhash-refresh retries, with an
 * optional (escalating) priority fee. templates/robust-sender.ts generalizes this into a
 * reusable class; this file keeps it as one readable, self-contained reference.
 *
 * Per attempt:
 *   - simulate to SIZE the CU limit (unitsConsumed × 1.1)
 *   - set BOTH ComputeBudget ixs (limit + an escalating price)
 *   - fetch a fresh blockhash + lastValidBlockHeight (the hard expiry)
 *   - sign ONCE, serialize the bytes
 *   - send (skipPreflight:true, maxRetries:0) then re-send the SAME bytes every ~2 s
 *   - drive SUCCESS by getSignatureStatuses, EXPIRY by getBlockHeight > lastValidBlockHeight
 *   - on expiry: rebuild from a fresh blockhash with a bumped fee (bounded attempts)
 *
 * Why this shape: re-sending identical signed bytes is idempotent (same signature; the
 * network dedups), so the only real failure modes are "confirmed", "on-chain error", or
 * "expired" — and expiry is recoverable by rebuilding. A returned signature means "submitted",
 * never "confirmed".
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+. Run: npx tsx examples/robust-send-and-confirm.ts
 *
 * Env: RPC_URL (default devnet), KEYPAIR_PATH (default ~/.config/solana/id.json),
 *      RECIPIENT (default self-transfer). Use a mainnet RPC_URL to exercise real contention.
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

const MAX_CU = 1_400_000;
const SIM_PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();

interface SendOptions {
  /** Max blockhash-refresh attempts before giving up. Each attempt bumps the fee. */
  maxAttempts?: number;
  /** Rebroadcast / status-poll interval in ms. */
  pollIntervalMs?: number;
  /** Target commitment for "landed". */
  commitment?: "processed" | "confirmed" | "finalized";
  /** Writable accounts to scope the native fee estimate to (contention lives here). */
  writableAccounts?: PublicKey[];
}

function loadKeypair(): Keypair {
  const path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function compileV0(payer: PublicKey, blockhash: string, ixs: TransactionInstruction[]): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg);
}

/** Simulate with a placeholder limit + price to read unitsConsumed, then add 10% headroom. */
async function sizeComputeUnits(connection: Connection, payer: PublicKey, workIxs: TransactionInstruction[]): Promise<number> {
  const sim = await connection.simulateTransaction(
    compileV0(payer, SIM_PLACEHOLDER_BLOCKHASH, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      ...workIxs,
    ]),
    { replaceRecentBlockhash: true, sigVerify: false },
  );
  if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
  return Math.min(MAX_CU, Math.ceil((sim.value.unitsConsumed ?? 200_000) * 1.1));
}

/** Native p75 over the write-locked accounts. Swap for Helius getPriorityFeeEstimate in prod. */
async function estimatePriceMicroLamports(connection: Connection, writableAccounts: PublicKey[]): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts });
  const samples = fees.map((f) => f.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
  return Math.max(samples[Math.floor(samples.length * 0.75)] ?? 0, 1);
}

/**
 * Send the work instructions and confirm them, rebuilding from a fresh blockhash on expiry.
 * Returns the confirmed signature, or throws after maxAttempts.
 */
async function sendAndConfirm(
  connection: Connection,
  payer: Keypair,
  workIxs: TransactionInstruction[],
  opts: SendOptions = {},
): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const commitment = opts.commitment ?? "confirmed";
  const writableAccounts = opts.writableAccounts ?? [payer.publicKey];

  const units = await sizeComputeUnits(connection, payer.publicKey, workIxs);
  const basePrice = await estimatePriceMicroLamports(connection, writableAccounts);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Escalate the price on each refresh so a re-bid beats the rising market (1x, 1.5x, 2.25x…).
    const microLamports = Math.ceil(basePrice * Math.pow(1.5, attempt - 1));
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...workIxs,
    ];

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
    const tx = compileV0(payer.publicKey, blockhash, ixs);
    tx.sign([payer]);
    const raw = tx.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    console.log(`attempt ${attempt}/${maxAttempts}: ${signature} (price ${microLamports} µLamports/CU, CU ${units})`);

    // Rebroadcast the SAME bytes until confirmed or the blockhash expires.
    while (true) {
      const { value } = await connection.getSignatureStatuses([signature]);
      const s = value[0];
      if (s?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(s.err)}`); // a real revert — do NOT retry blindly
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        console.log(`confirmed ✓ ${signature}`);
        return signature;
      }
      if ((await connection.getBlockHeight(commitment)) > lastValidBlockHeight) {
        console.log(`  blockhash expired — rebuilding with a fresh one`);
        break; // exit inner loop → next attempt rebuilds from a fresh blockhash
      }
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); // re-send identical bytes
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
  throw new Error(`transaction did not confirm within ${maxAttempts} blockhash windows — congestion too high; escalate to Jito/Sender`);
}

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const payer = loadKeypair();
  const recipient = process.env.RECIPIENT ? new PublicKey(process.env.RECIPIENT) : payer.publicKey;

  const transferIx = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 1_000_000 });

  const sig = await sendAndConfirm(connection, payer, [transferIx], {
    writableAccounts: [payer.publicKey, recipient],
    maxAttempts: 4,
    commitment: "confirmed",
  });
  console.log(`done: https://solscan.io/tx/${sig}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
