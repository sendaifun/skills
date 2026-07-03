/**
 * compose-instructions.ts — build ONE atomic v0 transaction from several instructions.
 *
 * A single Solana transaction executes its instructions IN ORDER and ALL-OR-NOTHING: if any
 * instruction fails, the whole transaction reverts and NO state changes land. This example
 * composes four programs into one atomic unit and measures the result against the 1232-byte cap:
 *
 *   1. ComputeBudget.setComputeUnitLimit  — cap CU for the whole tx (illustrative value; SIZE it
 *      from simulation in production — see the transaction-landing skill).
 *   2. ComputeBudget.setComputeUnitPrice  — priority fee bid (µLamports/CU).
 *   3. createAssociatedTokenAccountIdempotentInstruction — ensure the RECIPIENT's ATA exists
 *      (idempotent: no pre-flight "does it exist?" RPC, and it won't abort the tx if a race
 *      created it first). The payer funds the new account.
 *   4. transferChecked — move `amount` of the token from the payer's ATA into the recipient's ATA.
 *      Depends on (3): the destination must exist before the transfer runs.
 *   5. memo — attach a human-readable note (raw SPL Memo instruction, no accounts required).
 *
 * ATOMICITY, concretely: if the payer holds no balance, step (4) fails — and because the whole
 * transaction reverts, the ATA created in step (3) is ALSO rolled back. You never end up with a
 * created-but-empty account. Either all five instructions apply or none do.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   @solana/spl-token 0.4.14
 *   npm i @solana/web3.js@1.98.4 @solana/spl-token@0.4.14
 *   npm i -D typescript tsx @types/node          # Node 20+
 *   npx tsx examples/compose-instructions.ts
 *
 * Env:
 *   RPC_URL       RPC endpoint (default: devnet).
 *   KEYPAIR_PATH  funded keypair JSON that HOLDS the token (default: ~/.config/solana/id.json).
 *   MINT          base58 mint address to transfer (required — SPL Token or Token-2022).
 *   RECIPIENT     base58 destination owner (default: a fresh random pubkey, so the ATA-create is real).
 *   AMOUNT        base units to transfer (default: 1).
 *
 * Works on any cluster (devnet recommended). The token program (classic vs Token-2022) is detected
 * from the mint account owner, so this composes correctly for either — see the `token-2022` skill.
 *
 * Kit (@solana/kit 7.0.0) note: build the same list with pipe(createTransactionMessage({version:0}),
 * …, appendTransactionMessageInstructions([cuLimit, cuPrice, ata, transfer, memo], m)); size-check
 * with isTransactionWithinSizeLimit(tx). Full kit pipeline: examples/kit-build.ts.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PACKET_DATA_SIZE, // === 1232
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token"; // 0.4.14
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// SPL Memo program — a plain instruction with UTF-8 data and (optionally) signer accounts.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function loadKeypair(): Keypair {
  const path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`set ${name} (base58) — e.g. ${name}=<pubkey> npx tsx examples/compose-instructions.ts`);
  return v;
}

/** Detect whether a mint is owned by classic SPL Token or Token-2022 (matters for every ix below). */
async function resolveTokenProgram(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`mint ${mint.toBase58()} not found on this cluster`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`mint owner ${info.owner.toBase58()} is neither Token nor Token-2022`);
}

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const payer = loadKeypair();
  const mint = new PublicKey(requireEnv("MINT"));
  const recipient = process.env.RECIPIENT ? new PublicKey(process.env.RECIPIENT) : Keypair.generate().publicKey;
  const amount = BigInt(process.env.AMOUNT ?? "1");

  // Resolve the owning token program, then read decimals (transferChecked verifies decimals).
  const tokenProgram = await resolveTokenProgram(connection, mint);
  const { decimals } = await getMint(connection, mint, "confirmed", tokenProgram);

  // ATAs are deterministic PDAs of [owner, tokenProgram, mint] — derive, don't fetch.
  const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, tokenProgram);
  const destAta = getAssociatedTokenAddressSync(mint, recipient, false, tokenProgram);

  // ── Compose the instructions (order matters where step N depends on step N-1) ──────────────
  const instructions: TransactionInstruction[] = [
    // (1) + (2) ComputeBudget. Placement is NOT load-bearing (the runtime parses them at any
    //     index); convention puts them first. The 60k limit is ILLUSTRATIVE — size the real
    //     value from simulation. Pricing / CU estimation / fee math live in the transaction-landing
    //     skill (docs/priority-fees.md); this skill only shows WHERE these instructions go.
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),

    // (3) Idempotent ATA creation for the recipient — safe whether or not it already exists.
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, // funder / fee payer
      destAta, // derived associated token address
      recipient, // token account owner
      mint,
      tokenProgram,
    ),

    // (4) transferChecked (never plain `transfer`) — verifies mint + decimals on-chain.
    //     For Token-2022 mints with a transfer fee or transfer hook, use the corresponding
    //     helper instead (createTransferCheckedWithFeeInstruction / …WithTransferHookInstruction —
    //     see the token-2022 skill). A plain mint uses transferChecked as below.
    createTransferCheckedInstruction(
      sourceAta, // source ATA (payer must hold `amount`)
      mint,
      destAta, // destination ATA (created idempotently in step 3)
      payer.publicKey, // source owner / authority
      amount,
      decimals,
      [], // multisig signers (none)
      tokenProgram,
    ),

    // (5) memo — a plain instruction; empty `keys` = an unsigned memo.
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(`sent ${amount} to ${recipient.toBase58()}`, "utf8"),
    }),
  ];

  // ── Compile to v0 and MEASURE before committing to sign/send ────────────────────────────────
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey, // fee payer → forced to account index 0
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(/* pass [lookupTableAccount] here to compress accounts under 1232 */);
  const vtx = new VersionedTransaction(messageV0);

  // CRITICAL: VersionedTransaction.serialize() does NOT throw on oversize (2048-byte scratch
  // buffer). You MUST measure yourself — signatures are already reserved as zero-filled slots,
  // so the byte count is identical before and after signing.
  const size = vtx.serialize().length;
  const keys = messageV0.staticAccountKeys.length;
  console.log(
    `composed ${instructions.length} instructions across ${keys} accounts → ${size} / ${PACKET_DATA_SIZE} bytes`,
  );
  if (size > PACKET_DATA_SIZE) {
    throw new Error(`too big: ${size} > ${PACKET_DATA_SIZE} — move non-signer accounts into an ALT or split the tx`);
  }

  // ── Sign (array!) and send the atomic unit ─────────────────────────────────────────────────
  vtx.sign([payer]); // v0 sign takes an ARRAY; connection.sendTransaction(vtx) has NO signers arg
  const sig = await connection.sendTransaction(vtx);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`atomic tx landed (ATA create + transfer + memo, all-or-nothing): ${sig}`);
  console.log(`recipient ATA: ${destAta.toBase58()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
