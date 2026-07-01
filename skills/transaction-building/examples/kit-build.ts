/**
 * kit-build.ts — the @solana/kit 7.0.0 transaction pipeline, end to end.
 *
 * Kit has NO `Transaction` / `VersionedTransaction` class split. There is one IMMUTABLE
 * `TransactionMessage` (version 'legacy' | 0) built with pipe() + setters, where every setter
 * returns a new, more-strongly-typed message. `signTransactionMessageWithSigners` compiles AND
 * signs in one call. This example:
 *
 *   1. pipe(createTransactionMessage({version:0}) → setTransactionMessageFeePayerSigner
 *           → setTransactionMessageLifetimeUsingBlockhash → appendTransactionMessageInstructions)
 *   2. (optional) compress with fetchAddressesForLookupTables + compressTransactionMessageUsingAddressLookupTables
 *      — kit-native, NO extra dependency needed to read/use an existing table.
 *   3. signTransactionMessageWithSigners → getSignatureFromTransaction (base58 tx id)
 *   4. size-check with getTransactionSize / isTransactionWithinSizeLimit
 *   5. send: sendAndConfirmTransactionFactory (managed) OR getBase64EncodedWireTransaction + rpc.sendTransaction
 *
 * Stack:
 *   @solana/kit  7.0.0
 *   npm i @solana/kit@7.0.0
 *   npm i -D typescript tsx @types/node          # Node 20+
 *   npx tsx examples/kit-build.ts
 *
 * Env:
 *   RPC_URL       HTTP RPC endpoint (default: devnet).
 *   RPC_WS_URL    WebSocket endpoint for confirmation subscriptions (default: devnet).
 *   KEYPAIR_PATH  funded 64-byte secret-key JSON (default: ~/.config/solana/id.json).
 *   LOOKUP_TABLE  optional base58 ALT address — if set, the message is ALT-compressed before signing.
 *
 * Devnet recommended. The fee payer must hold a little SOL (memo txns still pay the base fee).
 */

import {
  pipe,
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  fetchAddressesForLookupTables,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
  getTransactionSize,
  isTransactionWithinSizeLimit,
  assertIsTransactionWithBlockhashLifetime,
  sendAndConfirmTransactionFactory,
  type Instruction,
} from "@solana/kit"; // 7.0.0
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

async function loadSigner() {
  const path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  // createKeyPairSignerFromBytes takes the 64-byte secret key (the Solana id.json array).
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main(): Promise<void> {
  const rpc = createSolanaRpc(process.env.RPC_URL ?? "https://api.devnet.solana.com");
  const rpcSubscriptions = createSolanaRpcSubscriptions(process.env.RPC_WS_URL ?? "wss://api.devnet.solana.com");

  const feePayer = await loadSigner();

  // A hand-built SPL Memo instruction. Kit-7 instruction objects dropped the `I` prefix used by
  // @solana/web3.js@2.x: the type is `Instruction` (not `IInstruction`). `data` is bytes; `accounts`
  // is optional (a memo needs none).
  const memoIx: Instruction = {
    programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    data: new TextEncoder().encode("kit-build demo"),
  };

  // rpc.getLatestBlockhash() returns { value: { blockhash, lastValidBlockHeight } } already shaped
  // as the BlockhashLifetimeConstraint — pass .value straight in. NOTE: lastValidBlockHeight is a
  // bigint (do not coerce to number).
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // ── Build the v0 message immutably (order: create → feePayer → lifetime → instructions) ──────
  const message = pipe(
    createTransactionMessage({ version: 0 }), // v0 (ALT-capable); createTransactionMessage rejects version 1
    (m) => setTransactionMessageFeePayerSigner(feePayer, m), // fee payer AS a signer (auto-signs)
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([memoIx], m),
  );

  // ── (optional) ALT compression — kit-native, no extra package to READ a table ────────────────
  // compressTransactionMessageUsingAddressLookupTables takes the MESSAGE as its FIRST arg (opposite
  // of most value-first APIs) and only works on v0 messages. It rewrites eligible non-signer
  // accounts into 1-byte table indices; the fee payer and any signer stay inline.
  const lutEnv = process.env.LOOKUP_TABLE;
  const finalMessage = lutEnv
    ? compressTransactionMessageUsingAddressLookupTables(
        message,
        await fetchAddressesForLookupTables([address(lutEnv)], rpc), // { [lut]: Address[] }
      )
    : message;
  // To CREATE/EXTEND/manage tables you need @solana-program/address-lookup-table 0.12.1, which
  // declares peerDependency @solana/kit ^6.4.0 — installed against kit 7 it emits an ERESOLVE /
  // unmet-peer-dep warning (works at runtime; ABI-stable codecs). Use `npm i --legacy-peer-deps`,
  // or pin kit ^6.4.0 for that package, or avoid it entirely for the read/compress path (as here).
  // Re-check `npm view @solana-program/address-lookup-table peerDependencies` at build time.

  // ── Compile + sign in one call ───────────────────────────────────────────────────────────────
  const signedTx = await signTransactionMessageWithSigners(finalMessage);

  // ── Measure — kit's size helpers are first-class (unlike web3.js v0 serialize, which never throws)
  const size = getTransactionSize(signedTx);
  if (!isTransactionWithinSizeLimit(signedTx)) {
    throw new Error(`too big: ${size} bytes — move non-signer accounts into an ALT or split the tx`);
  }
  console.log(`tx id: ${getSignatureFromTransaction(signedTx)} (${size} bytes)`);

  // ── Send + confirm (managed: needs the WS subscriptions; requires a blockhash lifetime) ──────
  // signTransactionMessageWithSigners returns a generic lifetime (blockhash | durable-nonce); the
  // blockhash-based waiter needs the narrower blockhash brand, so assert it (a no-op at runtime for
  // our blockhash-lifetime tx, and it throws early if you ever pass a durable-nonce tx here).
  assertIsTransactionWithBlockhashLifetime(signedTx);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTx, { commitment: "confirmed" });
  console.log("confirmed ✓");

  // Alternative — fire manually (no WS needed), then own confirmation yourself:
  //   const wire = getBase64EncodedWireTransaction(signedTx);
  //   const sig = await rpc.sendTransaction(wire, { encoding: "base64" }).send();
  // Priority fees, retries, and durable-nonce rebroadcast live in the transaction-landing skill.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
