/**
 * build-v0-transaction.ts — build, MEASURE, sign, send, and confirm a v0 VersionedTransaction.
 *
 * Demonstrates SKILL.md "Build a v0 transaction" + "The 1232-byte limit":
 *   1. getLatestBlockhash → { blockhash, lastValidBlockHeight } (the tx lifetime).
 *   2. Compose two instructions — SystemProgram.transfer + a raw Memo instruction.
 *   3. new TransactionMessage({ payerKey, recentBlockhash, instructions }).compileToV0Message().
 *   4. Wrap in a VersionedTransaction and MEASURE serialize().length vs PACKET_DATA_SIZE.
 *      GOTCHA: v0 serialize() does NOT throw on > 1232 (2048-byte scratch buffer) — you must
 *      check yourself; only the RPC/leader rejects an oversized packet later. (Legacy
 *      Transaction.serialize() DOES assert and throws "Transaction too large".)
 *   5. vtx.sign([payer]) — the array form (legacy tx.sign(...) is variadic; vtx.sign([...]) is not).
 *   6. connection.sendTransaction(vtx) — NO signers arg on the versioned overload; pre-sign first.
 *   7. Confirm with the blockheight strategy ({ signature, blockhash, lastValidBlockHeight }).
 *
 * A commented "BEFORE (legacy)" block + the migration checklist at the bottom make this file
 * double as the legacy → v0 migration reference.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+. Run: npx tsx examples/build-v0-transaction.ts
 *
 * Env: RPC_URL (default devnet), KEYPAIR_PATH (default ~/.config/solana/id.json),
 *      RECIPIENT (base58 pubkey; default = a self-transfer).
 *
 * This skill is CONSTRUCTION. Priority fees, CU pricing, retries/rebroadcast, and robust
 * confirmation live in the `transaction-landing` skill.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  PACKET_DATA_SIZE, // === 1232
  clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Memo program (SPL Memo v2) — a signer-less instruction that just logs UTF-8 bytes.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? clusterApiUrl("devnet");
  const keypairPath = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = loadKeypair(keypairPath);
  const recipient = process.env.RECIPIENT ? new PublicKey(process.env.RECIPIENT) : payer.publicKey;

  // ── 1. Fresh blockhash + lastValidBlockHeight (the transaction's lifetime) ──────────────────
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  // ── 2. Compose a couple of instructions ─────────────────────────────────────────────────────
  // These TransactionInstruction[] are IDENTICAL whether you assemble a legacy or a v0 tx —
  // only the assembly around them changes (see the migration checklist below).
  const transferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 1_000, // 0.000001 SOL — a real transfer; recipient may be self
  });
  const memoIx = new TransactionInstruction({
    keys: [], // memo needs no accounts (optionally an array of signer pubkeys)
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from("gm — built with a v0 VersionedTransaction", "utf8"),
  });

  // ── 3. TransactionMessage → compileToV0Message() ────────────────────────────────────────────
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey, // fee payer → forced to account index 0 (= signature index 0 = tx id)
    recentBlockhash: blockhash,
    instructions: [transferIx, memoIx],
  }).compileToV0Message(/* pass [lookupTableAccount, ...] here to reference ALTs — see lookup-table.ts */);

  // ── 4. Wrap + MEASURE (v0 serialize() does NOT throw on oversize — check it yourself) ───────
  const vtx = new VersionedTransaction(messageV0);
  // Signature slots are already allocated (zero-filled) by the constructor, so the byte length is
  // identical before and after signing — measure now, before wasting a signature on an oversize tx.
  const size = vtx.serialize().length;
  console.log(`transaction size: ${size} / ${PACKET_DATA_SIZE} bytes`);
  if (size > PACKET_DATA_SIZE) {
    // v0 would have serialized "fine" and only failed at the RPC — so we guard explicitly.
    throw new Error(
      `transaction is ${size} bytes (> ${PACKET_DATA_SIZE}). Move non-signer accounts into an ` +
        `Address Lookup Table and compileToV0Message([alt]), split the tx, or trim instruction data.`,
    );
  }

  // ── 5. Sign — ARRAY arg (vtx.sign([...]) replaces all signatures; not variadic like legacy) ──
  vtx.sign([payer]);

  // ── 6. Send the ALREADY-SIGNED transaction — NO signers argument on the versioned overload ──
  const txid = await connection.sendTransaction(vtx, { maxRetries: 5 });
  console.log("sent:", txid);

  // ── 7. Confirm via lastValidBlockHeight (blockheight-based strategy) ────────────────────────
  const result = await connection.confirmTransaction(
    { signature: txid, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new Error(`tx failed: ${JSON.stringify(result.value.err)}`);
  console.log("confirmed:", `https://explorer.solana.com/tx/${txid}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────
 * MIGRATING A LEGACY Transaction → v0 (the instructions are identical; only assembly changes)
 *
 *   // BEFORE (legacy):
 *   import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
 *   const tx = new Transaction().add(transferIx, memoIx);   // .add(...) is VARIADIC + chainable
 *   tx.feePayer = payer.publicKey;
 *   tx.recentBlockhash = blockhash;
 *   tx.sign(payer);                                          // VARIADIC: tx.sign(a, b)
 *   const sig = await sendAndConfirmTransaction(connection, tx, [payer]); // legacy-only helper
 *
 * Checklist — the ONLY things that change going to v0:
 *   1. tx.feePayer               → TransactionMessage.payerKey
 *   2. tx.recentBlockhash        → TransactionMessage.recentBlockhash
 *   3. tx.add(a, b)              → instructions: [a, b]
 *   4. .compileToV0Message()     → wrap in new VersionedTransaction(msg)
 *   5. tx.sign(a, b) (variadic)  → vtx.sign([a, b]) (ARRAY)
 *   6. sendAndConfirmTransaction(conn, tx, [a])  → pre-sign, then sendTransaction(vtx) + confirmTransaction
 *      (sendAndConfirmTransaction is typed to a legacy Transaction — there is NO versioned overload)
 *   7. To use ALTs, pass [lookupTableAccount, ...] to compileToV0Message() (see lookup-table.ts)
 *
 * Legacy is fine for trivial one-off scripts or maximum wallet reach. Default app code to v0 —
 * it is a strict superset (a v0 tx with zero lookups == the legacy tx + a 1-byte prefix) and it
 * is the only format that can reference Address Lookup Tables.
 * ─────────────────────────────────────────────────────────────────────────────────────────────── */
