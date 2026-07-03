/**
 * examples/tests/litesvm.test.ts
 *
 * LiteSVM integration test (TypeScript) for the `counter` example program.
 * LiteSVM is an in-process SVM: no validator, no RPC, millisecond test runs.
 * Here we load the compiled `.so`, build + sign + send a real transaction, and
 * assert the resulting on-chain account state.
 *
 * ── litesvm version nuance (READ THIS) ───────────────────────────────────────
 * The `litesvm` npm package ships TWO parallel lines:
 *   • 1.2.0 — **@solana/kit-based** (Address strings, kit tx builders). Pins
 *     `@solana/kit ^6.10.0`, `@solana-program/system ^0.12.2`. THIS FILE uses it.
 *   • 0.8.0 — the last release of the legacy **@solana/web3.js ^1.98.4** line
 *     (PublicKey/Transaction), kept for projects still on web3.js v1.
 * Gotcha: litesvm 1.2.0 pins kit ^6.10.0 while the newest kit is 7.0.0 —
 * installing kit 7 alongside yields two kit copies and "branded type" mismatches.
 * Pin `@solana/kit` to 6.x to match litesvm 1.2.0.
 *
 * litesvm (kit) does NOT plug into Anchor's web3.js-based `Program<T>`. To drive a
 * program through a typed Anchor client over litesvm, use the `anchor-litesvm`
 * package (`LiteSVMProvider` + `fromWorkspace`, on the @coral-xyz/anchor scope) —
 * see docs/testing.md. This file talks to the program at the raw-instruction level,
 * which is portable and shows exactly what `.methods.x()` does under the hood.
 *
 * Run with the Node test runner (no validator needed):
 *   anchor build               # produces target/deploy/counter.so
 *   node --import tsx --test examples/tests/litesvm.test.ts
 *
 * Deps: litesvm@1.2.0, @solana/kit@^6.10.0, @solana-program/system@^0.12.2
 *
 * `counter` interface (see examples/counter/lib.rs — MUST stay in sync):
 *   • PDA seeds = [b"counter", authority]
 *   • state Counter { authority: Pubkey (32), count: u64 (8), bump: u8 (1) }
 *     → account data layout: [0..8) discriminator, [8..40) authority, [40..48) count, [48] bump
 *   • initialize(): Accounts order = [authority(mut signer), counter(pda), system_program]
 *   • increment():  Accounts order = [authority(signer), counter(pda)]
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Decoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";

// Must equal the program's declare_id! (run `anchor keys sync`). The .so is the
// artifact `anchor build` writes to target/deploy/.
const COUNTER_PROGRAM_ID = address("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
const COUNTER_SO = process.env.COUNTER_SO ?? join(process.cwd(), "target/deploy/counter.so");

// Anchor instruction discriminator = first 8 bytes of sha256("global:<ix_name>").
// These two instructions take no args, so the data is just the discriminator.
const anchorDiscriminator = (name: string): Uint8Array =>
  Uint8Array.prototype.slice.call(createHash("sha256").update(`global:${name}`).digest(), 0, 8);

test("counter: initialize then increment (LiteSVM)", async () => {
  const svm = new LiteSVM();
  svm.addProgramFromFile(COUNTER_PROGRAM_ID, COUNTER_SO);

  const payer = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(1_000_000_000n));

  // PDA the program creates/owns: find_program_address([b"counter", authority], programId).
  // The authority (payer here) is part of the seeds, so the address must include it.
  const [counterPda] = await getProgramDerivedAddress({
    programAddress: COUNTER_PROGRAM_ID,
    seeds: ["counter", getAddressEncoder().encode(payer.address)],
  });

  // initialize(): accounts follow the #[derive(Accounts)] field order —
  // authority (writable signer / payer), counter (writable PDA), system_program (readonly).
  const initializeIx: Instruction = {
    programAddress: COUNTER_PROGRAM_ID,
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: anchorDiscriminator("initialize"),
  };

  // increment(): authority (readonly signer), counter (writable).
  const incrementIx: Instruction = {
    programAddress: COUNTER_PROGRAM_ID,
    accounts: [
      { address: payer.address, role: AccountRole.READONLY_SIGNER },
      { address: counterPda, role: AccountRole.WRITABLE },
    ],
    data: anchorDiscriminator("increment"),
  };

  await sendIx(svm, payer, initializeIx);
  assert.strictEqual(readCount(svm, counterPda), 0n, "count should be 0 after initialize");

  await sendIx(svm, payer, incrementIx);
  assert.strictEqual(readCount(svm, counterPda), 1n, "count should be 1 after increment");
});

/** Build a single-instruction tx, sign with the fee payer, send, and surface errors. */
async function sendIx(
  svm: LiteSVM,
  payer: Awaited<ReturnType<typeof generateKeyPairSigner>>,
  instruction: Instruction,
): Promise<void> {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const result = svm.sendTransaction(signed);
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(`transaction failed: ${result.err().toString()}\n${result.meta().logs().join("\n")}`);
  }
}

/** Read the Counter account and decode `count: u64`. Layout after the 8-byte Anchor
 * discriminator is authority(32) then count(8), so count sits at bytes [40..48). */
function readCount(svm: LiteSVM, counterPda: ReturnType<typeof address>): bigint {
  // getAccount returns a MaybeEncodedAccount union ({exists:true,...,data} | {exists:false,address}),
  // never null — narrow on `exists` so the check is real and `.data` is type-safe.
  const account = svm.getAccount(counterPda);
  if (!account.exists) throw new Error("counter account does not exist");
  const data = account.data; // [0..8) discriminator, [8..40) authority, [40..48) count (u64 LE)
  return getU64Decoder().decode(data.slice(40, 48));
}
