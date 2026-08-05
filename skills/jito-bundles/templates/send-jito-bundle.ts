/**
 * Reusable Jito bundle sender for @solana/web3.js v1.x.
 *
 * Drop this in, pass it your instruction groups + signers, and it will:
 *   1. fetch tip accounts + a competitive tip from the tip-floor feed
 *   2. inject the tip transfer into the LAST transaction (so a failed strategy
 *      doesn't pay the tip — bundles are atomic, all-or-nothing)
 *   3. compile every group into a v0 VersionedTransaction sharing one blockhash
 *   4. base64-encode and POST sendBundle (with the REQUIRED {encoding:'base64'})
 *   5. poll to a terminal state and return the landed signatures
 *
 * No Jito npm dependency — the Block Engine is plain JSON-RPC over HTTPS.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BLOCK_ENGINE,
  BundleStatus,
  buildV0Tx,
  encodeBase64,
  fetchTipLamports,
  getTipAccounts,
  jitoRpc,
  pickTipAccount,
  tipInstruction,
  waitForBundle,
} from "../examples/_shared/util";

export interface TxGroup {
  /** Instructions for one transaction in the bundle. */
  instructions: TransactionInstruction[];
  /** Additional signers for this transaction. The bundle's `payer` is added automatically. */
  signers: Keypair[];
}

export interface SendBundleOptions {
  /** Fee payer + tipper. Added automatically as a signer of EVERY transaction (it is the fee payer for all of them). */
  payer: Keypair;
  /** 1..5 transaction groups, executed in order, atomically. */
  groups: TxGroup[];
  /** Explicit tip in lamports. If omitted, derived from the tip-floor feed. */
  tipLamports?: number;
  /** Block Engine base URL (use a regional host for lower latency). */
  baseUrl?: string;
  /** Confirmation timeout. */
  timeoutMs?: number;
}

export interface SendBundleResult {
  bundleId: string;
  status: BundleStatus;
  /** Landed on-chain transaction signatures, in bundle order. */
  signatures: string[];
}

export async function sendJitoBundle(connection: Connection, opts: SendBundleOptions): Promise<SendBundleResult> {
  const { payer, groups, baseUrl = BLOCK_ENGINE, timeoutMs = 30_000 } = opts;

  if (groups.length < 1 || groups.length > 5) {
    throw new Error(`A bundle must contain 1..5 transactions (got ${groups.length})`);
  }

  // 1. Tip account (random of 8) + tip amount (tip-floor-derived unless given).
  const tipAccounts = await getTipAccounts(baseUrl);
  const tipAccount = pickTipAccount(tipAccounts);
  const tipLamports = opts.tipLamports ?? (await fetchTipLamports());

  // 2. Inject the tip into the LAST group, paid by `payer`.
  const lastIndex = groups.length - 1;
  const groupsWithTip = groups.map((g, i) =>
    i === lastIndex
      ? { ...g, instructions: [...g.instructions, tipInstruction(payer.publicKey, tipAccount, tipLamports)] }
      : g,
  );

  // 3. One blockhash for every tx in the bundle (they all execute in one slot).
  //    `payer` is the fee payer of every tx, so it must sign every tx — add it
  //    automatically (deduped) so a caller can't accidentally produce an unsigned tx.
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const txs: VersionedTransaction[] = groupsWithTip.map((g) => {
    const signers = g.signers.some((s) => s.publicKey.equals(payer.publicKey)) ? g.signers : [payer, ...g.signers];
    return buildV0Tx(payer.publicKey, blockhash, g.instructions, signers);
  });

  // 4. Encode base64 and send. The {encoding:'base64'} object is REQUIRED:
  //    the legacy default is base58, which would mis-decode these payloads.
  const encoded = txs.map(encodeBase64);
  const bundleId = await jitoRpc<string>("sendBundle", [encoded, { encoding: "base64" }], baseUrl);

  // 5. A bundle_id means RECEIVED, not LANDED — poll to a terminal state.
  const status = await waitForBundle(bundleId, { timeoutMs, baseUrl });
  return { bundleId, status, signatures: status.transactions };
}

/** Convenience: assert no transaction in the landed bundle errored. */
export function assertBundleOk(status: BundleStatus): void {
  const ok = status.err === null || (typeof status.err === "object" && (status.err as { Ok?: null }).Ok === null);
  if (!ok) throw new Error(`Bundle landed but a transaction errored: ${JSON.stringify(status.err)}`);
}

/** Build a tip-only transaction (use only when you can't fold the tip into a real tx). */
export function buildTipOnlyTx(payer: Keypair, blockhash: string, tipAccount: PublicKey, lamports: number): VersionedTransaction {
  return buildV0Tx(payer.publicKey, blockhash, [tipInstruction(payer.publicKey, tipAccount, lamports)], [payer]);
}
