/**
 * Send a Jito bundle of two transactions, atomically, and confirm it landed.
 *
 * Demonstrates the whole canonical flow with raw JSON-RPC (no Jito SDK):
 *   getTipAccounts -> build v0 txs (tip in the last) -> base64 sendBundle -> poll.
 *
 * The two transfers either BOTH land in the same slot, or NEITHER does — that
 * all-or-nothing property is the reason to use a bundle instead of two sends.
 *
 * Run (mainnet — costs real SOL + tip):
 *   PAYER_SECRET_KEY='[..64 ints..]' RPC_URL='https://your-rpc' ts-node example.ts
 */

import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  buildV0Tx,
  encodeBase64,
  fetchTipLamports,
  getConnection,
  getTipAccounts,
  jitoRpc,
  loadKeypair,
  pickTipAccount,
  tipInstruction,
  waitForBundle,
} from "../_shared/util";

async function main() {
  const connection = getConnection(process.env.RPC_URL);
  const payer = loadKeypair("PAYER_SECRET_KEY");

  // Two unrelated recipients — stand-ins for "two things that must happen together".
  const recipientA = new PublicKey("11111111111111111111111111111112");
  const recipientB = new PublicKey("11111111111111111111111111111113");

  // 1. A random tip account (of the 8) and a competitive, tip-floor-derived tip.
  const tipAccounts = await getTipAccounts();
  const tipAccount = pickTipAccount(tipAccounts);
  const tipLamports = await fetchTipLamports(); // already SOL->lamports, floored at 1000

  // 2. One blockhash shared by every tx in the bundle (single-slot execution).
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // tx #1: first transfer (no tip)
  const tx1 = buildV0Tx(
    payer.publicKey,
    blockhash,
    [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipientA, lamports: 100_000 })],
    [payer],
  );

  // tx #2 (LAST): second transfer + the tip, so a failed bundle never pays the tip.
  const tx2 = buildV0Tx(
    payer.publicKey,
    blockhash,
    [
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipientB, lamports: 100_000 }),
      tipInstruction(payer.publicKey, tipAccount, tipLamports),
    ],
    [payer],
  );

  // 3. Encode base64 and send. {encoding:'base64'} is REQUIRED (legacy default is base58).
  const encoded = [tx1, tx2].map(encodeBase64);
  const bundleId = await jitoRpc<string>("sendBundle", [encoded, { encoding: "base64" }]);
  console.log(`Bundle received (NOT yet landed): ${bundleId}`);
  console.log(`Tipped ${tipLamports} lamports to ${tipAccount.toBase58()}`);

  // 4. bundle_id only means "received" — poll until it actually lands.
  const status = await waitForBundle(bundleId);
  console.log(`Landed in slot ${status.slot} (${status.confirmation_status})`);
  status.transactions.forEach((sig, i) => console.log(`  tx${i + 1}: https://solscan.io/tx/${sig}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
