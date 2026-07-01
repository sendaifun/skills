/**
 * jito-bundle.ts — submit an atomic Jito bundle and poll it to confirmation.
 *
 * Demonstrates SKILL.md "Jito bundles":
 *   1. Fetch the 8 tip accounts at runtime (getTipAccounts) and pick one at RANDOM
 *      (all 8 are write-locked; always hitting the same one serializes your bundles).
 *   2. Size the tip from the tip-floor API (percentiles in SOL → ×1e9 → lamports), p75 baseline.
 *   3. Build a 2-tx bundle: [work tx (memo), tip tx] — the SOL tip transfer goes in the LAST tx.
 *   4. Sign both with a FRESH blockhash, base64-encode, POST sendBundle to a regional block engine.
 *   5. Poll getInflightBundleStatuses to Landed/Failed, then getBundleStatuses for final detail,
 *      with lastValidBlockHeight as the hard timeout (bundles expire like any tx).
 *
 * Bundle guarantees: up to 5 fully-signed txns, executed SEQUENTIALLY, ATOMICALLY,
 * ALL-OR-NOTHING, within the SAME slot. For sendBundle, only the Jito TIP buys inclusion —
 * the priority fee is irrelevant to a bundle (it matters for the single-tx /transactions path).
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+ (global fetch). Run: I_UNDERSTAND_MAINNET=true npx tsx examples/jito-bundle.ts
 *
 * !! MAINNET ONLY — there is NO Jito on devnet. This spends REAL SOL (base fee + the tip).
 *    Test on testnet (https://<region>.testnet.block-engine.jito.wtf) or mainnet. The script
 *    refuses to run unless I_UNDERSTAND_MAINNET=true to prevent accidental spend.
 *
 * Env:
 *   RPC_URL                 a MAINNET RPC URL (required for blockhash + confirmation).
 *   KEYPAIR_PATH            funded mainnet keypair JSON (default ~/.config/solana/id.json).
 *   JITO_REGION             block-engine region host slug (default "ny"). One of:
 *                           ""(global)|amsterdam|dublin|frankfurt|london|ny|slc|singapore|tokyo.
 *   I_UNDERSTAND_MAINNET    must equal "true" to actually submit.
 *
 * Kit notes: build/sign with @solana/kit; tip ix = getTransferSolInstruction(...) from
 * @solana-program/system. The REST submission shape below is identical regardless of SDK.
 * jito-js-rpc 0.2.2 (JitoJsonRpcClient) wraps these same endpoints if you prefer an SDK.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js"; // 1.98.4
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MIN_TIP_LAMPORTS = 1_000; // bundle floor; real competitive tips come from tip_floor
const TIP_FLOOR_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";

function regionBase(): string {
  const region = process.env.JITO_REGION ?? "ny";
  const host = region ? `${region}.mainnet.block-engine.jito.wtf` : "mainnet.block-engine.jito.wtf";
  return `https://${host}/api/v1`;
}

function loadKeypair(): Keypair {
  const path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

/** Thin JSON-RPC POST helper against a Jito block-engine path. */
async function jitoRpc<T>(path: "bundles" | "transactions", method: string, params: unknown[]): Promise<T> {
  const res = await fetch(`${regionBase()}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (res.status === 429) throw new Error("Jito 429: rate limit is 1 req/s/IP/region — throttle or use a UUID");
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`Jito ${method} error: ${json.error.message}`);
  return json.result as T;
}

/** Fetch the 8 tip accounts at runtime and return a random one. They are stable but can rotate. */
async function randomTipAccount(): Promise<PublicKey> {
  const accounts = await jitoRpc<string[]>("bundles", "getTipAccounts", []);
  return new PublicKey(accounts[Math.floor(Math.random() * accounts.length)]);
}

/** Size the tip from the tip-floor API. Percentiles are in SOL — convert to lamports. */
async function tipFloorLamports(percentile: "25th" | "50th" | "75th" | "95th" | "99th" = "75th"): Promise<number> {
  const res = await fetch(TIP_FLOOR_URL);
  const data = (await res.json()) as Array<Record<string, number>>;
  const row = Array.isArray(data) ? data[0] : (data as Record<string, number>);
  const sol = row?.[`landed_tips_${percentile}_percentile`] ?? 0;
  return Math.max(MIN_TIP_LAMPORTS, Math.round(sol * 1e9));
}

function buildSignedV0(payer: Keypair, blockhash: string, ixs: TransactionInstruction[]): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return tx;
}

async function main(): Promise<void> {
  if (process.env.I_UNDERSTAND_MAINNET !== "true") {
    throw new Error("Refusing to run: Jito is mainnet-only and spends real SOL. Set I_UNDERSTAND_MAINNET=true.");
  }
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const payer = loadKeypair();

  // 1–2. Random tip account + tip sized at the 75th percentile of recently-landed tips.
  const [tipAccount, tipLamports] = await Promise.all([randomTipAccount(), tipFloorLamports("75th")]);
  console.log(`tip account ${tipAccount.toBase58()} — tip ${tipLamports} lamports (${(tipLamports / 1e9).toFixed(9)} SOL)`);

  // One fresh blockhash for the whole bundle; lastValidBlockHeight is the hard expiry.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  // 3. tx A — the "work" (a memo here; in practice your swap/repay/etc.).
  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [],
    data: Buffer.from(`jito-bundle demo ${Date.now()}`, "utf8"),
  });
  const workTx = buildSignedV0(payer, blockhash, [memoIx]);

  // tx B (LAST) — the tip transfer. The tip only lands if the whole bundle lands, so placing
  // it last means the work executes before you commit the tip (the canonical Jito pattern).
  // kit: getTransferSolInstruction({ source, destination: address(tip), amount: lamports(n) })
  const tipTx = buildSignedV0(payer, blockhash, [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: tipAccount, lamports: tipLamports }),
  ]);

  // 4. base64-encode each fully-signed tx; tip is in the LAST element.
  const encoded = [workTx, tipTx].map((t) => Buffer.from(t.serialize()).toString("base64"));
  const bundleId = await jitoRpc<string>("bundles", "sendBundle", [encoded, { encoding: "base64" }]);
  console.log(`bundle submitted: ${bundleId}`);

  // 5. Poll inflight status until Landed/Failed, with blockhash expiry as the hard stop.
  let landed = false;
  for (;;) {
    const inflight = await jitoRpc<{ value: Array<{ bundle_id: string; status: string; landed_slot: number | null }> }>(
      "bundles",
      "getInflightBundleStatuses",
      [[bundleId]],
    );
    const status = inflight.value[0]?.status; // Invalid | Pending | Failed | Landed
    console.log(`  status: ${status ?? "unknown"}`);
    if (status === "Landed") {
      landed = true;
      break;
    }
    if (status === "Failed" || status === "Invalid") throw new Error(`bundle ${status} — rebuild with a fresh blockhash / higher tip`);
    if ((await connection.getBlockHeight()) > lastValidBlockHeight) throw new Error("bundle expired (lastValidBlockHeight passed) — rebuild");
    await new Promise((r) => setTimeout(r, 1500)); // stay under 1 req/s/region budget
  }

  // Final detail: getBundleStatuses returns the tx signatures, slot, confirmation_status, err.
  if (landed) {
    const detail = await jitoRpc<{
      value: Array<{ bundle_id: string; transactions: string[]; slot: number; confirmation_status: string; err: unknown }>;
    }>("bundles", "getBundleStatuses", [[bundleId]]);
    const d = detail.value[0];
    console.log(`landed ✓ slot ${d?.slot} status ${d?.confirmation_status}`);
    for (const sig of d?.transactions ?? []) console.log(`  https://solscan.io/tx/${sig}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
