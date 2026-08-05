/**
 * Size the tip from the live tip-floor feed, send via the reusable template,
 * and confirm to finality.
 *
 * The headline gotcha this guards against: the tip_floor percentiles are in
 * SOL, not lamports. `fetchTipLamports` does the SOL->lamports conversion for
 * you; doing it by hand and forgetting the *1e9 is the #1 reason a bundle
 * silently never lands.
 *
 * Run (mainnet — costs real SOL + tip):
 *   PAYER_SECRET_KEY='[..64 ints..]' RPC_URL='https://your-rpc' ts-node example.ts
 */

import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { fetchTipLamports, getConnection, loadKeypair } from "../_shared/util";
import { assertBundleOk, sendJitoBundle } from "../../templates/send-jito-bundle";

async function main() {
  const connection = getConnection(process.env.RPC_URL);
  const payer = loadKeypair("PAYER_SECRET_KEY");
  const recipient = new PublicKey("11111111111111111111111111111112");

  // Pay the 75th percentile when you actually care about landing under contention.
  // (ema_landed_tips_50th_percentile is the cheaper baseline.)
  const tipLamports = await fetchTipLamports("landed_tips_75th_percentile");
  console.log(`tip-floor 75th pct => ${tipLamports} lamports (${tipLamports / LAMPORTS_PER_SOL} SOL)`);

  // A single real transaction; the template appends the tip into this last (only) tx.
  const result = await sendJitoBundle(connection, {
    payer,
    tipLamports,
    groups: [
      {
        instructions: [
          SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 50_000 }),
        ],
        signers: [payer],
      },
    ],
  });

  assertBundleOk(result.status); // throws if it landed but the tx errored
  console.log(`Bundle ${result.bundleId} landed in slot ${result.status.slot} (${result.status.confirmation_status})`);
  console.log(`Signature: https://solscan.io/tx/${result.signatures[0]}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
