/**
 * LP Vault Operations — Deposit, Monitor, Withdraw
 *
 * This example shows how to:
 * 1. Check vault stats (TVL, utilization, tranche APRs)
 * 2. Deposit USDC into the Credit Vault
 * 3. Monitor LP position and yield earned
 * 4. Withdraw USDC + accrued yield
 */

import { KrexaSDK } from "@krexa/sdk";

async function main() {
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: "YOUR_AGENT_PUBKEY", // Can also be an LP-only account
    apiKey: "YOUR_API_KEY",
  });

  // Step 1: Check vault stats
  const vaultStats = await krexa.vault.getStats();

  console.log("=== Vault Stats ===");
  console.log(`Total Deposits: $${vaultStats.totalDeposits}`);
  console.log(`Total Borrowed: $${vaultStats.totalBorrowed}`);
  console.log(`Utilization: ${(vaultStats.utilization * 100).toFixed(1)}%`);
  console.log(`Utilization Cap: 80%`);
  console.log();
  console.log("Tranches:");
  console.log(`  Senior  (50%): ${vaultStats.tranches.senior.apr}% APR`);
  console.log(`  Mezz    (30%): ${vaultStats.tranches.mezzanine.apr}% APR`);
  console.log(`  Junior  (20%): ${vaultStats.tranches.junior.apr}% APR (protocol-owned)`);
  console.log();
  console.log(`Insurance Fund: $${vaultStats.insuranceFund} (${vaultStats.insuranceFundRatio}% of target)`);

  // Step 2: Deposit USDC
  // Share formula: shares = amount * total_shares / total_deposits
  const deposit = await krexa.vault.deposit({
    amount: 1000,
    tranche: "senior", // "senior" | "mezzanine"
  });

  console.log("\n=== Deposit Result ===");
  console.log(`Deposited: $${deposit.amount} USDC`);
  console.log(`Shares Received: ${deposit.sharesReceived}`);
  console.log(`Share Price: $${deposit.sharePrice}`);
  console.log(`Tranche: ${deposit.tranche}`);
  console.log(`Tx: ${deposit.txSignature}`);

  // Step 3: Monitor LP position
  const position = await krexa.vault.getPosition();

  console.log("\n=== LP Position ===");
  console.log(`Shares Held: ${position.shares}`);
  console.log(`Current Value: $${position.currentValue}`);
  console.log(`Deposited: $${position.depositedAmount}`);
  console.log(`Yield Earned: $${position.yieldEarned}`);
  console.log(`Effective APR: ${position.effectiveApr}%`);
  console.log(`Tranche: ${position.tranche}`);

  // Step 4: Check how yield is generated
  // Yield comes from two sources:
  // 1. Agent loan interest (split by tranche priority)
  // 2. Meteora Dynamic Vault yield on idle capital

  console.log("\n=== Yield Breakdown ===");
  console.log(`From loan interest: $${position.yieldFromLoans}`);
  console.log(`From Meteora (idle): $${position.yieldFromMeteora}`);

  // Step 5: Withdraw
  // withdrawal_amount = shares_burned * total_deposits / total_shares
  const withdraw = await krexa.vault.withdraw({
    shares: position.shares, // Withdraw all shares
    // Or use: amount: 500 (withdraw specific USDC amount)
  });

  console.log("\n=== Withdrawal Result ===");
  console.log(`Shares Burned: ${withdraw.sharesBurned}`);
  console.log(`USDC Received: $${withdraw.amountReceived}`);
  console.log(`Yield Included: $${withdraw.yieldIncluded}`);
  console.log(`Tx: ${withdraw.txSignature}`);

  // Note: Withdrawals require available liquidity.
  // If utilization is near 80%, withdrawals may be partially filled
  // or queued until agents repay and free up capital.
  // Withdrawal buffer is 120% — vault ensures enough liquid USDC
  // remains to cover queued withdrawals.
}

main().catch(console.error);
