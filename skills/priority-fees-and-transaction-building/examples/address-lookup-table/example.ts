/**
 * Address Lookup Table (ALT) — create, extend, and use
 *
 * Address Lookup Tables let a versioned (v0) transaction reference accounts by
 * a 1-byte index instead of a full 32-byte pubkey. This shrinks the wire size,
 * which is essential once a transaction touches more accounts than the legacy
 * ~35-account ceiling (e.g. multi-hop swaps, batch transfers).
 *
 * Flow:
 *   1. Create the lookup table (returns the create ix + the derived ALT address).
 *   2. Extend it with the addresses you plan to reference.
 *   3. Fetch the ALT account and pass it into compileToV0Message([alt]).
 *
 * IMPORTANT: a newly created/extended ALT must be "warmed up" — it only becomes
 * usable one slot AFTER the extend transaction confirms. We poll the chain until
 * the slot has advanced and the table is visible (deterministic) rather than
 * sleeping a fixed interval, which can fire too early under load.
 *
 * ALT lifecycle caveats:
 *   - A single extend instruction can add at most ~30 addresses (the extend tx
 *     must fit in 1,232 bytes); add more across multiple extend transactions.
 *   - An ALT holds rent. To reclaim it: deactivate the table, wait the
 *     ~513-slot cooldown, then close it (AddressLookupTableProgram.deactivate
 *     then .close) — only the authority can do this.
 *   - The `authority` controls extend/freeze/deactivate; guard it like a key.
 *   - ALTs are only worth it when a tx references enough accounts to bust the
 *     ~1,232-byte limit. For small txs the create+extend overhead and the
 *     one-slot warm-up delay cost more than they save — just use a v0 tx.
 *
 * Defaults to devnet. Run with:  npx ts-node example.ts
 */

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { loadOrAirdropPayer } from '../_shared/util';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Funded in main() via loadOrAirdropPayer (SOLANA_KEYPAIR env, or devnet airdrop).
let payer: Keypair;

// ----------------------------------------------------------------------------
// Helper: sign, send, and confirm a v0 transaction built from instructions.
// ----------------------------------------------------------------------------
async function sendV0(
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  return signature;
}

// ----------------------------------------------------------------------------
// Fetch an ALT account by its address.
// ----------------------------------------------------------------------------
async function getLookupTable(address: PublicKey) {
  const { value } = await connection.getAddressLookupTable(address);
  return value; // AddressLookupTableAccount | null
}

async function main(): Promise<void> {
  // 0. Load a funded wallet from SOLANA_KEYPAIR, or airdrop a devnet keypair.
  payer = await loadOrAirdropPayer(connection);
  console.log('Payer:', payer.publicKey.toBase58());

  // 1. CREATE the lookup table. Must derive from a recent slot.
  const recentSlot = await connection.getSlot('finalized');
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot,
  });

  console.log('Lookup table address:', lookupTableAddress.toBase58());
  await sendV0([createIx]);

  // 2. EXTEND it with the addresses you want to compress.
  const addresses = [
    SystemProgram.programId,
    Keypair.generate().publicKey,
    Keypair.generate().publicKey,
  ];

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    lookupTable: lookupTableAddress,
    authority: payer.publicKey,
    payer: payer.publicKey,
    addresses,
  });

  await sendV0([extendIx]);

  // 3. WARM UP — the table is usable one slot AFTER the extend confirms. Poll
  //    deterministically: capture the slot we extended at, then wait until the
  //    chain has advanced past it AND the account is visible with our addresses.
  //    This beats a fixed sleep, which can fire too early (table not yet usable)
  //    or waste time when the chain is fast.
  const extendedAtSlot = await connection.getSlot('confirmed');
  let lookupTableAccount: AddressLookupTableAccount | null = null;
  const warmupDeadline = Date.now() + 30_000;
  while (Date.now() < warmupDeadline) {
    const currentSlot = await connection.getSlot('confirmed');
    if (currentSlot > extendedAtSlot) {
      const fetched = await getLookupTable(lookupTableAddress);
      if (fetched && fetched.state.addresses.length >= addresses.length) {
        lookupTableAccount = fetched;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!lookupTableAccount) {
    throw new Error('Lookup table did not warm up within 30s — retry shortly');
  }
  console.log('Addresses in table:', lookupTableAccount.state.addresses.length);

  const transferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: addresses[1],
    lamports: 1_000,
  });

  const signature = await sendV0([transferIx], [lookupTableAccount]);
  console.log('Sent tx using ALT:', signature);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
