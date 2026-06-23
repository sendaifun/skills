/**
 * Create a Token-2022 mint with embedded on-chain metadata (no Metaplex),
 * using the MetadataPointer + TokenMetadata extensions.
 *
 * Run on devnet:
 *   npm install @solana/web3.js @solana/spl-token @solana/spl-token-metadata bs58 dotenv
 *   SOLANA_RPC=https://api.devnet.solana.com PRIVATE_KEY=<base58> npx tsx create-token-with-metadata.ts
 *
 * Key subtlety: the account is CREATED with space = mintLen (MetadataPointer only).
 * The TokenMetadata is variable-length and is added by createInitializeInstruction,
 * which reallocs the account. You must fund rent for mintLen + metadataLen up front.
 */
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  getTokenMetadata,
  TYPE_SIZE,
  LENGTH_SIZE,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  pack,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import bs58 from "bs58";
import "dotenv/config";

async function main() {
  const connection = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
  const mint = Keypair.generate();

  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: "Example Token",
    symbol: "EXMPL",
    uri: "https://example.com/metadata.json",
    additionalMetadata: [["category", "demo"]],
  };

  // MetadataPointer goes in the fixed-size mint; TokenMetadata is variable-length.
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;

  // Fund rent for BOTH the mint and the metadata that will be realloc'd in.
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,                 // create with mintLen ONLY; metadata reallocs later
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // Point metadata at the mint itself:
    createInitializeMetadataPointerInstruction(
      mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint.publicKey, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID,
    ),
    // Initialize the embedded metadata LAST (reallocs the account):
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint.publicKey,
      updateAuthority: payer.publicKey,
      mint: mint.publicKey,
      mintAuthority: payer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
  );

  await sendAndConfirmTransaction(connection, tx, [payer, mint]);

  const onchain = await getTokenMetadata(connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log("Mint:", mint.publicKey.toBase58());
  console.log("On-chain metadata:", onchain?.name, onchain?.symbol, onchain?.uri);
  console.log(`Explorer: https://explorer.solana.com/address/${mint.publicKey.toBase58()}?cluster=devnet`);
}

main().catch((e) => { console.error(e); process.exit(1); });
