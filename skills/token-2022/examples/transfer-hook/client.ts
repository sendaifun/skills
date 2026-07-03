/**
 * Token-2022 Transfer Hook — client (web3.js + @solana/spl-token)
 * ===============================================================
 *
 * End-to-end devnet flow for the Anchor program in `lib.rs`:
 *   1. Create a Token-2022 mint with the `TransferHook` extension pointing at the hook program.
 *   2. Send the program's `InitializeExtraAccountMetaList` instruction (raw SPL discriminator) to
 *      write the validation PDA + create the on-chain `Counter`.
 *   3. Create sender + recipient ATAs, mint some tokens.
 *   4. Transfer with `createTransferCheckedWithTransferHookInstruction` — it reads the on-chain
 *      `ExtraAccountMetaList` over RPC and appends the resolved extra accounts (the `Counter`).
 *   5. Read the `Counter` back to prove the hook ran.
 *
 * Why the special transfer builder: a plain `createTransferCheckedInstruction` on a hook mint FAILS
 * with missing accounts, because Token-2022's CPI into the hook needs the resolved extra accounts.
 *
 * Run:  npm i @solana/web3.js@1.98.4 @solana/spl-token@0.4.14 && npx ts-node client.ts
 * Deploy `lib.rs` first (`anchor deploy --provider.cluster devnet`) and paste its program id below.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';

// MUST equal `declare_id!` in lib.rs (run `anchor keys sync`, then paste the id here).
const HOOK_PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

// SPL discriminator for `InitializeExtraAccountMetaList` (= first 8 bytes of
// sha256("spl-transfer-hook-interface:initialize-extra-account-metas")). Our Anchor handler overrides
// its discriminator to this exact value, so the raw instruction below routes straight to it.
const INIT_EXTRA_METAS_DISCRIMINATOR = Buffer.from([43, 34, 13, 49, 167, 88, 235, 235]);

const DECIMALS = 2;

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

  const payer = Keypair.generate(); // fee payer + mint authority
  const recipient = Keypair.generate();
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  // Fund the payer on devnet (rate-limited; for repeat runs reuse a funded keypair).
  const sig = await connection.requestAirdrop(payer.publicKey, 2_000_000_000);
  await connection.confirmTransaction(sig, 'confirmed');

  // --- 1. Create the hook mint ---------------------------------------------------------------------
  // Order: createAccount(getMintLen([TransferHook])) -> initTransferHook -> initializeMint.
  const mintLen = getMintLen([ExtensionType.TransferHook]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Fixed-length extension init BEFORE initializeMint. Point the hook at our program.
    // createInitializeTransferHookInstruction(mint, authority, transferHookProgramId, programId)
    createInitializeTransferHookInstruction(
      mint,
      payer.publicKey, // authority that may later update/clear the hook program
      HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint,
      DECIMALS,
      payer.publicKey, // mint authority
      null, // freeze authority
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createMintTx, [payer, mintKp]);
  console.log('hook mint:', mint.toBase58());

  // --- 2. Initialize the ExtraAccountMetaList + Counter (our program instruction) ------------------
  const [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    HOOK_PROGRAM_ID,
  );
  const [counterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('counter')],
    HOOK_PROGRAM_ID,
  );

  // Account order MUST match the `InitializeExtraAccountMetaList` Accounts struct in lib.rs.
  const initMetasIx = new TransactionInstruction({
    programId: HOOK_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: extraAccountMetaListPda, isSigner: false, isWritable: true }, // extra_account_meta_list
      { pubkey: mint, isSigner: false, isWritable: false }, // mint
      { pubkey: counterPda, isSigner: false, isWritable: true }, // counter
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: INIT_EXTRA_METAS_DISCRIMINATOR, // no args beyond the discriminator
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(initMetasIx), [payer]);
  console.log('validation PDA:', extraAccountMetaListPda.toBase58());

  // --- 3. ATAs + mint --------------------------------------------------------------------------------
  const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const destAta = getAssociatedTokenAddressSync(mint, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);

  const setupTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, sourceAta, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, destAta, recipient.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createMintToCheckedInstruction(
      mint, sourceAta, payer.publicKey, 1000n * 10n ** BigInt(DECIMALS), DECIMALS, [], TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, setupTx, [payer]);

  // --- 4. Transfer through the hook ------------------------------------------------------------------
  // ASYNC: reads the mint's TransferHook program, fetches the on-chain ExtraAccountMetaList, derives
  // the `counter` PDA from its seeds, and appends every resolved account to the instruction.
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    sourceAta,
    mint,
    destAta,
    payer.publicKey, // owner of the source account
    50n * 10n ** BigInt(DECIMALS), // amount: 50 tokens
    DECIMALS,
    [], // multiSigners
    'confirmed',
    TOKEN_2022_PROGRAM_ID,
  );
  await sendAndConfirmTransaction(connection, new Transaction().add(transferIx), [payer]);

  // --- 5. Read the counter back ----------------------------------------------------------------------
  // Counter layout: 8-byte Anchor discriminator, then u64 LE `count`.
  const counterAcc = await connection.getAccountInfo(counterPda);
  const count = counterAcc!.data.readBigUInt64LE(8);
  console.log(`hook ran — transfer count is now ${count}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
