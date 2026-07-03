/**
 * Token-2022 Non-Transferable ("soulbound") mint — create, mint, prove transfer fails
 * ===================================================================================
 *
 * The `NonTransferable` mint extension makes every token of the mint permanently bound to its first
 * holder: `transferChecked` is rejected by the program. The holder can still BURN and CLOSE the
 * account, so they are never trapped — they just can't move tokens to someone else. Use it for
 * credentials, soulbound badges, non-tradeable receipts, or KYC attestations.
 *
 * Notes:
 *   - `NonTransferable` is a MINT extension and is PERMANENT — it can never be removed.
 *   - Token-2022 auto-adds the paired `NonTransferableAccount` marker to each token account; you never
 *     initialize that yourself.
 *   - ATAs created for a non-transferable mint carry `ImmutableOwner` as usual.
 *
 * Run:  npm i @solana/web3.js@1.98.4 @solana/spl-token@0.4.14 && npx ts-node non-transferable.ts
 */
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMintLen,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  createBurnCheckedInstruction,
} from '@solana/spl-token';

const DECIMALS = 0; // a 1-of-1 soulbound badge

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const payer = Keypair.generate(); // holder + mint authority
  const recipient = Keypair.generate();
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const sig = await connection.requestAirdrop(payer.publicKey, 2_000_000_000);
  await connection.confirmTransaction(sig, 'confirmed');

  // --- 1. Create the non-transferable mint ---------------------------------------------------------
  // Order: createAccount(getMintLen([NonTransferable])) -> init non-transferable -> initializeMint.
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
    // createInitializeNonTransferableMintInstruction(mint, programId) — programId is REQUIRED here.
    createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(
      mint, DECIMALS, payer.publicKey /* mint auth */, null /* freeze auth */, TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mintKp]);
  console.log('non-transferable mint:', mint.toBase58());

  // --- 2. Mint 1 token to the holder's ATA ---------------------------------------------------------
  const holderAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, holderAta, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToCheckedInstruction(mint, holderAta, payer.publicKey, 1n, DECIMALS, [], TOKEN_2022_PROGRAM_ID),
    ),
    [payer],
  );
  console.log('minted 1 token to holder ATA:', holderAta.toBase58());

  // --- 3. Attempt to transfer — this MUST fail ------------------------------------------------------
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);
  let transferred = false;
  try {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey, recipientAta, recipient.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        createTransferCheckedInstruction(
          holderAta, mint, recipientAta, payer.publicKey, 1n, DECIMALS, [], TOKEN_2022_PROGRAM_ID,
        ),
      ),
      [payer],
    );
    transferred = true;
  } catch (e) {
    // Token-2022 returns a "NonTransferable" transfer error; the transaction is rejected.
    console.log('expected failure — non-transferable tokens cannot be transferred:');
    console.log('  ', (e as Error).message.split('\n')[0]);
  }
  if (transferred) throw new Error('UNEXPECTED: transfer of a non-transferable token succeeded');

  // --- 4. The holder can still BURN (exit) ---------------------------------------------------------
  // Soulbound does not mean trapped: burn (and close) remain available to the owner.
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createBurnCheckedInstruction(holderAta, mint, payer.publicKey, 1n, DECIMALS, [], TOKEN_2022_PROGRAM_ID),
    ),
    [payer],
  );
  console.log('holder burned the token — burn/close still work even though transfer does not');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
