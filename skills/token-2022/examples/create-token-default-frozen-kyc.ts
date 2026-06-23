/**
 * Create a Token-2022 mint whose token accounts are FROZEN by default (a KYC / allowlist
 * pattern), then demonstrate the thaw flow that gates usage on approval.
 *
 * Run on devnet:
 *   npm install @solana/web3.js @solana/spl-token bs58 dotenv
 *   SOLANA_RPC=https://api.devnet.solana.com PRIVATE_KEY=<base58> npx tsx create-token-default-frozen-kyc.ts
 *
 * PRIVATE_KEY must be a base58-encoded, devnet-funded keypair. Use a throwaway wallet.
 *
 * Footgun shown: with DefaultAccountState=Frozen, EVERY newly created token account starts
 * Frozen. mintTo / transfers into it FAIL until the freeze authority thaws it. A mint with
 * this extension MUST have a freeze authority — InitializeMint with a null freeze authority
 * would make the token permanently unusable.
 */
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  AccountState,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeDefaultAccountStateInstruction,
  createAssociatedTokenAccountIdempotent,
  getAccount,
  mintTo,
  thawAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import "dotenv/config";

const DECIMALS = 6;

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
    "confirmed",
  );
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
  const mint = Keypair.generate();
  // The freeze authority gates KYC: only it can thaw (approve) accounts.
  const freezeAuthority = payer;

  // 1. Size for DefaultAccountState and build in strict order.
  const extensions = [ExtensionType.DefaultAccountState];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Extension init BEFORE InitializeMint. New token accounts will start Frozen.
    createInitializeDefaultAccountStateInstruction(
      mint.publicKey,
      AccountState.Frozen,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint.publicKey,
      DECIMALS,
      payer.publicKey, // mint authority
      freezeAuthority.publicKey, // freeze authority REQUIRED for DefaultAccountState=Frozen
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mint]);
  console.log("Mint (default-frozen):", mint.publicKey.toBase58());

  // 2. Create a holder ATA — it is created FROZEN.
  const holder = Keypair.generate();
  const ata = await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mint.publicKey,
    holder.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID,
  );
  let acct = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`New ATA isFrozen=${acct.isFrozen} (expected true — pre-KYC)`);

  // 3. mintTo BEFORE thaw fails because the account is frozen.
  try {
    await mintTo(
      connection, payer, mint.publicKey, ata, payer,
      BigInt(10 * 10 ** DECIMALS), [], undefined, TOKEN_2022_PROGRAM_ID,
    );
    console.log("Unexpected: mintTo succeeded while frozen.");
  } catch {
    console.log("Expected: mintTo FAILED because the ATA is frozen (pre-KYC).");
  }

  // 4. KYC approved -> the freeze authority thaws the account.
  await thawAccount(
    connection, payer, ata, mint.publicKey, freezeAuthority,
    [], undefined, TOKEN_2022_PROGRAM_ID,
  );
  acct = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`After thaw: isFrozen=${acct.isFrozen} (expected false)`);

  // 5. Now mintTo works.
  await mintTo(
    connection, payer, mint.publicKey, ata, payer,
    BigInt(10 * 10 ** DECIMALS), [], undefined, TOKEN_2022_PROGRAM_ID,
  );
  acct = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`Minted; balance: ${acct.amount}`);
  console.log(
    `Explorer: https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
