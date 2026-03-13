import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

const PROGRAM_ID = new PublicKey("BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL");
const PIGEON_MINT = new PublicKey("4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump");

/**
 * Buy tokens on a PigeonHouse bonding curve.
 * 
 * Fee: 2% of quoteAmount deducted automatically on-chain.
 * - PIGEON pairs: 1.5% burned, 0.5% treasury
 * - SOL/SKR pairs: 1.5% reserve, 0.5% treasury
 */
async function buyTokens(
  connection: Connection,
  payer: Keypair,
  tokenMint: PublicKey,
  quoteAmount: number, // human-readable (e.g., 500 for 500 PIGEON)
  quoteMint: PublicKey = PIGEON_MINT,
  slippageBps: number = 500, // 5% default
  referrer?: PublicKey
) {
  const decimals = quoteMint.equals(PIGEON_MINT) ? 6 : 9; // SOL = 9 dec
  const quoteAmountRaw = new BN(quoteAmount * 10 ** decimals);

  // Calculate expected output for slippage
  // Constant product: tokensOut = (virtualTokenReserves * quoteIn) / (virtualQuoteReserves + quoteIn)
  // minTokensOut = tokensOut * (1 - slippageBps / 10000)

  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding_curve"), tokenMint.toBuffer()],
    PROGRAM_ID
  );

  const quoteTokenProgram = quoteMint.equals(PIGEON_MINT)
    ? TOKEN_2022_PROGRAM_ID
    : new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  // ATAs
  const userQuoteAta = getAssociatedTokenAddressSync(quoteMint, payer.publicKey, false, quoteTokenProgram);
  const userTokenAta = getAssociatedTokenAddressSync(tokenMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const bondingCurveQuoteAta = getAssociatedTokenAddressSync(quoteMint, bondingCurve, true, quoteTokenProgram);
  const bondingCurveTokenAta = getAssociatedTokenAddressSync(tokenMint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);

  // If referrer provided, add as remaining_accounts[0]
  // referrer's quote ATA receives 0.5% fee share

  console.log("Buy:", quoteAmount, "quote →", tokenMint.toBase58());
}

/**
 * Sell tokens back to the bonding curve.
 */
async function sellTokens(
  connection: Connection,
  payer: Keypair,
  tokenMint: PublicKey,
  tokenAmount: number, // human-readable
  quoteMint: PublicKey = PIGEON_MINT
) {
  const tokenAmountRaw = new BN(tokenAmount * 10 ** 6); // all PigeonHouse tokens are 6 dec

  // Constant product: quoteOut = (virtualQuoteReserves * tokenIn) / (virtualTokenReserves + tokenIn)
  // Fee deducted from quoteOut on-chain

  console.log("Sell:", tokenAmount, "tokens →", tokenMint.toBase58());
}
