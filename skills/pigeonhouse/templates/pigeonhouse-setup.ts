import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

// ── Program & Token Constants ──
export const PIGEON_HOUSE_PROGRAM_ID = new PublicKey("BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL");
export const PIGEON_MINT = new PublicKey("4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump");
export const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const SKR_MINT = new PublicKey("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");

// ── API Base ──
export const API_BASE = "https://941pigeon.fun";

// ── PDA Helpers ──
export function getGlobalConfigPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pigeon_house_config")],
    PIGEON_HOUSE_PROGRAM_ID
  )[0];
}

export function getBondingCurvePDA(tokenMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding_curve"), tokenMint.toBuffer()],
    PIGEON_HOUSE_PROGRAM_ID
  )[0];
}

export function getFeeVaultPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault")],
    PIGEON_HOUSE_PROGRAM_ID
  )[0];
}

export function getQuoteAssetPDA(quoteMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("quote_asset"), quoteMint.toBuffer()],
    PIGEON_HOUSE_PROGRAM_ID
  )[0];
}

// ── API Helpers ──
export async function getTokens() {
  const res = await fetch(`${API_BASE}/api/platform`);
  return res.json();
}

export async function getTokenInfo(mint: string) {
  const res = await fetch(`${API_BASE}/api/token/${mint}`);
  return res.json();
}

export async function getTrades(mint: string, limit = 30) {
  const res = await fetch(`${API_BASE}/api/trades/${mint}?limit=${limit}`);
  return res.json();
}
