/**
 * metadata.ts — Token-2022 in-mint metadata (MetadataPointer + TokenMetadata).
 *
 * Stores name/symbol/uri (and arbitrary key/value pairs) INSIDE the mint account —
 * no Metaplex Token Metadata account required. Demonstrates the full lifecycle:
 *
 *   1. Create a mint with MetadataPointer (self-pointer) + TokenMetadata.
 *   2. Read it back with getTokenMetadata().
 *   3. Update a built-in field (URI) and ADD a custom field — both grow the account,
 *      so we top up rent-exempt lamports before the realloc.
 *   4. Remove the custom field (createRemoveKeyInstruction).
 *   5. Lock metadata forever by setting the update authority to null.
 *
 * The "self-pointer" pattern: MetadataPointer points the mint at ITSELF as the
 * metadata account, and the TokenMetadata data is written into the same mint account.
 *
 * Ordering (see SKILL.md > "THE CRITICAL ORDER"):
 *   createAccount(space = getMintLen([MetadataPointer]))   // fixed ext sized here
 *   -> initialize MetadataPointer                          // fixed ext, BEFORE the mint
 *   -> initializeMint                                       // seals the layout
 *   -> initialize TokenMetadata                             // variable-length, AFTER the mint
 *
 * Rent: getMintLen() does NOT count the variable-length TokenMetadata. Allocate the
 * account at mintLen, but FUND lamports for `mintLen + TYPE_SIZE + LENGTH_SIZE +
 * pack(metadata).length`. Every later field change that GROWS the data needs a top-up.
 *
 * --- Run (devnet) ---
 *   npm i @solana/spl-token@0.4.14 @solana/spl-token-metadata@0.1.6 @solana/web3.js@1.98.4
 *   npm i -D typescript tsx @types/node          # Node 20+
 *   npx tsx metadata.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  getTokenMetadata,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  TYPE_SIZE,
  LENGTH_SIZE,
} from '@solana/spl-token';
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  createRemoveKeyInstruction,
  createUpdateAuthorityInstruction,
  pack,
  Field,
  type TokenMetadata,
} from '@solana/spl-token-metadata';

const DECIMALS = 0;

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const payer = await loadOrAirdropPayer(connection);
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  // Local mirror of the on-chain metadata. We keep it in sync as we mutate fields so
  // we can re-pack it to compute the exact rent the account needs after each change.
  const metadata: TokenMetadata = {
    mint,
    name: 'Metadata Demo',
    symbol: 'META',
    uri: 'https://example.com/v1.json',
    additionalMetadata: [], // start empty; we add a custom field later
  };

  // Only MetadataPointer is a FIXED-length extension here; TokenMetadata is variable.
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const initialMetadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + initialMetadataLen);

  // ---------------------------------------------------------------------------
  // 1. Create the mint with the metadata, in the mandatory order.
  // ---------------------------------------------------------------------------
  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen, // fixed ext only; rent above covers the metadata too
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(
      mint,
      payer.publicKey, // update authority
      mint, // self-pointer
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint,
      DECIMALS,
      payer.publicKey,
      payer.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      mint,
      mintAuthority: payer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mintKp]);
  console.log(`Mint with metadata: ${mint.toBase58()}`);
  console.log(`Explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`);
  await readMetadata(connection, mint, 'after init');

  // ---------------------------------------------------------------------------
  // 2. Update the built-in URI field. A longer value grows the account, so top up
  //    rent first. createUpdateFieldInstruction handles the on-chain realloc.
  // ---------------------------------------------------------------------------
  metadata.uri = 'https://example.com/v2-updated.json';
  const updateUriTx = new Transaction();
  const topUp1 = await rentTopUp(connection, mint, mintLen, metadata, payer.publicKey);
  if (topUp1) updateUriTx.add(topUp1);
  updateUriTx.add(
    createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey, // must sign
      field: Field.Uri, // built-in field
      value: metadata.uri,
    }),
  );
  await sendAndConfirmTransaction(connection, updateUriTx, [payer]);
  await readMetadata(connection, mint, 'after URI update');

  // ---------------------------------------------------------------------------
  // 3. Add a CUSTOM key/value pair (additionalMetadata). Pass the field as a string
  //    key (not a Field enum). This always grows the account -> top up first.
  // ---------------------------------------------------------------------------
  metadata.additionalMetadata.push(['description', 'A Token-2022 metadata demo token']);
  const addFieldTx = new Transaction();
  const topUp2 = await rentTopUp(connection, mint, mintLen, metadata, payer.publicKey);
  if (topUp2) addFieldTx.add(topUp2);
  addFieldTx.add(
    createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      field: 'description', // custom key -> stored in additionalMetadata
      value: 'A Token-2022 metadata demo token',
    }),
  );
  await sendAndConfirmTransaction(connection, addFieldTx, [payer]);
  await readMetadata(connection, mint, 'after adding custom field');

  // ---------------------------------------------------------------------------
  // 4. Remove the custom key. Shrinks the account; no top-up needed (the surplus
  //    lamports simply remain on the account). idempotent=true => no error if absent.
  // ---------------------------------------------------------------------------
  metadata.additionalMetadata = metadata.additionalMetadata.filter(([k]) => k !== 'description');
  const removeTx = new Transaction().add(
    createRemoveKeyInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      key: 'description',
      idempotent: true,
    }),
  );
  await sendAndConfirmTransaction(connection, removeTx, [payer]);
  await readMetadata(connection, mint, 'after removing custom field');

  // ---------------------------------------------------------------------------
  // 5. Lock the metadata: set update authority to null. After this no field can ever
  //    be changed again. This is irreversible — there is no way to re-grant authority.
  // ---------------------------------------------------------------------------
  const lockTx = new Transaction().add(
    createUpdateAuthorityInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      oldAuthority: payer.publicKey, // current update authority (signer)
      newAuthority: null, // null => permanently immutable
    }),
  );
  await sendAndConfirmTransaction(connection, lockTx, [payer]);
  const finalMeta = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log(`\nLocked. updateAuthority is now: ${finalMeta?.updateAuthority ?? 'null (immutable)'}`);
}

/**
 * Compute whether the mint account needs more lamports to stay rent-exempt at the new
 * metadata size, and if so return a top-up transfer instruction. The on-chain size is
 * mintLen + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length.
 */
