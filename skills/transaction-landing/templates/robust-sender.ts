/**
 * robust-sender.ts — a reusable, production-shaped Solana transaction sender.
 *
 * Drop this file into a project and use the `RobustSender` class as the single entry point for
 * landing transactions under congestion. It wraps the full SKILL.md landing pipeline:
 *
 *   • CU sizing      — simulate the tx, set the compute-unit limit to unitsConsumed × headroom.
 *   • Fee estimation — pluggable: native getRecentPrioritizationFees (p75) OR Helius
 *                      getPriorityFeeEstimate; or pass an explicit price to override.
 *   • Send + retry   — skipPreflight:true + maxRetries:0, manual rebroadcast of the SAME signed
 *                      bytes, blockhash-expiry detection, and bounded fee-escalating rebuilds.
 *   • Confirm        — drive success by signature status, expiry by lastValidBlockHeight.
 *   • Jito path      — optional sendBundle: append a tip transfer to a random tip account
 *                      (sized from tip_floor) in the last tx, base64-encode, submit, poll status.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+ (global fetch). No secrets are hardcoded — keypair/RPC come from the caller/env.
 *
 * Kit (@solana/kit 7.0.0) mapping is noted in comments; the public API here is intentionally
 * web3.js-shaped because that is still the portable baseline.
 */

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js"; // 1.98.4

const MAX_CU = 1_400_000; // MAX_COMPUTE_UNIT_LIMIT (Anza agave execution_budget.rs)
const SIM_PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58(); // "111…1": swapped during simulation
const MIN_JITO_TIP_LAMPORTS = 1_000;
const TIP_FLOOR_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";

/** Helius priority levels map to percentiles: Min p0, Low p25, Medium p50, High p75, VeryHigh p90+, UnsafeMax p100. */
export type PriorityLevel = "Min" | "Low" | "Medium" | "High" | "VeryHigh" | "UnsafeMax";
export type TipPercentile = "25th" | "50th" | "75th" | "95th" | "99th";

export interface RobustSenderConfig {
  /** Where to source the CU price. "native" needs no key; "helius" needs heliusApiKey. Default "native". */
  feeEstimator?: "native" | "helius";
  /** Helius RPC api-key (required when feeEstimator === "helius"). */
  heliusApiKey?: string;
  /** Helius priorityLevel when feeEstimator === "helius". Default "High" (≈ p75). */
  heliusPriorityLevel?: PriorityLevel;
  /** Multiply simulated unitsConsumed by this for the CU limit. Default 1.1. */
  cuHeadroomMultiplier?: number;
  /** Multiply the price by this per retry attempt (re-bid above a rising market). Default 1.5. */
  feeBumpMultiplier?: number;
  /** Hard floor on the CU price in µLamports/CU (never bid 0 when you want priority). Default 1. */
  minPriorityFeeMicroLamports?: number;
  /** Max blockhash-refresh attempts for sendAndConfirm. Default 4. */
  maxAttempts?: number;
  /** Rebroadcast / poll interval in ms. Default 2000. */
  pollIntervalMs?: number;
  /** Target commitment for "landed". Default "confirmed". */
  commitment?: Commitment;
  /** Jito block-engine base incl. /api/v1, e.g. https://ny.mainnet.block-engine.jito.wtf/api/v1. */
  jitoBase?: string;
}

export interface SendParams {
  payer: Keypair;
  /** Your work instructions (ComputeBudget ixs are added automatically — do not include them). */
  instructions: TransactionInstruction[];
  /** Co-signers besides the fee payer (e.g. a new account keypair). */
  additionalSigners?: Keypair[];
  /** Address Lookup Tables for v0 compression. */
  lookupTables?: AddressLookupTableAccount[];
  /** Writable accounts to scope the NATIVE fee estimate to (where contention lives). */
  writableAccounts?: PublicKey[];
  /** Override the estimator with an explicit µLamports/CU price. */
  priorityFeeMicroLamports?: number;
}

