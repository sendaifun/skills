/**
 * durable-nonce.ts — sign a transaction that NEVER expires.
 *
 * A durable nonce replaces the ~150-slot recent blockhash with a stored, non-expiring value,
 * so a signed tx stays valid until the nonce advances. Use it for offline signing, cold-wallet
 * / multisig flows, and scheduled/queued txns where minutes-to-days pass between sign and send.
 *
 * Demonstrates SKILL.md "Durable nonce":
 *   Phase 1 — create + fund a rent-exempt nonce account (one-time).
 *   Phase 2 — read the current nonce value, build a tx whose FIRST instruction is nonceAdvance
 *             and whose recentBlockhash IS the stored nonce, sign (here; or hand off offline),
 *             and submit.
 *
 * Replay-once: executing nonceAdvance consumes and rotates the stored nonce, so the signed tx
 * is valid exactly once. If nonceAdvance is NOT the first instruction (or is absent), the tx is
 * rejected or becomes replayable — this ordering is mandatory, not stylistic.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+. Run: npx tsx examples/durable-nonce.ts
 *
 * Env: RPC_URL (default devnet), KEYPAIR_PATH (default ~/.config/solana/id.json),
 *      NONCE_KEYPAIR_PATH (optional — reuse an existing nonce account instead of creating one),
 *      RECIPIENT (default self-transfer).
 *
 * Works on any cluster (devnet recommended for trying it out).
 */

import {
  Connection,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js"; // 1.98.4
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadKeypair(envVar: string, fallback?: string): Keypair {
  const path = process.env[envVar] ?? fallback;
  if (!path) throw new Error(`set ${envVar}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/** Phase 1: create + fund the nonce account. createNonceAccount bundles createAccount(size =
 *  NONCE_ACCOUNT_LENGTH, owner = System) + initializeNonce in one convenience instruction. */
async function createNonceAccount(connection: Connection, payer: Keypair, nonceKeypair: Keypair): Promise<void> {
  const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  const tx = new Transaction().add(
    SystemProgram.createNonceAccount({
      fromPubkey: payer.publicKey,
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: payer.publicKey, // the nonce authority: who may advance / withdraw
      lamports: rent,
    }),
  );
  // The new nonce account must sign its own creation, alongside the funding payer.
  const sig = await sendAndConfirmTransaction(connection, tx, [payer, nonceKeypair]);
  console.log(`nonce account ${nonceKeypair.publicKey.toBase58()} created: ${sig}`);
  // kit split: getCreateAccountInstruction(...) + getInitializeNonceAccountInstruction({ nonceAccount, nonceAuthority }).
}

/** Read the live nonce value (a blockhash-like base58 string) from on-chain account data. */
async function readNonce(connection: Connection, noncePubkey: PublicKey): Promise<{ nonce: string; authority: PublicKey }> {
  const info = await connection.getAccountInfo(noncePubkey);
  if (!info) throw new Error(`nonce account ${noncePubkey.toBase58()} not found`);
  const acc = NonceAccount.fromAccountData(info.data);
  return { nonce: acc.nonce, authority: acc.authorizedPubkey };
}

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const payer = loadKeypair("KEYPAIR_PATH", join(homedir(), ".config", "solana", "id.json"));
  const recipient = process.env.RECIPIENT ? new PublicKey(process.env.RECIPIENT) : payer.publicKey;

  // Reuse an existing nonce account if provided, else create a fresh one (Phase 1).
  let nonceKeypair: Keypair;
  if (process.env.NONCE_KEYPAIR_PATH) {
    nonceKeypair = loadKeypair("NONCE_KEYPAIR_PATH");
  } else {
    nonceKeypair = Keypair.generate();
    await createNonceAccount(connection, payer, nonceKeypair);
  }

  // Phase 2: read the current nonce value.
  const { nonce, authority } = await readNonce(connection, nonceKeypair.publicKey);
  console.log(`current nonce value: ${nonce} (authority ${authority.toBase58()})`);

  // Build the durable tx. nonceAdvance MUST be the FIRST instruction; recentBlockhash is the
  // stored nonce — NOT getLatestBlockhash. This tx will not expire until the nonce advances.
  const tx = new Transaction();
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: payer.publicKey, // must be the nonce authority
    }),
    // ...your real instructions:
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 1_000_000 }),
  );
  tx.recentBlockhash = nonce; // the durable nonce, NOT a recent blockhash
  tx.feePayer = payer.publicKey;

  // Sign now (or serialize with tx.serialize({ requireAllSignatures:false }) and hand off to an
  // offline signer / multisig — the signature stays valid because the nonce does not expire).
  tx.sign(payer);
  // kit: setTransactionMessageLifetimeUsingDurableNonce({ nonce, nonceAccountAddress, nonceAuthorityAddress })
  //      sets the message lifetime to the nonce (verify the helper name against @solana/kit@7.0.0).

  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
  // The tx itself never expires; this fresh blockhash/lastValidBlockHeight is only a confirmation
  // TIMEOUT so the await cannot hang forever — it is unrelated to the durable tx's validity.
  await connection.confirmTransaction({ signature, ...(await connection.getLatestBlockhash("confirmed")) }, "confirmed");
  console.log(`durable-nonce tx confirmed ✓ ${signature}`);

  // The same nonce value cannot be reused: it has now rotated. Re-read readNonce() before the
  // next durable tx.
  const after = await readNonce(connection, nonceKeypair.publicKey);
  console.log(`nonce advanced: ${nonce} → ${after.nonce} (old value is now dead)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