async function rentTopUp(
  connection: Connection,
  mint: PublicKey,
  mintLen: number,
  metadata: TokenMetadata,
  payer: PublicKey,
) {
  const newSize = mintLen + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const needed = await connection.getMinimumBalanceForRentExemption(newSize);
  const info = await connection.getAccountInfo(mint);
  const have = info?.lamports ?? 0;
  if (have >= needed) return null;
  return SystemProgram.transfer({ fromPubkey: payer, toPubkey: mint, lamports: needed - have });
}

/** Read on-chain metadata and pretty-print it. */
async function readMetadata(connection: Connection, mint: PublicKey, label: string) {
  const meta = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log(`\n[${label}]`);
  if (!meta) {
    console.log('  (no metadata found)');
    return;
  }
  console.log(`  name=${meta.name} symbol=${meta.symbol} uri=${meta.uri}`);
  console.log(`  additionalMetadata=${JSON.stringify(meta.additionalMetadata)}`);
}

/** Devnet helper: KEYPAIR (JSON secret-key path) or generate + airdrop 1 SOL. */
async function loadOrAirdropPayer(connection: Connection): Promise<Keypair> {
  if (process.env.KEYPAIR) {
    const fs = await import('node:fs');
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR, 'utf8')));
    return Keypair.fromSecretKey(secret);
  }
  const payer = Keypair.generate();
  console.log(`Generated payer: ${payer.publicKey.toBase58()} (requesting devnet airdrop...)`);
  const airdropSig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: airdropSig, ...bh }, 'confirmed');
  return payer;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
