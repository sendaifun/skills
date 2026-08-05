/**
 * Example: Create a Mint and Mint Tokens
 *
 * This example demonstrates the complete flow:
 *   1. Set up a connection + funded payer (devnet)
 *   2. Create a new mint (6 decimals, payer as mint authority)
 *   3. Create the payer's Associated Token Account (ATA)
 *   4. Mint tokens using mintToChecked (decimals asserted on-chain)
 *   5. Read back the mint info and account balance to verify
 *
 * Run with:
 *   npx tsx examples/create-mint-and-mint-to/example.ts
 *
 * Or compile + run:
 *   tsc && node dist/examples/create-mint-and-mint-to/example.js
 *
 * Requires:
 *   npm install @solana/web3.js @solana/spl-token
 */

import {
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
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
  console.log('=== Create Mint & Mint-To Example ===\n');

  // ── 1. Connection + funded payer ──────────────────────────────
  const connection: Connection = getConnection();
  const payer: Keypair = await loadOrAirdropPayer(connection);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  // ── 2. Create a new mint ───────────────────────────────────────
  // 6 decimals (USDC-style), payer as mint authority, no freeze authority.
  const decimals: number = 6;
  const mint: PublicKey = await createMint(
    connection,
    payer,              // fee payer + signer
    payer.publicKey,   // mint authority
    null,               // freeze authority (null = none)
    decimals,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`\nMint created: ${mint.toBase58()}`);
  console.log(`  Explorer: ${addressLink(mint)}`);

  // ── 3. Create the payer's ATA for this mint ────────────────────
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey, // owner = payer
    false,
    'confirmed',
    undefined,       // confirmOptions
    TOKEN_PROGRAM_ID,
  );
  console.log(`\nATA created: ${ata.address.toBase58()}`);
  console.log(`  Explorer: ${addressLink(ata.address)}`);

  // ── 4. Mint 1,000 tokens using mintToChecked ───────────────────
  // Amount in base units = 1_000 * 10^6 = 1_000_000_000
  const uiAmount: number = 1_000;
  const baseUnits: bigint = BigInt(uiAmount) * 10n ** BigInt(decimals);

  const mintToSignature = await mintToChecked(
    connection,
    payer,             // fee payer
    mint,
    ata.address,      // destination token account
    payer.publicKey,   // mint authority (must sign)
    baseUnits,
    decimals,          // asserted on-chain against the mint's actual decimals
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`\nMint-to confirmed: ${mintToSignature}`);
  console.log(`  Explorer: ${explorerLink(mintToSignature)}`);

  // ── 5. Verify: read mint info + account balance ────────────────
  const mintInfo = await getMint(
    connection,
    mint,
    'confirmed',
    TOKEN_PROGRAM_ID,
  );
  console.log(`\n── Mint Info ──`);
  console.log(`  Decimals: ${mintInfo.decimals}`);
  console.log(`  Supply: ${mintInfo.supply.toString()}`);
  console.log(
    `  Mint authority: ${mintInfo.mintAuthority?.toBase58() ?? 'null (disabled)'}`,
  );
  console.log(
    `  Freeze authority: ${mintInfo.freezeAuthority?.toBase58() ?? 'null (disabled)'}`,
  );

  const accountInfo = await getAccount(
    connection,
    ata.address,
    'confirmed',
    TOKEN_PROGRAM_ID,
  );
  console.log(`\n── Token Account ──`);
  console.log(`  Address: ${accountInfo.address.toBase58()}`);
  console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
  console.log(`  Mint: ${accountInfo.mint.toBase58()}`);
  console.log(`  Amount (raw): ${accountInfo.amount.toString()}`);
  console.log(
    `  Amount (UI): ${Number(accountInfo.amount) / 10 ** mintInfo.decimals}`,
  );
  console.log(`  Frozen: ${accountInfo.isFrozen}`);

  console.log('\n✓ Done. Mint created and tokens minted successfully.');
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});