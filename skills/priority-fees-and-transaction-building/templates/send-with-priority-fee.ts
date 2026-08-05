/**
 * send-with-priority-fee.ts — reusable, copy-paste helper
 *
 * Drop this into your project and call `sendWithPriorityFee(...)` whenever you
 * need a transaction to land reliably. It:
 *   - simulates to size the compute-unit (CU) limit,
 *   - fetches a network priority fee (override-able),
 *   - prepends both ComputeBudget instructions,
 *   - sends a VersionedTransaction,
 *   - confirms with blockhash-expiry polling + rebroadcast.
 *
 * Usage:
 *   const sig = await sendWithPriorityFee(connection, [myIx], [payer], {
 *     payer: payer.publicKey,
 *     feePercentile: 0.75,
 *   });
 */

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Signer,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';

/** Hard per-transaction compute-unit ceiling enforced by the runtime. */
const MAX_CU_LIMIT = 1_400_000;

/**
 * Max number of accounts `getRecentPrioritizationFees` accepts in
 * `lockedWritableAccounts`. Passing more makes the RPC reject the request.
 */
const MAX_LOCKED_WRITABLE_ACCOUNTS = 128;

export interface SendWithPriorityFeeOptions {
  /** Fee payer. Defaults to the first signer's public key. */
  payer?: PublicKey;
  /** Override the priority fee (microLamports/CU) instead of querying the network. */
  microLamports?: number;
  /** Percentile of recent fees to use when auto-estimating (0–1). Default 0.75. */
  feePercentile?: number;
  /** Multiplier applied to simulated CUs for headroom. Default 1.1. */
  cuMargin?: number;
  /** Optional address lookup tables for v0 compression. */
  lookupTables?: AddressLookupTableAccount[];
  /** Poll/rebroadcast interval in ms. Default 1000. */
  pollIntervalMs?: number;
}

export async function sendWithPriorityFee(
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Signer[],
  opts: SendWithPriorityFeeOptions = {},
): Promise<string> {
  if (signers.length === 0) throw new Error('At least one signer is required');

  const payer = opts.payer ?? signers[0].publicKey;
  const cuMargin = opts.cuMargin ?? 1.1;
  const feePercentile = opts.feePercentile ?? 0.75;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const lookupTables = opts.lookupTables ?? [];

  // 0. Strip any caller-supplied setComputeUnitLimit/setComputeUnitPrice ixs
  //    (we add our own, sized by simulation) while PRESERVING requestHeapFrame.
  //    DUPLICATE limit/price ixs make the transaction FAIL — not "last one
  //    wins". See normalizeInstructions.
  const userInstructions = normalizeInstructions(instructions);

  // 1. Estimate CU limit by simulating with a temporary MAX limit ix.
  const computeUnits = await estimateComputeUnits(
    connection,
    userInstructions,
    payer,
    cuMargin,
    lookupTables,
  );

  // 2. Determine the priority fee. Include the fee payer in the writable set —
  //    the payer is always writable, and the fee market is per-writable-account.
  const microLamports =
    opts.microLamports ??
    (await estimatePriorityFee(
      connection,
      writableKeys(userInstructions, payer),
      feePercentile,
    ));

  // 3. Prepend the two ComputeBudget instructions (limit must come first).
  const finalInstructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ...userInstructions,
  ];

  // 4. Compile + sign a v0 transaction.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(message);
  tx.sign(signers);

  // 5. Send + confirm with expiry awareness.
  return confirmWithExpiry(connection, tx, lastValidBlockHeight, pollIntervalMs);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function estimateComputeUnits(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  margin: number,
  lookupTables: AddressLookupTableAccount[],
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();

  // Prepend a temporary MAX limit so the simulation reports TRUE consumption.
  // Without an explicit limit the runtime caps the simulation budget at the
  // 200k-per-instruction default, so a heavy tx hits that cap mid-run and
  // reports a truncated `unitsConsumed` — yielding an estimate that is too low.
  const simInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU_LIMIT }),
    ...instructions,
  ];

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: simInstructions,
  }).compileToV0Message(lookupTables);

  const sim = await connection.simulateTransaction(new VersionedTransaction(message), {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });

  if (sim.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
  }
  const consumed = sim.value.unitsConsumed ?? 200_000;
  const withHeadroom = Math.max(1_000, Math.ceil(consumed * margin));

  // Clamp to the per-transaction ceiling; if we're brushing it, the work can't
  // fit in one tx — fail loudly rather than request an impossible budget.
  if (withHeadroom > MAX_CU_LIMIT) {
    throw new Error(
      `Estimated compute units (${withHeadroom}) exceed the ${MAX_CU_LIMIT} ` +
        'per-transaction maximum — split the work across multiple transactions.',
    );
  }
  return withHeadroom;
}

