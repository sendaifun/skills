import { PublicKey } from "@solana/web3.js";

/**
 * Graduation: When a token's bonding curve reserve reaches the graduation threshold,
 * it auto-migrates to Raydium CPMM with locked LP.
 * 
 * This is permissionless — anyone can call graduate once threshold is met.
 * 
 * Post-graduation:
 * - Bonding curve is frozen (no more buys/sells)
 * - Raydium CPMM pool is created with remaining reserves
 * - LP tokens are locked (sent to dead address)
 * - Mint authority is revoked (no more minting)
 * - Token trades freely on Raydium
 * - Creator receives 1.20% Raydium CPMM creator fee on all trades
 */

const RAYDIUM_CPMM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
const RAYDIUM_AMM_CONFIG = new PublicKey("61GwTFRpjM3emvpnNoMT54oKnTbbGAhQm7DkNchAyDhP"); // index 12, 0.30% trade + 1.20% creator

/**
 * Check if a token is ready to graduate.
 */
async function checkGraduation(bondingCurveData: any): Promise<boolean> {
  // graduation happens when pigeon_reserves >= graduation_pigeon_amount
  return bondingCurveData.pigeonReserves >= bondingCurveData.graduationPigeonAmount;
}

/**
 * Graduate instruction requires ~27 accounts including:
 * - Raydium CPMM accounts (pool, vaults, LP mint, observation)
 * - Token mints and ATAs
 * - bonding_curve PDA as signer
 * - Dead wallet for LP lock
 * 
 * See IDL for full account list: https://941pigeon.fun/idl/pigeon_house.json
 */
