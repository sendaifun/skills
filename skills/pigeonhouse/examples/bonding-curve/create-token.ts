import { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";

const PROGRAM_ID = new PublicKey("BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL");
const PIGEON_MINT = new PublicKey("4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump");
const METAPLEX_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

async function createToken(
  connection: Connection,
  payer: Keypair,
  name: string,
  symbol: string,
  uri: string,
  quoteMint: PublicKey = PIGEON_MINT
) {
  const mint = Keypair.generate();

  // Derive PDAs
  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pigeon_house_config")],
    PROGRAM_ID
  );
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding_curve"), mint.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [feeVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault")],
    PROGRAM_ID
  );
  const [quoteAssetConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("quote_asset"), quoteMint.toBuffer()],
    PROGRAM_ID
  );
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_METADATA_PROGRAM.toBuffer(), mint.publicKey.toBuffer()],
    METAPLEX_METADATA_PROGRAM
  );

  // Determine token program for quote (PIGEON = Token-2022, SOL/SKR = SPL Token)
  const quoteTokenProgram = quoteMint.equals(PIGEON_MINT)
    ? TOKEN_2022_PROGRAM_ID
    : new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  // ATAs owned by bonding curve PDA
  const bondingCurveTokenAta = getAssociatedTokenAddressSync(
    mint.publicKey, bondingCurve, true, TOKEN_2022_PROGRAM_ID
  );
  const bondingCurveQuoteAta = getAssociatedTokenAddressSync(
    quoteMint, bondingCurve, true, quoteTokenProgram
  );

  // Build and send transaction using Anchor
  // Note: Load IDL from https://941pigeon.fun/idl/pigeon_house.json
  console.log("Token mint:", mint.publicKey.toBase58());
  console.log("Bonding curve:", bondingCurve.toBase58());

  return { mint: mint.publicKey, bondingCurve };
}