async function estimatePriorityFee(
  connection: Connection,
  writableAccounts: PublicKey[],
  percentile: number,
): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: writableAccounts,
  });
  if (fees.length === 0) return 10_000;

  const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * percentile), sorted.length - 1);
  return Math.max(1, sorted[idx]);
}

/**
 * Drop ONLY the caller-supplied setComputeUnitLimit / setComputeUnitPrice
 * instructions (we replace them with our own, sized by simulation) while
 * PRESERVING any requestHeapFrame the caller passed. The runtime REJECTS a
 * transaction that carries more than one of the *same* ComputeBudget
 * instruction (a `DuplicateInstruction` error — it does not silently keep the
 * last one), so we must strip the limit/price pair we duplicate; but a heap
 * request is a distinct instruction we never add, so it has to survive.
 *
 * ComputeBudget instructions are identified by program id, and the specific
 * kind is the FIRST BYTE of the instruction data (the u8 discriminator):
 *   1 = RequestHeapFrame, 2 = SetComputeUnitLimit, 3 = SetComputeUnitPrice.
 * (0 = deprecated RequestUnits, which the runtime rejects.) So we strip 0, 2, and 3,
 * preserving 1 (RequestHeapFrame) and any other kind (e.g. 4 = data-size limit).
 *
 * Prefer this normalize-and-replace approach; if you would rather force callers
 * to pass clean instructions, throw here instead of filtering.
 */
function normalizeInstructions(
  instructions: TransactionInstruction[],
): TransactionInstruction[] {
  const computeBudgetId = ComputeBudgetProgram.programId;
  return instructions.filter((ix) => {
    if (!ix.programId.equals(computeBudgetId)) return true;
    // Keep any non-limit/price ComputeBudget ix (e.g. requestHeapFrame).
    const discriminator = ix.data[0];
    return discriminator !== 0 && discriminator !== 2 && discriminator !== 3;
  });
}

/**
 * Collect the writable account keys referenced by the instructions, seeded with
 * the fee payer (which is always writable — its lamports are debited).
 *
 * Capped to MAX_LOCKED_WRITABLE_ACCOUNTS (128) because that is the most
 * `getRecentPrioritizationFees` accepts in `lockedWritableAccounts`; the payer
 * is added first, so it always survives the cap. A tx with >128 writable
 * accounts is rare, and the fee estimate stays representative from the payer +
 * first accounts.
 */
function writableKeys(
  instructions: TransactionInstruction[],
  payer: PublicKey,
): PublicKey[] {
  const seen = new Set<string>([payer.toBase58()]);
  const keys: PublicKey[] = [payer];
  for (const ix of instructions) {
    for (const meta of ix.keys) {
      if (meta.isWritable && !seen.has(meta.pubkey.toBase58())) {
        seen.add(meta.pubkey.toBase58());
        keys.push(meta.pubkey);
      }
    }
  }
  return keys.slice(0, MAX_LOCKED_WRITABLE_ACCOUNTS);
}

async function confirmWithExpiry(
  connection: Connection,
  tx: VersionedTransaction,
  lastValidBlockHeight: number,
  pollIntervalMs: number,
): Promise<string> {
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: true,
    maxRetries: 0,
  });

  while (true) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return signature;
    }

    const blockHeight = await connection.getBlockHeight();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error('Blockhash expired before confirmation (block height exceeded)');
    }

    // Rebroadcast to keep the tx gossiped. A resend can throw transient errors
    // ("already processed", blockhash complaints) once the tx is in flight —
    // swallow them and keep polling the signature status, which is the source
    // of truth, until it confirms or the block height expires.
    try {
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (err) {
      console.warn('Rebroadcast failed (continuing to poll):', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
