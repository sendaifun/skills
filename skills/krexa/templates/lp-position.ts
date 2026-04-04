/**
 * Krexa LP Position — Vault Deposit Template
 *
 * A template for:
 * 1. Depositing USDC into the Credit Vault
 * 2. Monitoring share value and yield earned
 * 3. Withdrawing principal + yield
 */

import { KrexaSDK } from "@krexa/sdk";

// ── Configuration ──
const CONFIG = {
  agentAddress: "YOUR_AGENT_PUBKEY", // Can also be an LP-only account
  apiKey: "YOUR_API_KEY",
  depositAmount: 1000,            // USDC to deposit
  tranche: "senior" as const,     // "senior" | "mezzanine"
  monitorIntervalMs: 600_000,     // Check every 10 minutes
  targetYieldPercent: 5.0,        // Withdraw after earning 5% yield
};

async function main() {
  // ── Initialize SDK ──
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: CONFIG.agentAddress,
    apiKey: CONFIG.apiKey,
  });

  // ── Check vault stats before depositing ──
  const vaultStats = await krexa.vault.getStats();

  console.log("=== Vault Stats ===");
  console.log(`Total Deposits: $${vaultStats.totalDeposits.toLocaleString()}`);
  console.log(`Total Borrowed: $${vaultStats.totalBorrowed.toLocaleString()}`);
  console.log(`Utilization: ${(vaultStats.utilization * 100).toFixed(1)}%`);
  console.log(`Insurance Fund: ${(vaultStats.insuranceFundRatio * 100).toFixed(1)}% of target`);
  console.log();
  console.log("Tranche APRs:");
  console.log(`  Senior (50%):     ${vaultStats.tranches.senior.apr}% APR`);
  console.log(`  Mezzanine (30%):  ${vaultStats.tranches.mezzanine.apr}% APR`);
  console.log(`  Junior (20%):     ${vaultStats.tranches.junior.apr}% APR (protocol-owned)`);

  // ── Deposit ──
  console.log(`\nDepositing ${CONFIG.depositAmount} USDC into ${CONFIG.tranche} tranche...`);

  const deposit = await krexa.vault.deposit({
    amount: CONFIG.depositAmount,
    tranche: CONFIG.tranche,
  });

  console.log(`Deposited: $${deposit.amount} USDC`);
  console.log(`Shares Received: ${deposit.sharesReceived}`);
  console.log(`Share Price: $${deposit.sharePrice.toFixed(6)}`);
  console.log(`Tx: ${deposit.txSignature}`);

  const depositTimestamp = Date.now();

  // ── Monitor loop ──
  console.log(`\nMonitoring position. Target yield: ${CONFIG.targetYieldPercent}%`);

  const monitor = setInterval(async () => {
    try {
      const position = await krexa.vault.getPosition();
      const elapsedHours = (Date.now() - depositTimestamp) / (1000 * 60 * 60);
      const yieldPercent = (position.yieldEarned / position.depositedAmount) * 100;

      console.log(
        `[${elapsedHours.toFixed(1)}h] ` +
        `Value: $${position.currentValue.toFixed(2)} | ` +
        `Yield: $${position.yieldEarned.toFixed(4)} (${yieldPercent.toFixed(3)}%) | ` +
        `APR: ${position.effectiveApr.toFixed(2)}%`
      );

      // Yield breakdown
      if (position.yieldFromLoans > 0 || position.yieldFromMeteora > 0) {
        console.log(
          `  Yield sources: Loans $${position.yieldFromLoans.toFixed(4)} + ` +
          `Meteora $${position.yieldFromMeteora.toFixed(4)}`
        );
      }

      // Check if target yield reached
      if (yieldPercent >= CONFIG.targetYieldPercent) {
        console.log(`\nTarget yield of ${CONFIG.targetYieldPercent}% reached! Withdrawing...`);
        clearInterval(monitor);
        await withdrawAll(krexa, position.shares);
      }
    } catch (err) {
      console.error("Monitor error:", err);
    }
  }, CONFIG.monitorIntervalMs);
}

async function withdrawAll(krexa: InstanceType<typeof KrexaSDK>, shares: number) {
  // Check available liquidity first
  const vaultStats = await krexa.vault.getStats();
  const availableLiquidity = vaultStats.totalDeposits - vaultStats.totalBorrowed;

  const position = await krexa.vault.getPosition();

  if (position.currentValue > availableLiquidity) {
    console.log(
      `Warning: Current value ($${position.currentValue.toFixed(2)}) exceeds ` +
      `available liquidity ($${availableLiquidity.toFixed(2)}). ` +
      `Partial withdrawal may occur.`
    );
  }

  // Withdraw all shares
  const withdrawal = await krexa.vault.withdraw({ shares });

  console.log("=== Withdrawal Complete ===");
  console.log(`Shares Burned: ${withdrawal.sharesBurned}`);
  console.log(`USDC Received: $${withdrawal.amountReceived.toFixed(2)}`);
  console.log(`Yield Included: $${withdrawal.yieldIncluded.toFixed(2)}`);
  console.log(`Tx: ${withdrawal.txSignature}`);

  const totalReturn = ((withdrawal.amountReceived - CONFIG.depositAmount) / CONFIG.depositAmount) * 100;
  console.log(`\nTotal Return: ${totalReturn.toFixed(2)}%`);
}

main().catch(console.error);