export interface BundleParams {
  payer: Keypair;
  /** Instruction groups, one per transaction (≤5 total). The tip is appended to the LAST group. */
  transactions: TransactionInstruction[][];
  additionalSigners?: Keypair[];
  lookupTables?: AddressLookupTableAccount[];
  /** Explicit tip in lamports; otherwise sized from tip_floor at tipPercentile. */
  tipLamports?: number;
  /** tip_floor percentile to size the tip. Default "75th". */
  tipPercentile?: TipPercentile;
}

export interface BundleResult {
  bundleId: string;
  /** base58 signatures of the bundle's transactions (set once landed). */
  signatures: string[];
  status: "Landed" | "Failed" | "Invalid" | "Expired";
  landedSlot: number | null;
}

export class RobustSender {
  private readonly cfg: Required<Omit<RobustSenderConfig, "heliusApiKey" | "jitoBase">> &
    Pick<RobustSenderConfig, "heliusApiKey" | "jitoBase">;

  constructor(
    private readonly connection: Connection,
    config: RobustSenderConfig = {},
  ) {
    this.cfg = {
      feeEstimator: config.feeEstimator ?? "native",
      heliusApiKey: config.heliusApiKey,
      heliusPriorityLevel: config.heliusPriorityLevel ?? "High",
      cuHeadroomMultiplier: config.cuHeadroomMultiplier ?? 1.1,
      feeBumpMultiplier: config.feeBumpMultiplier ?? 1.5,
      minPriorityFeeMicroLamports: config.minPriorityFeeMicroLamports ?? 1,
      maxAttempts: config.maxAttempts ?? 4,
      pollIntervalMs: config.pollIntervalMs ?? 2000,
      commitment: config.commitment ?? "confirmed",
      jitoBase: config.jitoBase,
    };
    if (this.cfg.feeEstimator === "helius" && !this.cfg.heliusApiKey) {
      throw new Error("feeEstimator 'helius' requires heliusApiKey");
    }
  }

  // ---- transaction building -------------------------------------------------

