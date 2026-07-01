/**
 * lookup-table.ts — the full Address Lookup Table (ALT) lifecycle, end to end.
 *
 * Demonstrates SKILL.md "Address Lookup Tables":
 *   1. CREATE — getSlot() then recentSlot: slot - 1 (the slot-1 gotcha), destructure the tuple
 *      [instruction, lookupTableAddress] that createLookupTable returns.
 *   2. EXTEND — append the non-signer accounts the tx will reference (~30 max per extend ix).
 *      (create + extend are sent together here — both fit in one tx.)
 *   3. WARM-UP — wait ≥ 1 slot; a table (and each newly extended address) is unusable in the
 *      same slot it was created/extended ("Transaction address table lookup uses an invalid index").
 *   4. FETCH — connection.getAddressLookupTable(address).value → an AddressLookupTableAccount.
 *   5. USE — compileToV0Message([lut]); prove the saving by comparing serialize().length WITH vs
 *      WITHOUT the table (each moved account: 32-byte key → 1-byte index, ~31 bytes saved).
 *   6. DEACTIVATE — then a note on the ~513-slot close cooldown; CLOSE is shown commented.
 *
 * Rules encoded here: only NON-signer, non-fee-payer, non-program accounts can be sourced from a
 * table. The real per-tx cap is MAX_TX_ACCOUNT_LOCKS = 128 distinct locked accounts (static +
 * ALL ALT-resolved) — NOT the "64 addresses" some older docs still quote. A table holds up to 256
 * addresses; a v0 tx may reference several tables.
 *
 * Stack:
 *   @solana/web3.js  1.98.4   (npm i @solana/web3.js@1.98.4)
 *   Node 20+. Run: npx tsx examples/lookup-table.ts   (devnet — the deactivate/close cooldown is real)
 *
 * Env: RPC_URL (default devnet), KEYPAIR_PATH (default ~/.config/solana/id.json).
 *
 * This skill is CONSTRUCTION — priority fees / robust confirmation live in `transaction-landing`.
 */

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
} from "@solana/web3.js"; // 1.98.4
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? clusterApiUrl("devnet");
  const keypairPath = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json");
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = loadKeypair(keypairPath);

  // Sign, send, and confirm a v0 transaction. Optionally reference lookup tables.
  const sendV0 = async (
    instructions: TransactionInstruction[],
    lookupTables: AddressLookupTableAccount[] = [],
  ) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTables);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]); // VersionedTransaction MUST be pre-signed (array arg; no signers to sendTransaction)
    const sig = await connection.sendTransaction(vtx, { maxRetries: 5 });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  };

  // The non-signer accounts our transaction will reference. Brand-new pubkeys are fine — they are
  // writable, non-signer, non-program accounts (exactly what ALTs are for). Dedupe before extending.
  const recipients = Array.from({ length: 12 }, () => Keypair.generate().publicKey);

  // ── 1. CREATE — recentSlot MUST be recent; use slot - 1 to avoid "<slot> is not a recent slot" ──
  const slot = await connection.getSlot();
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot - 1, // the leader may be a slot behind your RPC read — never pass the latest slot
  });
  console.log("LUT address:", lookupTableAddress.toBase58());

  // ── 2. EXTEND — append up to ~30 keys per ix (size-bounded); loop with more txs to reach 256 ──
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    lookupTable: lookupTableAddress,
    authority: payer.publicKey,
    payer: payer.publicKey,
    addresses: recipients,
  });

  // create + extend fit in one tx here. (The table is NOT usable yet — it must warm up first.)
  await sendV0([createIx, extendIx]);
  console.log("created + extended");

  // ── 3. WARM-UP — wait at least one slot before referencing the table ─────────────────────────
  const startSlot = await connection.getSlot();
  while ((await connection.getSlot()) <= startSlot) {
    await new Promise((r) => setTimeout(r, 400)); // ~1 slot on mainnet/devnet
  }

  // ── 4. FETCH the on-chain table (read .value) ────────────────────────────────────────────────
  const lut = (await connection.getAddressLookupTable(lookupTableAddress)).value;
  if (!lut) throw new Error("LUT not found / not yet propagated to this RPC");
  console.log(`table holds ${lut.state.addresses.length} addresses`);

  // ── 5. USE — build a v0 tx that touches every recipient, and prove the byte saving ──────────
  const transferIxs = recipients.map((to) =>
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 1 }),
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // WITHOUT the table: every recipient is a full 32-byte static key.
  const sizeWithout = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: transferIxs,
    }).compileToV0Message(),
  ).serialize().length;

  // WITH the table: each recipient collapses to a 1-byte index.
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: transferIxs,
  }).compileToV0Message([lut]); // ← pass the AddressLookupTableAccount(s)
  const sizeWith = new VersionedTransaction(messageV0).serialize().length;

  console.log(`size without ALT: ${sizeWithout} bytes`);
  console.log(`size with ALT:    ${sizeWith} bytes  (saved ${sizeWithout - sizeWith})`);

  await sendV0(transferIxs, [lut]);
  console.log("sent a v0 tx that referenced the table");

  // ── 6. DEACTIVATE (then close after the cooldown) ────────────────────────────────────────────
  const deactivateIx = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: lookupTableAddress,
    authority: payer.publicKey,
  });
  await sendV0([deactivateIx]);
  console.log("deactivated — close is blocked until the cooldown elapses");

  // CLOSE is intentionally NOT run inline: a deactivated table cannot be closed until a ~513-slot
  // cooldown (MAX_ENTRIES 512 + 1, ~3–4 min at ~400 ms/slot) has fully elapsed — closing early
  // fails "Table cannot be closed until it's fully deactivated in N blocks". To close later:
  //
  //   const closeIx = AddressLookupTableProgram.closeLookupTable({
  //     lookupTable: lookupTableAddress,
  //     authority: payer.publicKey,
  //     recipient: payer.publicKey, // reclaims the table's rent lamports
  //   });
  //   await sendV0([closeIx]);
  //
  // (Alternatively, AddressLookupTableProgram.freezeLookupTable({...}) makes the table IMMUTABLE
  //  forever — it can then never be extended, deactivated, or closed. Only freeze final contents.)
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/* ───────────────────────────────────────────────────────────────────────────────────────────────
 * @solana/kit 7.0.0 equivalents
 *
 * READ + COMPRESS an existing table needs NO extra dependency — kit is self-contained:
 *
 *   import {
 *     fetchAddressesForLookupTables,
 *     compressTransactionMessageUsingAddressLookupTables,
 *   } from "@solana/kit"; // 7.0.0
 *   const addressesByLut = await fetchAddressesForLookupTables([lut], rpc); // { [lut]: Address[] }
 *   const compressed = compressTransactionMessageUsingAddressLookupTables(message, addressesByLut);
 *   //                                                                     ^^^^^^^ message is the FIRST arg
 *   // Only v0 messages compress; only non-signer accounts move into the lookup.
 *
 * CREATE / EXTEND / MANAGE tables uses @solana-program/address-lookup-table 0.12.1:
 *   getCreateLookupTableInstructionAsync({ authority, payer, recentSlot }),
 *   getExtendLookupTableInstruction({ address, authority, payer, addresses }),
 *   findAddressLookupTablePda({ authority, recentSlot }), fetchAddressLookupTable(rpc, addr).
 *   ⚠ 0.12.1 declares peerDependencies { "@solana/kit": "^6.4.0" } — installed against kit 7.0.0 it
 *   emits an ERESOLVE warning (codecs are ABI-stable and work at runtime). Install with
 *   `--legacy-peer-deps`, or pin kit ^6.4.0 for that package. Re-verify at build time:
 *   `npm view @solana-program/address-lookup-table peerDependencies`.
 * ─────────────────────────────────────────────────────────────────────────────────────────────── */
