/**
 * Token-2022 Interest-Bearing mint — create, mint, and read UI amount vs raw amount
 * =================================================================================
 *
 * The `InterestBearingConfig` extension makes a mint's *displayed* (UI) amount accrue continuous,
 * compounding interest: uiAmount = rawAmount / 10^decimals * e^(rate * t). It is PURELY COSMETIC —
 * no tokens are minted, the on-chain supply never changes, and balances/transfers still operate on
 * the raw base-unit amount. Use it for bonds, yield-bearing stablecoins, or rebasing displays.
 *
 *   rate = signed basis points per year (i16). 500 = +5%/yr, -250 = -2.5%/yr.
 *
 * This script shows the difference between the raw stored amount and the interest-adjusted UI amount,
 * both "now" (≈ no time elapsed) and projected one year forward.
 *
 * Run:  npm i @solana/web3.js@1.98.4 @solana/spl-token@0.4.14 && npx ts-node interest-bearing.ts
 */
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMintLen,
  getMint,
  getInterestBearingMintConfigState,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createInitializeInterestBearingMintInstruction,
  createUpdateRateInterestBearingMintInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  amountToUiAmount,
  amountToUiAmountForInterestBearingMintWithoutSimulation,
} from '@solana/spl-token';

const DECIMALS = 6;
const RATE_BPS = 500; // +5% per year (i16)

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const payer = Keypair.generate();
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const sig = await connection.requestAirdrop(payer.publicKey, 2_000_000_000);
  await connection.confirmTransaction(sig, 'confirmed');

  // --- 1. Create the interest-bearing mint ---------------------------------------------------------
  // Order: createAccount(getMintLen([InterestBearingConfig])) -> init interest config -> initializeMint.
  const mintLen = getMintLen([ExtensionType.InterestBearingConfig]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // createInitializeInterestBearingMintInstruction(mint, rateAuthority, rate, programId?)
    createInitializeInterestBearingMintInstruction(
      mint,
      payer.publicKey, // rate authority — may later call createUpdateRate...
      RATE_BPS,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mint, DECIMALS, payer.publicKey /* mint auth */, null /* freeze auth */, TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendAndConfirmTransaction(connection, createTx, [payer, mintKp]);
  console.log('interest-bearing mint:', mint.toBase58());

  // --- 2. Mint 1,000 tokens (raw = 1000 * 10^6) ----------------------------------------------------
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const rawAmount = 1000n * 10n ** BigInt(DECIMALS);

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey, ata, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToCheckedInstruction(
        mint, ata, payer.publicKey, rawAmount, DECIMALS, [], TOKEN_2022_PROGRAM_ID,
      ),
    ),
    [payer],
  );

  // --- 3. Raw amount vs UI amount ------------------------------------------------------------------
  // Raw: exactly what is stored on-chain (never changes from interest).
  console.log('raw stored amount   :', rawAmount.toString(), `(= ${Number(rawAmount) / 10 ** DECIMALS} tokens)`);

  // UI amount NOW: `amountToUiAmount` simulates the mint's amount_to_ui_amount with the current clock.
  // Just after creation ~no time has elapsed, so this is ≈ 1000.000000.
  const uiNow = await amountToUiAmount(connection, payer, mint, rawAmount, TOKEN_2022_PROGRAM_ID);
  console.log('UI amount now       :', uiNow);

  // UI amount PROJECTED +1 year: compute locally (no RPC) from the on-chain config, advancing the
  // timestamp by 365 days to make the 5%/yr accrual visible (e^0.05 ≈ 1.05127 -> ~1051.27 tokens).
  const mintState = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const cfg = getInterestBearingMintConfigState(mintState);
  if (!cfg) throw new Error('mint has no interest-bearing config');
  const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const uiInOneYear = amountToUiAmountForInterestBearingMintWithoutSimulation(
    rawAmount,
    DECIMALS,
    oneYearFromNow,
    Number(cfg.lastUpdateTimestamp),
    Number(cfg.initializationTimestamp),
    cfg.preUpdateAverageRate,
    cfg.currentRate,
  );
  console.log('UI amount in 1 year :', uiInOneYear, `(rate ${cfg.currentRate} bps/yr)`);

  // --- 4. Update the rate (rate authority only) ----------------------------------------------------
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      // createUpdateRateInterestBearingMintInstruction(mint, rateAuthority, rate, multiSigners?, programId?)
      createUpdateRateInterestBearingMintInstruction(mint, payer.publicKey, 1000, [], TOKEN_2022_PROGRAM_ID),
    ),
    [payer],
  );
  console.log('rate updated to 1000 bps/yr (+10%). Supply unchanged — accrual is display-only.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