  private compileV0(payer: PublicKey, blockhash: string, ixs: TransactionInstruction[], luts?: AddressLookupTableAccount[]): VersionedTransaction {
    // kit: pipe(createTransactionMessage({version:0}), setTransactionMessageFeePayer,
    //           setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions)
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts);
    return new VersionedTransaction(msg);
  }

  // ---- CU sizing ------------------------------------------------------------

  /**
   * Simulate the work ixs (with a placeholder max limit + price ix) and return a CU limit of
   * ceil(unitsConsumed × cuHeadroomMultiplier), clamped to MAX_CU. Re-simulation after adding
   * the final limit ix is unnecessary — the limit ix changes bytes, not CU consumption.
   * kit: estimateComputeUnitLimitFactory({ rpc }) (kit 7.0.0; @deprecated → estimateResourceLimitsFactory).
   */
  async sizeComputeUnits(payer: PublicKey, workIxs: TransactionInstruction[], luts?: AddressLookupTableAccount[]): Promise<number> {
    const sizingTx = this.compileV0(payer, SIM_PLACEHOLDER_BLOCKHASH, [
      ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      ...workIxs,
    ], luts);
    const sim = await this.connection.simulateTransaction(sizingTx, { replaceRecentBlockhash: true, sigVerify: false });
    if (sim.value.err) throw new Error(`CU sizing simulation failed: ${JSON.stringify(sim.value.err)}`);
    return Math.min(MAX_CU, Math.ceil((sim.value.unitsConsumed ?? 200_000) * this.cfg.cuHeadroomMultiplier));
  }

  // ---- fee estimation -------------------------------------------------------

  /** Estimate the CU price in µLamports/CU using the configured estimator. */
  async estimatePriorityFee(serializedSizingTx: Uint8Array, writableAccounts: PublicKey[]): Promise<number> {
    const floor = this.cfg.minPriorityFeeMicroLamports;
    if (this.cfg.feeEstimator === "helius") {
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${this.cfg.heliusApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getPriorityFeeEstimate",
          params: [{ transaction: Buffer.from(serializedSizingTx).toString("base64"), options: { transactionEncoding: "Base64", priorityLevel: this.cfg.heliusPriorityLevel } }],
        }),
      });
      const json = (await res.json()) as { result?: { priorityFeeEstimate?: number } };
      return Math.max(Math.ceil(json.result?.priorityFeeEstimate ?? floor), floor);
    }
    // native: raw per-slot samples over ~150 slots; aggregate to p75 ourselves.
    const fees = await this.connection.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts });
    const samples = fees.map((f) => f.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
    return Math.max(samples[Math.floor(samples.length * 0.75)] ?? 0, floor);
  }

  // ---- the main send loop ---------------------------------------------------

  /**
   * Size CU, set both ComputeBudget ixs, send with skipPreflight+maxRetries:0, rebroadcast the
   * same signed bytes every pollIntervalMs, and rebuild from a fresh blockhash with an escalated
   * fee on expiry — up to maxAttempts. Returns the confirmed signature or throws.
   */
  async sendAndConfirm(params: SendParams): Promise<string> {
    const { payer, instructions, additionalSigners = [], lookupTables } = params;
    const signers = [payer, ...additionalSigners];
    const writableAccounts = params.writableAccounts ?? [payer.publicKey];

    const units = await this.sizeComputeUnits(payer.publicKey, instructions, lookupTables);

    // Base price: explicit override, else one estimator call (passing a representative sizing tx).
    let basePrice = params.priorityFeeMicroLamports;
    if (basePrice == null) {
      const sizingTx = this.compileV0(payer.publicKey, SIM_PLACEHOLDER_BLOCKHASH, [
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        ...instructions,
      ], lookupTables);
      basePrice = await this.estimatePriorityFee(sizingTx.serialize(), writableAccounts);
    }

    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      const microLamports = Math.ceil(basePrice * Math.pow(this.cfg.feeBumpMultiplier, attempt - 1));
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
        ...instructions,
      ];

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.cfg.commitment);
      const tx = this.compileV0(payer.publicKey, blockhash, ixs, lookupTables);
      tx.sign(signers);
      const raw = tx.serialize();
      const signature = await this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

      const landed = await this.rebroadcastUntilDone(signature, raw, lastValidBlockHeight);
      if (landed) return signature;
      // else expired → next attempt rebuilds with a fresh blockhash + bumped fee
    }
    throw new Error(`did not confirm within ${this.cfg.maxAttempts} blockhash windows — escalate to Jito bundle / Helius Sender`);
  }

  /** Re-send identical bytes until confirmed (→ true), reverted (→ throw), or expired (→ false). */
  private async rebroadcastUntilDone(signature: string, raw: Uint8Array, lastValidBlockHeight: number): Promise<boolean> {
    while (true) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const s = value[0];
      if (s?.err) throw new Error(`tx failed on-chain: ${JSON.stringify(s.err)}`);
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return true;
      if ((await this.connection.getBlockHeight(this.cfg.commitment)) > lastValidBlockHeight) return false; // expired
      await this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); // idempotent: same signature
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
  }

  // ---- optional Jito-bundle path -------------------------------------------

  private jitoApi(): string {
    return this.cfg.jitoBase ?? "https://mainnet.block-engine.jito.wtf/api/v1";
  }

  private async jitoRpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(`${this.jitoApi()}/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status === 429) throw new Error("Jito 429: 1 req/s/IP/region — throttle or use a UUID");
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`Jito ${method}: ${json.error.message}`);
    return json.result as T;
  }

  /** Random tip account fetched at runtime (the set is stable but can rotate). */
  async randomTipAccount(): Promise<PublicKey> {
    const accounts = await this.jitoRpc<string[]>("getTipAccounts", []);
    return new PublicKey(accounts[Math.floor(Math.random() * accounts.length)]);
  }

  /** Tip sized from the tip-floor API (percentiles are SOL → ×1e9 lamports). */
  async tipFloorLamports(percentile: TipPercentile = "75th"): Promise<number> {
    const res = await fetch(TIP_FLOOR_URL);
    const data = (await res.json()) as Array<Record<string, number>> | Record<string, number>;
    const row = Array.isArray(data) ? data[0] : data;
    return Math.max(MIN_JITO_TIP_LAMPORTS, Math.round((row?.[`landed_tips_${percentile}_percentile`] ?? 0) * 1e9));
  }

  /**
   * Submit an atomic Jito bundle (≤5 txns, sequential, all-or-nothing, same slot). The tip
   * transfer to a random tip account is appended to the LAST tx; for sendBundle only the tip
   * (not the priority fee) buys inclusion. Polls to Landed/Failed with blockhash expiry as the
   * hard stop. MAINNET/testnet only — there is no Jito on devnet.
   */
  async sendBundle(params: BundleParams): Promise<BundleResult> {
    const { payer, transactions, additionalSigners = [], lookupTables } = params;
    if (transactions.length === 0 || transactions.length > 5) throw new Error("a bundle must contain 1–5 transactions");

    const [tipAccount, tipLamports] = await Promise.all([
      this.randomTipAccount(),
      params.tipLamports != null ? Promise.resolve(params.tipLamports) : this.tipFloorLamports(params.tipPercentile ?? "75th"),
    ]);

    // Append the tip as the LAST instruction of the LAST tx.
    const groups = transactions.map((g) => [...g]);
    groups[groups.length - 1].push(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: tipAccount, lamports: tipLamports }),
    );

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(this.cfg.commitment);
    const signers = [payer, ...additionalSigners];
    const encoded = groups.map((ixs) => {
      const tx = this.compileV0(payer.publicKey, blockhash, ixs, lookupTables);
      // Sign each tx with ONLY the signers it actually requires: VersionedTransaction.sign throws
      // "Cannot sign with non signer key" if handed a signer that isn't required by THAT message
      // (a co-signer needed by just one tx in a multi-tx bundle would otherwise break the others).
      const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
      tx.sign(signers.filter((s) => required.some((k) => k.equals(s.publicKey))));
      return Buffer.from(tx.serialize()).toString("base64");
    });

    const bundleId = await this.jitoRpc<string>("sendBundle", [encoded, { encoding: "base64" }]);

    // Poll inflight status; enforce blockhash expiry as the hard timeout.
    for (;;) {
      const inflight = await this.jitoRpc<{ value: Array<{ status: string; landed_slot: number | null }> }>("getInflightBundleStatuses", [[bundleId]]);
      const v = inflight.value[0];
      if (v?.status === "Landed") {
        const detail = await this.jitoRpc<{ value: Array<{ transactions: string[]; slot: number }> }>("getBundleStatuses", [[bundleId]]);
        return { bundleId, signatures: detail.value[0]?.transactions ?? [], status: "Landed", landedSlot: v.landed_slot };
      }
      if (v?.status === "Failed" || v?.status === "Invalid") return { bundleId, signatures: [], status: v.status as "Failed" | "Invalid", landedSlot: null };
      if ((await this.connection.getBlockHeight(this.cfg.commitment)) > lastValidBlockHeight) return { bundleId, signatures: [], status: "Expired", landedSlot: null };
      await new Promise((r) => setTimeout(r, Math.max(this.cfg.pollIntervalMs, 1000))); // ≥1s: stay under 1 req/s/region
    }
  }
}

/* ---------------------------------------------------------------------------
 * Example usage (delete in your project):
 *
 *   import { Connection, Keypair, SystemProgram } from "@solana/web3.js";
 *   import { RobustSender } from "./robust-sender";
 *
 *   const connection = new Connection(process.env.RPC_URL!, "confirmed");
 *   const sender = new RobustSender(connection, { feeEstimator: "helius", heliusApiKey: process.env.HELIUS_API_KEY });
 *   const payer = Keypair.fromSecretKey(...);
 *
 *   const sig = await sender.sendAndConfirm({
 *     payer,
 *     instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1_000_000 })],
 *     writableAccounts: [payer.publicKey],
 *   });
 *
 *   // Atomic Jito bundle (mainnet): set jitoBase to a regional engine.
 *   const sender2 = new RobustSender(connection, { jitoBase: "https://ny.mainnet.block-engine.jito.wtf/api/v1" });
 *   const result = await sender2.sendBundle({ payer, transactions: [[ix1, ix2]] }); // tip auto-appended
 * --------------------------------------------------------------------------- */
