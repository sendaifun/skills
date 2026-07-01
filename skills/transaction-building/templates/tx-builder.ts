/**
 * tx-builder.ts — a reusable v0-transaction construction helper (drop-in module).
 *
 * Construction-only utilities that encode this skill's non-obvious rules so you don't re-learn them
 * per project:
 *
 *   buildV0Message(connection, payerKey, instructions, lookupTables?)
 *       → fetches a fresh blockhash, compiles a v0 message (with optional ALTs), wraps it in an
 *         unsigned VersionedTransaction, and returns it alongside the confirmation context.
 *   measureSize(vtx)          → exact wire size in bytes (v0 serialize() does NOT throw on oversize).
 *   assertWithinLimit(vtx)    → throws a clear error if the tx exceeds the 1232-byte limit.
 *   signAndSend(connection, built, signers)
 *       → a CONVENIENCE that asserts size, signs, sends once, and does a single blockhash-aware
 *         confirm. It deliberately has NO retries / priority-fee logic — production LANDING (compute
 *         budget, fee estimation, rebroadcast, Jito) belongs to the transaction-landing skill
 *         (templates/robust-sender.ts). Use this to get a well-formed tx on the wire; use that to
 *         make it stick under congestion.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+. No secrets hardcoded — the caller supplies the connection, payer, and signers.
 *
 * Kit (@solana/kit 7.0.0) equivalent of buildV0Message:
 *   const message = pipe(
 *     createTransactionMessage({ version: 0 }),
 *     m => setTransactionMessageFeePayerSigner(feePayerSigner, m),
 *     m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m), // lastValidBlockHeight is a bigint
 *     m => appendTransactionMessageInstructions(instructions, m),
 *     // m => compressTransactionMessageUsingAddressLookupTables(m, addressesByLut),  // optional ALTs
 *   );
 *   const signed = await signTransactionMessageWithSigners(message);
 *   if (!isTransactionWithinSizeLimit(signed)) throw new Error("too big"); // kit's built-in size guard
 */

import {
  AddressLookupTableAccount,
  Commitment,
  Connection,
  PACKET_DATA_SIZE, // === 1232
  PublicKey,
  Signer,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js"; // 1.98.4

/** The output of buildV0Message: the unsigned tx plus everything needed to confirm it later. */
export interface BuiltV0 {
  /** The unsigned VersionedTransaction. Sign it, then send it (never pass signers to sendTransaction). */
  transaction: VersionedTransaction;
  /** The compiled v0 message (inspect staticAccountKeys / addressTableLookups here). */
  message: MessageV0;
  /** The blockhash used as the tx lifetime — needed for a blockhash-aware confirm. */
  blockhash: string;
  /** Hard expiry: once block height passes this, the tx can never land. */
  lastValidBlockHeight: number;
}

/**
 * Build (but do NOT sign) a v0 transaction from a list of instructions.
 *
 * @param connection    an RPC connection (its commitment is used to fetch the blockhash).
 * @param payerKey      the fee payer — forced to account index 0 (its signature is the tx id).
 * @param instructions  the ordered instruction list (all-or-nothing on execution).
 * @param lookupTables  optional ALTs; non-signer accounts they contain are compressed to 1-byte indices.
 *
 * The returned transaction is UNSIGNED. Signatures are already reserved as zero-filled 64-byte
 * slots, so measureSize() / assertWithinLimit() work correctly before signing.
 */
export async function buildV0Message(
  connection: Connection,
  payerKey: PublicKey,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<BuiltV0> {
  // TODO: for offline / long-lived signing, replace this blockhash lifetime with a durable nonce
  //       (first instruction must be SystemProgram.nonceAdvance) — see the transaction-landing skill.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables); // pass [] for a plain v0 tx; pass ALTs to compress accounts

  return { transaction: new VersionedTransaction(message), message, blockhash, lastValidBlockHeight };
}

/**
 * Exact serialized wire size in bytes.
 *
 * IMPORTANT: VersionedTransaction.serialize() allocates a 2048-byte scratch buffer and NEVER throws
 * on oversize (unlike legacy Transaction.serialize(), which asserts). Always measure yourself.
 */
export function measureSize(vtx: VersionedTransaction): number {
  return vtx.serialize().length;
}

/** Throw with a clear, actionable message if the transaction exceeds the 1232-byte packet limit. */
export function assertWithinLimit(vtx: VersionedTransaction): void {
  const size = measureSize(vtx);
  if (size > PACKET_DATA_SIZE) {
    throw new Error(
      `transaction is ${size} bytes > ${PACKET_DATA_SIZE} limit — ` +
        `move non-signer accounts into an Address Lookup Table, dedupe accounts, split the tx, ` +
        `or shorten instruction data`,
    );
  }
}

/**
 * CONVENIENCE: assert size, sign, send once, and confirm against the blockhash expiry.
 *
 * This is intentionally minimal — a single send with no rebroadcast, no compute-budget / priority
 * fee, no Jito. For production landing under congestion, use the transaction-landing skill's
 * RobustSender (templates/robust-sender.ts) instead of this helper.
 *
 * @param signers  every required signer (fee payer + any instruction signers). v0 sign() takes an
 *                 ARRAY. For partial / offline / multisig handoffs, sign incrementally and serialize
 *                 between parties instead of calling this — see examples/offline-signing.ts.
 * @returns the base58 transaction signature (= signatures[0], the fee payer's).
 */
export async function signAndSend(
  connection: Connection,
  built: BuiltV0,
  signers: Signer[],
  commitment: Commitment = "confirmed",
): Promise<string> {
  assertWithinLimit(built.transaction); // fail fast, locally, before touching the network
  built.transaction.sign(signers); // ARRAY; do NOT pass signers to sendTransaction for a v0 tx

  const signature = await connection.sendTransaction(built.transaction); // pre-signed → no signers arg
  const result = await connection.confirmTransaction(
    { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    commitment,
  );
  if (result.value.err) throw new Error(`tx failed on-chain: ${JSON.stringify(result.value.err)}`);
  return signature;
}

/* ---------------------------------------------------------------------------
 * Example usage (delete in your project):
 *
 *   import { Connection, Keypair, SystemProgram } from "@solana/web3.js";
 *   import { buildV0Message, measureSize, signAndSend } from "./tx-builder";
 *
 *   const connection = new Connection(process.env.RPC_URL!, "confirmed");
 *   const payer = Keypair.fromSecretKey(...);
 *
 *   const built = await buildV0Message(connection, payer.publicKey, [
 *     SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
 *   ]);
 *   console.log(`size: ${measureSize(built.transaction)} bytes`);
 *   const sig = await signAndSend(connection, built, [payer]);
 * --------------------------------------------------------------------------- */
