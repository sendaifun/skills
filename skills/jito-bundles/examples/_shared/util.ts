/**
 * Shared helpers for the jito-bundles examples.
 *
 * Pure @solana/web3.js v1.x — no Jito SDK dependency. Talking to the Jito Block
 * Engine is plain JSON-RPC over HTTPS, so a small `fetch` wrapper is all you need.
 *
 * Every fact encoded here (endpoint paths, encoding rules, response field casing,
 * tip-floor units) is verified against https://docs.jito.wtf/lowlatencytxnsend/.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

// --- Connection / signer -----------------------------------------------------

/** A normal Solana RPC connection. Jito does NOT provide blockhashes — use your own RPC. */
export function getConnection(rpcUrl = "https://api.mainnet-beta.solana.com"): Connection {
  return new Connection(rpcUrl, "confirmed");
}

/** Load a keypair from a JSON secret-key array in an env var (e.g. PAYER_SECRET_KEY). */
export function loadKeypair(envVar = "PAYER_SECRET_KEY"): Keypair {
  const raw = process.env[envVar];
  if (!raw) throw new Error(`Missing ${envVar} (JSON array of the 64-byte secret key)`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

// --- Jito Block Engine JSON-RPC ----------------------------------------------

/**
 * Block Engine base URL. Regional hosts (lower latency) follow the pattern
 * https://<region>.mainnet.block-engine.jito.wtf — e.g. amsterdam, dublin,
 * frankfurt, london, ny, slc, singapore, tokyo. The rate limit is per-region,
 * so different regions have independent quotas.
 */
export const BLOCK_ENGINE = "https://mainnet.block-engine.jito.wtf";

/**
 * One quirk to internalize: the request PATH is not uniform.
 *   - sendBundle      -> /api/v1/bundles
 *   - sendTransaction -> /api/v1/transactions
 *   - everything else -> /api/v1/<methodName>   (method name IS the path)
 */
function pathForMethod(method: string): string {
  if (method === "sendBundle") return "/api/v1/bundles";
  if (method === "sendTransaction") return "/api/v1/transactions";
  return `/api/v1/${method}`;
}

/** Minimal JSON-RPC POST to the Block Engine. Throws on a JSON-RPC `error`. */
export async function jitoRpc<T = unknown>(
  method: string,
  params: unknown[],
  baseUrl = BLOCK_ENGINE,
): Promise<T> {
  const res = await fetch(`${baseUrl}${pathForMethod(method)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  // Default rate limit is 1 request/sec per IP per region; excess returns HTTP 429.
  if (res.status === 429) throw new Error("Jito rate limit (429) — back off >= 1s or use another region");
  const json = (await res.json()) as { result?: T; error?: unknown };
  if (json.error) throw new Error(`Jito RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result as T;
}

/** Fetch the 8 tip accounts at runtime. Do NOT hardcode — Jito may rotate them. */
export async function getTipAccounts(baseUrl = BLOCK_ENGINE): Promise<PublicKey[]> {
  const accounts = await jitoRpc<string[]>("getTipAccounts", [], baseUrl);
  return accounts.map((a) => new PublicKey(a));
}

/** Pick one tip account at random — spreads write-lock contention across the 8. */
export function pickTipAccount(accounts: PublicKey[]): PublicKey {
  return accounts[Math.floor(Math.random() * accounts.length)];
}

/**
 * Derive a competitive tip (in LAMPORTS) from the public tip-floor feed.
 *
 * CRITICAL: tip_floor percentiles are expressed in SOL (decimal floats), NOT
 * lamports. You MUST multiply by LAMPORTS_PER_SOL. Feeding the raw float into
 * SystemProgram.transfer would underpay by 1e9x and the bundle would never land.
 *
 * The 1000-lamport minimum is only an acceptance floor; under contention you
 * generally need the ema50/75th-percentile amount to actually win the auction.
 */
export async function fetchTipLamports(
  percentile: "ema_landed_tips_50th_percentile" | "landed_tips_75th_percentile" = "ema_landed_tips_50th_percentile",
): Promise<number> {
  const res = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor");
  const [floor] = (await res.json()) as Array<Record<string, number | string>>;
  const sol = Number(floor?.[percentile] ?? 0); // feed may serialize percentiles as strings
  return Math.max(Math.ceil(sol * LAMPORTS_PER_SOL), 1000); // SOL -> lamports, floor 1000
}

/** Build a SOL-transfer tip instruction to a tip account. `from` must sign the tx it lands in. */
export function tipInstruction(from: PublicKey, tipAccount: PublicKey, lamports: number): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: tipAccount, lamports });
}

/** Serialize a fully-signed VersionedTransaction to the base64 string sendBundle expects. */
export function encodeBase64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Compile + sign a v0 transaction from instructions sharing one blockhash. */
export function buildV0Tx(
  payer: PublicKey,
  blockhash: string,
  instructions: TransactionInstruction[],
  signers: Keypair[],
): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  return tx;
}

// --- Bundle status types + polling ------------------------------------------

/**
 * getInflightBundleStatuses value object. snake_case fields.
 *
 * Like getBundleStatuses, the RPC result is wrapped as
 * `{ context: { slot }, value: [InflightStatus] }` — unwrap `.value`.
 */
export interface InflightStatus {
  bundle_id: string;
  status: "Invalid" | "Pending" | "Failed" | "Landed";
  landed_slot: number | null;
}

/** JSON-RPC results for the status methods are wrapped in this envelope. */
export interface RpcContextValue<T> {
  context: { slot: number };
  value: T[];
}

/**
 * getBundleStatuses value object.
 *
 * The RPC result is wrapped as `{ context: { slot }, value: [BundleStatus | null] }`
 * — always unwrap `.value`. Every field here is snake_case (bundle_id,
 * transactions, slot, confirmation_status, err).
 */
export interface BundleStatus {
  bundle_id: string;
  transactions: string[]; // landed on-chain signatures (base58)
  slot: number;
  confirmation_status: "processed" | "confirmed" | "finalized";
  err: unknown; // { Ok: null } on success, Solana TransactionError otherwise
}

/**
 * Poll a bundle to a terminal state. Fast path is getInflightBundleStatuses
 * (5-minute lookback); once Landed we fetch getBundleStatuses for the real
 * signatures + commitment.
 *
 * Returns the landed BundleStatus, or throws on Failed/Invalid/timeout.
 */
export async function waitForBundle(
  bundleId: string,
  { timeoutMs = 30_000, pollMs = 1_500, baseUrl = BLOCK_ENGINE }: { timeoutMs?: number; pollMs?: number; baseUrl?: string } = {},
): Promise<BundleStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // params nest one level deeper than you'd expect: [[id1, id2, ...]] (max 5 ids).
    // The result is wrapped { context, value: [...] } — unwrap `.value` (the same
    // envelope getBundleStatuses uses).
    const inflight = await jitoRpc<RpcContextValue<InflightStatus> | null>("getInflightBundleStatuses", [[bundleId]], baseUrl);
    const status = inflight?.value?.[0]?.status;
    if (status === "Landed") {
      const statuses = await jitoRpc<RpcContextValue<BundleStatus | null>>("getBundleStatuses", [[bundleId]], baseUrl);
      const landed = statuses.value?.[0];
      if (landed) return landed;
    }
    if (status === "Failed" || status === "Invalid") {
      throw new Error(`Bundle ${bundleId} ended as ${status}`);
    }
    await new Promise((r) => setTimeout(r, pollMs)); // respect 1 req/s/region
  }
  throw new Error(`Bundle ${bundleId} did not land within ${timeoutMs}ms`);
}
