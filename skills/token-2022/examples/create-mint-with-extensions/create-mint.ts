/**
 * create-mint.ts — Create a Token-2022 mint with MetadataPointer + TransferFee
 * extensions and in-mint TokenMetadata, demonstrating THE CRITICAL INIT ORDER.
 *
 * This is the centerpiece pattern of the token-2022 skill. The order is mandatory:
 *
 *   1. SystemProgram.createAccount  -> space = getMintLen([FIXED extensions])
 *   2. init each FIXED-length extension  (MetadataPointer, TransferFeeConfig — any order)
 *   3. createInitializeMintInstruction   (LAST mint-setup step — "seals" the layout)
 *   4. createInitializeInstruction       (variable-length TokenMetadata — AFTER initializeMint)
 *
 * Get this order wrong and `InitializeMint` fails with `InvalidAccountData`, because
 * initializing the mint rejects any later extension init and rejects an account whose
 * size doesn't match the declared fixed extensions. See SKILL.md > "Creating a mint
 * with extensions — THE CRITICAL ORDER".
 *
 * Rent note: getMintLen() sizes ONLY fixed-length extensions. TokenMetadata is
 * variable-length, so we size the account at `mintLen` but FUND lamports for
 * `mintLen + metadataLen`; the metadata init reallocs the mint to add the data.
 *
 * --- Run (devnet) ---
 *   npm i @solana/spl-token@0.4.14 @solana/spl-token-metadata@0.1.6 @solana/web3.js@1.98.4
 *   npm i -D typescript tsx @types/node          # Node 20+
 *   npx tsx create-mint.ts
 *
 * The script generates and airdrops a fresh payer on devnet. Airdrops are rate-limited;
 * if it fails, fund the printed payer address from https://faucet.solana.com and re-run,
 * or set a funded keypair path in the KEYPAIR env var (handled below).
 */

import {
  Connection,
  Keypair,
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
  getMint,
  getTransferFeeConfig,
  getTokenMetadata,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferFeeConfigInstruction,
  TYPE_SIZE,
  LENGTH_SIZE,
} from '@solana/spl-token';
import {
  createInitializeInstruction,
  pack,
  type TokenMetadata,
} from '@solana/spl-token-metadata';

const DECIMALS = 6;
const FEE_BASIS_POINTS = 50; // 50 bps = 0.5%
const MAXIMUM_FEE = 5_000n; // cap per transfer, in base units (0.005 token at 6 decimals)

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

  // Payer also acts as mint authority, freeze authority, metadata update authority,
  // transfer-fee config authority, and withdraw-withheld authority for this demo.
  const payer = await loadOrAirdropPayer(connection);

  // The mint is a brand-new account we allocate ourselves (NOT a PDA).
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  // ---------------------------------------------------------------------------
  // 1. Build the metadata blob. The mint points to ITSELF as its metadata account
  //    (the most common pattern: no separate metadata account, no Metaplex).
  // ---------------------------------------------------------------------------
  const metadata: TokenMetadata = {
    mint,
    name: 'Example Token',
    symbol: 'EXMPL',
    uri: 'https://example.com/token.json',
    // Arbitrary extra key/value pairs. These add to the on-chain size, so they must
    // be counted in the rent below (pack() handles that for us).
    additionalMetadata: [['category', 'stablecoin']],
  };

  // ---------------------------------------------------------------------------
  // 2. Size the account. getMintLen() counts ONLY the fixed-length extensions.
  //    TokenMetadata (variable-length) is sized separately and added to the rent.
  // ---------------------------------------------------------------------------
  const extensions = [ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  // TLV entry for the metadata = 2-byte type + 2-byte length + the packed value.
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  console.log(`mintLen (fixed exts only) = ${mintLen} bytes`);
  console.log(`metadataLen              = ${metadataLen} bytes`);
  console.log(`rent-exempt lamports     = ${lamports} (covers mintLen + metadataLen)`);

  // ---------------------------------------------------------------------------
  // 3. Assemble the single transaction in the MANDATORY order.
  // ---------------------------------------------------------------------------
  const tx = new Transaction().add(
    // (a) Allocate the mint account. space = mintLen (fixed exts only); the rent we
    //     funded above already covers the larger post-metadata size.
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID, // the account is owned by Token-2022
    }),

    // (b) FIXED-length extension inits — BEFORE initializeMint, in any order.
    createInitializeMetadataPointerInstruction(
      mint,
      payer.publicKey, // metadata update authority
      mint, // metadata account = the mint itself (self-pointer)
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeTransferFeeConfigInstruction(
      mint,
      payer.publicKey, // transferFeeConfigAuthority — can later change the fee
      payer.publicKey, // withdrawWithheldAuthority — can harvest/withdraw fees
      FEE_BASIS_POINTS,
      MAXIMUM_FEE,
      TOKEN_2022_PROGRAM_ID,
    ),

    // (c) Initialize the mint — LAST of the mint-setup steps. This seals the layout.
    //     NOTE: programId defaults to LEGACY Token; pass TOKEN_2022_PROGRAM_ID explicitly.
    createInitializeMintInstruction(
      mint,
      DECIMALS,
      payer.publicKey, // mint authority
      payer.publicKey, // freeze authority (pass null to make the mint un-freezable)
      TOKEN_2022_PROGRAM_ID,
    ),

    // (d) Variable-length TokenMetadata — the ONLY init that runs AFTER initializeMint.
    //     This reallocs the mint to hold the name/symbol/uri data.
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint, // write metadata into the mint (matches the self-pointer above)
      updateAuthority: payer.publicKey,
      mint,
      mintAuthority: payer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      // Note: createInitializeInstruction only sets name/symbol/uri. additionalMetadata
      // entries are added afterward with createUpdateFieldInstruction (see examples/metadata).
    }),
  );

  // The mint keypair must sign because we are creating its account.
  const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintKp]);
  console.log(`\nMint created: ${mint.toBase58()}`);
  console.log(`Signature:    ${sig}`);
  console.log(`Explorer:     https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`);

  // ---------------------------------------------------------------------------
  // 4. Read everything back to prove the extensions are live on-chain.
  // ---------------------------------------------------------------------------
  const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const feeConfig = getTransferFeeConfig(mintInfo); // null if no transfer fee
  const onChainMeta = await getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);

  console.log('\n--- Read-back ---');
  console.log(`decimals: ${mintInfo.decimals}`);
  if (feeConfig) {
    const { transferFeeBasisPoints, maximumFee } = feeConfig.newerTransferFee;
    console.log(`transfer fee: ${transferFeeBasisPoints} bps, cap ${maximumFee} base units`);
  }
  if (onChainMeta) {
    console.log(`metadata: ${onChainMeta.name} (${onChainMeta.symbol}) -> ${onChainMeta.uri}`);
    console.log(`additionalMetadata:`, onChainMeta.additionalMetadata);
  }
}

/**
 * Devnet helper: reuse a funded keypair if KEYPAIR points to a JSON secret-key file,
 * otherwise generate a fresh payer and airdrop 1 SOL. Airdrops are rate-limited on
 * devnet — fund the printed address manually and re-run if the airdrop throttles.
 */
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
