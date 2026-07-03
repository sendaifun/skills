/**
 * transfer-fees.ts — Full lifecycle of the Token-2022 TransferFee extension.
 *
 * Demonstrates:
 *   1. Creating a mint with TransferFeeConfig (bps + per-transfer cap).
 *   2. Minting to a holder, then `createTransferCheckedWithFeeInstruction` transfers
 *      that WITHHOLD the fee on the RECIPIENT's account (not the sender's).
 *   3. Reading the withheld amount off a recipient account (`getTransferFeeAmount`).
 *   4. BOTH withdrawal paths for the `withdrawWithheldAuthority`:
 *        Path A (1 step):  createWithdrawWithheldTokensFromAccountsInstruction
 *                          — pull withheld fees straight from recipient accounts.
 *        Path B (2 steps): createHarvestWithheldTokensToMintInstruction (PERMISSIONLESS;
 *                          anyone can sweep withheld fees from accounts to the mint)
 *                          then createWithdrawWithheldTokensFromMintInstruction
 *                          — pull the accumulated fees off the mint.
 *
 * Key facts:
 *   - The fee is withheld on the DESTINATION token account as it receives a transfer.
 *   - fee = min(amount * basisPoints / 10_000, maximumFee), computed in base units.
 *   - You MUST use createTransferCheckedWithFeeInstruction on a fee mint; a plain
 *     transferChecked can fail / mis-account the withheld amount.
 *   - Harvest is permissionless; withdraws require the withdrawWithheldAuthority to sign.
 *
 * --- Run (devnet) ---
 *   npm i @solana/spl-token@0.4.14 @solana/web3.js@1.98.4
 *   npm i -D typescript tsx @types/node          # Node 20+
 *   npx tsx transfer-fees.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMintLen,
  getAccount,
  getAssociatedTokenAddressSync,
  getTransferFeeAmount,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  createWithdrawWithheldTokensFromAccountsInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
} from '@solana/spl-token';

const DECIMALS = 6;
const FEE_BASIS_POINTS = 100; // 1%
const MAXIMUM_FEE = 5_000_000n; // cap = 5 tokens (at 6 decimals); transfers below stay at 1%
const ONE_TOKEN = 1_000_000n; // 1.0 token in base units

/** fee = min(amount * bps / 10_000, maximumFee) — all in base units. */
function calcFee(amount: bigint): bigint {
  const fee = (amount * BigInt(FEE_BASIS_POINTS)) / 10_000n;
  return fee > MAXIMUM_FEE ? MAXIMUM_FEE : fee;
}

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

  // payer = fee payer + mint authority + transferFeeConfigAuthority + withdrawWithheldAuthority.
  // payer also owns the "fee vault" ATA that collected fees are withdrawn into.
  const payer = await loadOrAirdropPayer(connection);

  const alice = Keypair.generate(); // token holder / sender (signs transfers; needs no SOL)
  const bob = Keypair.generate(); // recipient #1
  const carol = Keypair.generate(); // recipient #2

  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  // ---------------------------------------------------------------------------
  // 1. Create the fee mint: createAccount -> initTransferFeeConfig -> initializeMint.
  //    (Same ordering rule as every Token-2022 mint; see examples/create-mint-with-extensions.)
  // ---------------------------------------------------------------------------
  const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      mint,
      payer.publicKey, // transferFeeConfigAuthority
      payer.publicKey, // withdrawWithheldAuthority
      FEE_BASIS_POINTS,
      MAXIMUM_FEE,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint,
      DECIMALS,
      payer.publicKey, // mint authority
      null, // no freeze authority
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createMintTx, [payer, mintKp]);
  console.log(`Fee mint: ${mint.toBase58()} (${FEE_BASIS_POINTS} bps, cap ${MAXIMUM_FEE})`);

  // ---------------------------------------------------------------------------
  // 2. Derive ATAs (always under TOKEN_2022_PROGRAM_ID) and create them idempotently.
  //    feeVault = payer's ATA, the destination for withdrawn fees.
  // ---------------------------------------------------------------------------
  const feeVault = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const aliceAta = getAssociatedTokenAddressSync(mint, alice.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const bobAta = getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const carolAta = getAssociatedTokenAddressSync(mint, carol.publicKey, false, TOKEN_2022_PROGRAM_ID);

  const setupTx = new Transaction().add(
    ...[
      [feeVault, payer.publicKey],
      [aliceAta, alice.publicKey],
      [bobAta, bob.publicKey],
      [carolAta, carol.publicKey],
    ].map(([ata, owner]) =>
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        ata,
        owner,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    ),
    // Mint 1000 tokens to Alice so she has something to send.
    createMintToCheckedInstruction(
      mint,
      aliceAta,
      payer.publicKey, // mint authority
      1_000n * ONE_TOKEN,
      DECIMALS,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, setupTx, [payer]);

  // ---------------------------------------------------------------------------
  // 3. Alice transfers 100 tokens to Bob and 100 to Carol, fee withheld on each
  //    RECIPIENT. Use createTransferCheckedWithFeeInstruction with the explicit fee.
  // ---------------------------------------------------------------------------
  const sendAmount = 100n * ONE_TOKEN;
  const fee = calcFee(sendAmount); // 1% of 100 = 1 token (under the 5-token cap)
  console.log(`\nTransferring ${sendAmount} base units each; fee = ${fee} base units per transfer`);

  const transferTx = new Transaction().add(
    createTransferCheckedWithFeeInstruction(
      aliceAta,
      mint,
      bobAta,
      alice.publicKey, // owner of the source account (signer)
      sendAmount,
      DECIMALS,
      fee,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
    createTransferCheckedWithFeeInstruction(
      aliceAta,
      mint,
      carolAta,
      alice.publicKey,
      sendAmount,
      DECIMALS,
      fee,
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  // Alice signs because she owns the source ATA; payer covers the network fee.
  await sendAndConfirmTransaction(connection, transferTx, [payer, alice]);

  // Bob/Carol each received (sendAmount - fee); the fee sits "withheld" on their accounts.
  await logWithheld(connection, 'Bob', bobAta);
  await logWithheld(connection, 'Carol', carolAta);

  // ---------------------------------------------------------------------------
  // 4a. PATH A — withdraw withheld fees DIRECTLY from accounts (Bob) to the fee vault.
  //     Only the withdrawWithheldAuthority (payer) can do this.
  // ---------------------------------------------------------------------------
  const withdrawFromAccountsTx = new Transaction().add(
    createWithdrawWithheldTokensFromAccountsInstruction(
      mint,
      feeVault, // destination
      payer.publicKey, // withdrawWithheldAuthority (signer)
      [], // multisig signers
      [bobAta], // source accounts to drain
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, withdrawFromAccountsTx, [payer]);
  console.log('\nPath A: withdrew Bob\'s withheld fees straight to the fee vault.');
  await logWithheld(connection, 'Bob (after)', bobAta);

  // ---------------------------------------------------------------------------
  // 4b. PATH B — two-step: harvest Carol's withheld fees to the MINT (permissionless),
  //     then withdraw from the mint to the fee vault (authority required).
  // ---------------------------------------------------------------------------
  const harvestTx = new Transaction().add(
    // Permissionless: anyone can sweep withheld fees from accounts onto the mint.
    // Useful for cranking many accounts; the payer here just pays the network fee.
    createHarvestWithheldTokensToMintInstruction(mint, [carolAta], TOKEN_2022_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(connection, harvestTx, [payer]);
  console.log('\nPath B (step 1): harvested Carol\'s withheld fees onto the mint.');
  await logWithheld(connection, 'Carol (after harvest)', carolAta);

  const withdrawFromMintTx = new Transaction().add(
    createWithdrawWithheldTokensFromMintInstruction(
      mint,
      feeVault, // destination
      payer.publicKey, // withdrawWithheldAuthority (signer)
      [], // multisig signers
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, withdrawFromMintTx, [payer]);
  console.log('Path B (step 2): withdrew the mint\'s accumulated fees to the fee vault.');

  // ---------------------------------------------------------------------------
  // 5. Final accounting: the fee vault should hold the total collected fees (2 * fee).
  // ---------------------------------------------------------------------------
  const vault = await getAccount(connection, feeVault, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log(`\nFee vault balance: ${vault.amount} base units (expected ${2n * fee})`);
}

/** Read and log a token account's withheld-fee accumulator. */
async function logWithheld(connection: Connection, label: string, ata: PublicKey) {
  const account = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const transferFeeAmount = getTransferFeeAmount(account); // null if the extension is absent
  console.log(
    `${label}: balance=${account.amount} withheld=${transferFeeAmount?.withheldAmount ?? 0n}`,
  );
}

/** Devnet helper: KEYPAIR (JSON secret-key path) or generate + airdrop 2 SOL. */
async function loadOrAirdropPayer(connection: Connection): Promise<Keypair> {
  if (process.env.KEYPAIR) {
    const fs = await import('node:fs');
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR, 'utf8')));
    return Keypair.fromSecretKey(secret);
  }
  const payer = Keypair.generate();
  console.log(`Generated payer: ${payer.publicKey.toBase58()} (requesting devnet airdrop...)`);
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: airdropSig, ...bh }, 'confirmed');
  return payer;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
