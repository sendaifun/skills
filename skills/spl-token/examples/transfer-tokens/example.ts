/**
 * Example: Transfer Tokens with transferChecked
 *
 * This example demonstrates the complete transfer flow:
 *   1. Set up a connection + funded payer (devnet)
 *   2. Create a mint and mint tokens to the payer's ATA
 *   3. Generate a recipient keypair + create their ATA (idempotent)
 *   4. Transfer tokens using transferChecked (decimals asserted on-chain)
 *   5. Verify both balances after the transfer
 *
 * Run with:
 *   npx tsx examples/transfer-tokens/example.ts
 *
 * Or compile + run:
 *   tsc && node dist/examples/transfer-tokens/example.js
 *
 * Requires:
 *   npm install @solana/web3.js @solana/spl-token
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  mintToChecked,
  transferChecked,
  getMint,
  getAccount,
} from '@solana/spl-token';

import {
  getConnection,
  loadOrAirdropPayer,
  explorerLink,
  addressLink,
} from '../_shared/util';

async function main(): Promise<void> {
  console.log('=== Transfer Tokens (transferChecked) Example ===\n');

  // ── 1. Connection + funded payer ──────────────────────────────
  const connection: Connection = getConnection();
  const payer: Keypair = await loadOrAirdropPayer(connection);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  // ── 2. Create a mint + mint tokens to payer ───────────────────
  const decimals: number = 6;
  const mint: PublicKey = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority
    null,            // freeze authority
    decimals,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`\nMint: ${mint.toBase58()}`);

  // Create payer ATA and mint 10,000 tokens.
  const payerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
    false,
    'confirmed',
    undefined,       // confirmOptions
    TOKEN_PROGRAM_ID,
  );

  const mintAmount: bigint = BigInt(10_000) * 10n ** BigInt(decimals);
  await mintToChecked(
    connection,
    payer,
    mint,
    payerAta.address,
    payer.publicKey, // mint authority
    mintAmount,
    decimals,
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`Minted ${Number(mintAmount) / 10 ** decimals} tokens to payer ATA.`);

  // ── 3. Create recipient + their ATA ───────────────────────────
  const recipient: Keypair = Keypair.generate();
  console.log(`\nRecipient: ${recipient.publicKey.toBase58()}`);

  const recipientAta: PublicKey = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );

  // Create recipient ATA (idempotent — safe even if it already exists).
  const createAtaTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      recipientAta,
      recipient.publicKey,
      mint,
      TOKEN_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createAtaTx, [payer]);
  console.log(`Recipient ATA created: ${recipientAta.toBase58()}`);

  // ── 4. Transfer tokens using transferChecked ──────────────────
  // Transfer 2,500 tokens = 2_500 * 10^6 = 2_500_000_000 base units.
  const transferAmount: bigint = BigInt(2_500) * 10n ** BigInt(decimals);

  // The payer owns the source ATA and is the signer.
  // In a real app, the source owner would sign, not the payer.
  // Here, payer = source owner for simplicity.
  const transferSignature = await transferChecked(
    connection,
    payer,               // fee payer
    payerAta.address,    // source token account
    mint,
    recipientAta,        // destination token account
    payer.publicKey,     // owner of source (must sign)
    transferAmount,
    decimals,            // asserted on-chain
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`\nTransfer confirmed: ${transferSignature}`);
  console.log(`  Explorer: ${explorerLink(transferSignature)}`);

  // ── 5. Verify: read mint + both account balances ──────────────
  const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);

  const payerBalance = await getAccount(
    connection,
    payerAta.address,
    'confirmed',
    TOKEN_PROGRAM_ID,
  );
  const recipientBalance = await getAccount(
    connection,
    recipientAta,
    'confirmed',
    TOKEN_PROGRAM_ID,
  );

  console.log(`\n── Results ──`);
  console.log(`Mint decimals: ${mintInfo.decimals}`);
  console.log(`Mint supply: ${mintInfo.supply.toString()}`);
  console.log(
    `Payer balance: ${payerBalance.amount.toString()} ` +
      `(${Number(payerBalance.amount) / 10 ** mintInfo.decimals} UI)`,
  );
  console.log(
    `Recipient balance: ${recipientBalance.amount.toString()} ` +
      `(${Number(recipientBalance.amount) / 10 ** mintInfo.decimals} UI)`,
  );

  // Verify the math:
  const expectedPayer = mintAmount - transferAmount;
  if (payerBalance.amount !== expectedPayer) {
    throw new Error(
      `Balance mismatch! Expected ${expectedPayer}, got ${payerBalance.amount}`,
    );
  }
  if (recipientBalance.amount !== transferAmount) {
    throw new Error(
      `Recipient balance mismatch! Expected ${transferAmount}, got ${recipientBalance.amount}`,
    );
  }

  console.log('\n✓ Done. Transfer verified — balances match expected values.');
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});