import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  createTransferCheckedWithFeeInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from '@solana/spl-token-metadata';
import { loadOrAirdropPayer } from '../_shared/util';

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const payer = await loadOrAirdropPayer(connection);
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;

  const decimals = 6;
  const feeBasisPoints = 100; // 1%
  const maxFee = 5_000_000n; // capped at 5 tokens (6 decimals)

  const metadata: TokenMetadata = {
    mint,
    name: 'Token-2022 Demo',
    symbol: 'T22',
    uri: 'https://example.com/metadata.json',
    additionalMetadata: [['category', 'demo']],
  };

  // Fixed-length extensions sized via getMintLen; metadata is variable length.
  const extensions = [ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const createTx = new Transaction().add(
    // 1. Allocate the mint account (mintLen only; metadata realloc happens on init).
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. Initialize each extension BEFORE the mint itself.
    createInitializeMetadataPointerInstruction(mint, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeTransferFeeConfigInstruction(
      mint,
      payer.publicKey, // transfer fee config authority
      payer.publicKey, // withdraw withheld authority
      feeBasisPoints,
      maxFee,
      TOKEN_2022_PROGRAM_ID,
    ),
    // 3. Initialize the mint LAST among the program's own init instructions.
    createInitializeMintInstruction(mint, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    // 4. Write on-chain metadata (metadata account == mint).
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
    createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      field: metadata.additionalMetadata[0][0],
      value: metadata.additionalMetadata[0][1],
    }),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mintKeypair]);

  // Create source + destination ATAs (always pass TOKEN_2022_PROGRAM_ID).
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const destOwner = Keypair.generate().publicKey;
  const dest = getAssociatedTokenAddressSync(mint, destOwner, false, TOKEN_2022_PROGRAM_ID);

  const setupTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      source,
      payer.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID,
    ),
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      dest,
      destOwner,
      mint,
      TOKEN_2022_PROGRAM_ID,
    ),
    createMintToInstruction(mint, source, payer.publicKey, 1_000_000_000n, [], TOKEN_2022_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(connection, setupTx, [payer]);

  // Transfer with the fee computed client-side (fee = amount * bps / 10_000, capped at maxFee).
  const amount = 100_000_000n; // 100 tokens
  const calculated = (amount * BigInt(feeBasisPoints)) / 10_000n;
  const fee = calculated > maxFee ? maxFee : calculated;
  const transferTx = new Transaction().add(
    createTransferCheckedWithFeeInstruction(
      source,
      mint,
      dest,
      payer.publicKey,
      amount,
      decimals,
      fee,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, transferTx, [payer]);

  // Harvest withheld fees from token accounts back to the mint, then withdraw to a destination.
  const harvestTx = new Transaction().add(
    createHarvestWithheldTokensToMintInstruction(mint, [dest], TOKEN_2022_PROGRAM_ID),
    createWithdrawWithheldTokensFromMintInstruction(
      mint,
      source, // fee destination ATA
      payer.publicKey, // withdraw withheld authority
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, harvestTx, [payer]);

  console.log('Mint with transfer fee + metadata:', mint.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
