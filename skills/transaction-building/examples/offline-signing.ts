/**
 * offline-signing.ts — sponsor/relayer (fee payer ≠ user) + air-gapped signature injection.
 *
 * Signatures are POSITIONAL and INDEPENDENT: the runtime fixes the account order, forces the fee
 * payer to account index 0 (= signature index 0 = the transaction id), and `signatures[i]` maps to
 * `staticAccountKeys[i]`. Because every signer signs the IDENTICAL message bytes, parties can sign
 * in any order, at any time, on any machine — as long as nobody mutates the message (fee payer,
 * blockhash/nonce, instructions, account order) after the first signature. FREEZE the message first.
 *
 * This file shows two real handoffs on ONE v0 transaction shape (sponsor pays the fee; user
 * authorizes a transfer of their own funds):
 *
 *   A. Sponsor/relayer round-trip  — user signs their slot, serializes the partially-signed wire,
 *      hands it to the sponsor, who deserializes, signs slot 0, and submits. The sponsor pays.
 *   B. Air-gapped injection        — the fee payer signs live; the user's device computes the
 *      64-byte ed25519 signature OFFLINE and returns only those bytes, which are injected with
 *      addSignature (no user secret key in the submitting process).
 *
 * Multisig is the SAME pattern: mark every co-signer as an instruction signer and collect each
 * signature into its positional slot. Here there are two required signers (sponsor + user).
 *
 * Stack:
 *   @solana/web3.js  1.98.4     tweetnacl 1.0.x (the ed25519 lib web3.js itself uses internally)
 *   npm i @solana/web3.js@1.98.4 tweetnacl
 *   npm i -D typescript tsx @types/node          # Node 20+
 *   npx tsx examples/offline-signing.ts
 *
 * Env:
 *   RPC_URL       RPC endpoint (default: devnet).
 *   KEYPAIR_PATH  funded SPONSOR keypair JSON (pays fees + funds the demo; default ~/.config/solana/id.json).
 *   RECIPIENT     base58 destination for the user's transfer (default: the sponsor, i.e. user pays sponsor back).
 *
 * Devnet recommended (the sponsor keypair must hold a little SOL). The user keypair is generated and
 * funded from the sponsor so the demo is deterministic (no flaky airdrop).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js"; // 1.98.4
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TRANSFER_LAMPORTS = 1_000; // the user authorizes moving this many of their own lamports

function loadKeypair(): Keypair {
  const path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/** Deterministic setup: the funded sponsor gives the freshly-generated user a little SOL to spend. */
async function fundUser(connection: Connection, sponsor: Keypair, user: PublicKey, lamports: number): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: user, lamports }),
  );
  await sendAndConfirmTransaction(connection, tx, [sponsor]); // legacy sign(...) is variadic
}

/**
 * A. Sponsor/relayer round-trip. The sponsor is the fee payer (index 0); the user is an instruction
 * signer. The user signs first, offline; the sponsor completes and submits.
 */
async function sponsorRelayerRoundTrip(
  connection: Connection,
  sponsor: Keypair,
  user: Keypair,
  recipient: PublicKey,
): Promise<void> {
  // Build + FREEZE the message. payerKey = sponsor → sponsor is forced to account index 0.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: sponsor.publicKey, // fee payer (index 0) — the sponsor pays
    recentBlockhash: blockhash,
    instructions: [
      // The user moves THEIR OWN lamports → the user is a required (writable) signer.
      SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: recipient, lamports: TRANSFER_LAMPORTS }),
    ],
  }).compileToV0Message();

  // ── User's device (has the user key, NOT the sponsor key) ──────────────────────────────────
  const userTx = new VersionedTransaction(messageV0);
  userTx.sign([user]); // fills ONLY the user's positional slot; the sponsor slot stays zeroed
  const partialWire = userTx.serialize(); // v0 serialize never verifies → a partly-signed tx serializes fine
  console.log(`A) user signed; partial wire = ${partialWire.length} bytes (sponsor slot = 64 zero bytes)`);

  // ── Sponsor's server (receives the wire, has the sponsor key) ──────────────────────────────
  const sponsorTx = VersionedTransaction.deserialize(partialWire); // preserves the user's signature
  sponsorTx.sign([sponsor]); // fills slot 0; the user's slot is untouched (same message bytes)
  const sig = await connection.sendTransaction(sponsorTx); // fully signed now → no signers arg
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`A) sponsor completed + submitted; sponsor paid the fee. tx id (= signatures[0]): ${sig}`);

  // kit 7.0.0 equivalent: attach signers to the message and let kit collect them —
  //   const partial = await partiallySignTransactionMessageWithSigners(msgWithUserSigner);   // user only
  //   const full    = await signTransactionMessageWithSigners(msgWithSponsorSigner);          // asserts full
  // Use setTransactionMessageFeePayerSigner(sponsorSigner, m) for the sponsor, or
  // setTransactionMessageFeePayer(sponsorAddress, m) + createNoopSigner(sponsorAddress) when the
  // sponsor will sign on a different machine. Handoff bytes: getTransactionEncoder/Decoder.
}

/**
 * B. Air-gapped signature injection. The fee payer signs live; the user's OFFLINE device returns
 * only the 64-byte signature over the exact message bytes, injected via addSignature. This is the
 * hardware-wallet / cold-storage pattern — the user's secret key never enters the submitting host.
 */
async function airGappedInjection(
  connection: Connection,
  sponsor: Keypair,
  user: Keypair,
  recipient: PublicKey,
): Promise<void> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: recipient, lamports: TRANSFER_LAMPORTS }),
    ],
  }).compileToV0Message();

  const vtx = new VersionedTransaction(messageV0);
  vtx.sign([sponsor]); // fee payer signs in-process

  // The air-gapped device signs the SAME bytes web3.js signs (message.serialize()) and returns 64
  // bytes. nacl.sign.detached is exactly what web3.js uses under the hood. In production the key
  // lives only on the device; we derive from user.secretKey here purely to keep the demo runnable.
  const userSignature = nacl.sign.detached(vtx.message.serialize(), user.secretKey); // Uint8Array(64)
  vtx.addSignature(user.publicKey, userSignature); // inject — asserts exactly 64 bytes, matches the slot

  const sig = await connection.sendTransaction(vtx);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`B) air-gapped user signature injected via addSignature; tx id: ${sig}`);
}

async function main(): Promise<void> {
  const connection = new Connection(process.env.RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
  const sponsor = loadKeypair();
  const user = Keypair.generate();
  const recipient = process.env.RECIPIENT ? new PublicKey(process.env.RECIPIENT) : sponsor.publicKey;
  console.log(`sponsor (fee payer): ${sponsor.publicKey.toBase58()}`);
  console.log(`user (instruction signer): ${user.publicKey.toBase58()}`);

  // Fund the user enough for two demo transfers (both handoffs move TRANSFER_LAMPORTS + rent buffer).
  await fundUser(connection, sponsor, user.publicKey, TRANSFER_LAMPORTS * 2 + 5_000_000);

  await sponsorRelayerRoundTrip(connection, sponsor, user, recipient);
  await airGappedInjection(connection, sponsor, user, recipient);

  // Long-lived / offline lifetimes: blockhashes expire in ~60–90 s — too short for real air-gapped
  // or multisig round-trips. Swap the blockhash for a DURABLE NONCE (first instruction must be
  // SystemProgram.nonceAdvance). Nonce-account creation + rebroadcast live in the transaction-landing
  // skill (docs/retries-and-confirmation.md, examples/durable-nonce.ts).
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
