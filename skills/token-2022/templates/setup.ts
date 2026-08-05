import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
} from '@solana/spl-token';

// ---------------------------------------------------------------------------
// CONFIG — replace placeholders before running.
// ---------------------------------------------------------------------------

// PLACEHOLDER: use 'mainnet-beta' for production. Default to devnet for testing.
export const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

// PLACEHOLDER: load YOUR funded payer keypair instead of generating one.
// e.g. Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('payer.json','utf8'))))
export const payer = Keypair.generate();

/**
 * Build a Token-2022 mint carrying the given fixed-length extensions.
 *
 * Returns the assembled instructions plus the generated mint keypair. The
 * caller signs with [payer, mintKeypair]. Extension init instructions MUST come
 * before createInitializeMintInstruction, which must be last.
 *
 * NOTE: this helper covers fixed-length extensions only. Variable-length
 * extensions (on-chain TokenMetadata) need extra lamports and their own init
 * instruction — see examples/create-mint-with-transfer-fee.
 */
export async function buildToken2022Mint(opts: {
  decimals: number;
  mintAuthority: import('@solana/web3.js').PublicKey;
  freezeAuthority?: import('@solana/web3.js').PublicKey | null;
  extensions: ExtensionType[];
  // Provide one init instruction per extension, in the same order.
  extensionInstructions: TransactionInstruction[];
}): Promise<{ instructions: TransactionInstruction[]; mintKeypair: Keypair }> {
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;

  const mintLen = getMintLen(opts.extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    ...opts.extensionInstructions,
    createInitializeMintInstruction(
      mint,
      opts.decimals,
      opts.mintAuthority,
      opts.freezeAuthority ?? null,
      TOKEN_2022_PROGRAM_ID,
    ),
  ];

  return { instructions, mintKeypair };
}

// Example usage (no extensions): build, sign, send.
export async function example() {
  const { instructions, mintKeypair } = await buildToken2022Mint({
    decimals: 9,
    mintAuthority: payer.publicKey,
    freezeAuthority: payer.publicKey,
    extensions: [],
    extensionInstructions: [],
  });
  const tx = new Transaction().add(...instructions);
  await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
  return mintKeypair.publicKey.toBase58();
}
