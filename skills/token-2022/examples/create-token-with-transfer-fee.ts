/**
 * Create a Token-2022 mint with a 1% transfer fee (capped at 1 token),
 * mint some supply, transfer with transferChecked, then harvest + withdraw fees.
 *
 * Run on devnet:
 *   npm install @solana/web3.js @solana/spl-token bs58 dotenv
 *   SOLANA_RPC=https://api.devnet.solana.com PRIVATE_KEY=<base58> npx tsx create-token-with-transfer-fee.ts
 *
 * PRIVATE_KEY must be a base58-encoded, devnet-funded keypair. Use a throwaway wallet.
 */
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountIdempotent,
  mintTo,
  transferCheckedWithFee,
  getOrCreateAssociatedTokenAccount,
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
} from "@solana/spl-token";
import bs58 from "bs58";
import "dotenv/config";

const DECIMALS = 6;
const FEE_BASIS_POINTS = 100;             // 1%
const MAX_FEE = BigInt(1 * 10 ** DECIMALS); // cap at 1 token

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
  const mint = Keypair.generate();

  // 1. Size the mint account for the TransferFeeConfig extension.
  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  // 2. Build in strict order: createAccount -> initialize extension -> initialize mint.
  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      mint.publicKey,
      payer.publicKey,          // transfer fee config authority
      payer.publicKey,          // withdraw withheld authority
      FEE_BASIS_POINTS,
      MAX_FEE,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint.publicKey, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mint]);
  console.log("Mint:", mint.publicKey.toBase58());

  // 3. Create source + destination ATAs (must pass TOKEN_2022_PROGRAM_ID).
  const source = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint.publicKey, payer.publicKey, false, "confirmed",
    undefined, TOKEN_2022_PROGRAM_ID,
  );
  const recipient = Keypair.generate();
  const dest = await createAssociatedTokenAccountIdempotent(
    connection, payer, mint.publicKey, recipient.publicKey, {}, TOKEN_2022_PROGRAM_ID,
  );

  // 4. Mint 1000 tokens to source.
  await mintTo(
    connection, payer, mint.publicKey, source.address, payer, BigInt(1000 * 10 ** DECIMALS),
    [], undefined, TOKEN_2022_PROGRAM_ID,
  );

  // 5. Transfer 100 tokens. On a fee mint you MUST use transferChecked / transferCheckedWithFee.
  const amount = BigInt(100 * 10 ** DECIMALS);
  const fee = (amount * BigInt(FEE_BASIS_POINTS)) / BigInt(10_000);
  const cappedFee = fee > MAX_FEE ? MAX_FEE : fee;
  await transferCheckedWithFee(
    connection, payer, source.address, mint.publicKey, dest, payer,
    amount, DECIMALS, cappedFee, [], undefined, TOKEN_2022_PROGRAM_ID,
  );
  console.log(`Transferred 100 tokens; fee withheld on recipient: ${cappedFee}`);

  // 6. Harvest withheld fees to the mint, then withdraw to the authority's ATA.
  await harvestWithheldTokensToMint(connection, payer, mint.publicKey, [dest], undefined, TOKEN_2022_PROGRAM_ID);
  await withdrawWithheldTokensFromMint(
    connection, payer, mint.publicKey, source.address, payer, [], undefined, TOKEN_2022_PROGRAM_ID,
  );
  console.log("Fees harvested and withdrawn.");
  console.log(`Explorer: https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`);
}

main().catch((e) => { console.error(e); process.exit(1); });
