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
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import { loadOrAirdropPayer } from '../_shared/util';

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const payer = await loadOrAirdropPayer(connection);
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const decimals = 0;

  // Size the account for the NonTransferable extension.
  const mintLen = getMintLen([ExtensionType.NonTransferable]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Extension init BEFORE the mint init.
    createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mintKeypair]);

  // Mint exactly one soulbound token to the holder.
  const holder = payer.publicKey;
  const holderAta = getAssociatedTokenAddressSync(mint, holder, false, TOKEN_2022_PROGRAM_ID);
  const mintTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      holderAta,
      holder,
      mint,
      TOKEN_2022_PROGRAM_ID,
    ),
    createMintToInstruction(mint, holderAta, payer.publicKey, 1n, [], TOKEN_2022_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(connection, mintTx, [payer]);

  // Attempting to transfer a non-transferable token fails on-chain.
  const recipient = Keypair.generate().publicKey;
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_2022_PROGRAM_ID);
  try {
    const transferTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        recipientAta,
        recipient,
        mint,
        TOKEN_2022_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(
        holderAta,
        mint,
        recipientAta,
        holder,
        1n,
        decimals,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, transferTx, [payer]);
    console.error('ERROR: transfer unexpectedly succeeded');
  } catch (err) {
    // Expected: the program rejects transfers of a NonTransferable mint.
    console.log('Transfer correctly rejected (soulbound):', (err as Error).message);
  }

  console.log('Soulbound mint:', mint.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
