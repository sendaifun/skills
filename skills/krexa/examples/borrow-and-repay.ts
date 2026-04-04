/**
 * Borrow USDC and repay on Krexa Protocol
 *
 * This example shows how to:
 * 1. Check credit eligibility
 * 2. Borrow USDC from the Credit Vault
 * 3. Monitor outstanding balance
 * 4. Manually repay (auto-repay happens via Revenue Router)
 */

import { KrexaSDK } from "@krexa/sdk";

async function main() {
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: "YOUR_AGENT_PUBKEY",
    apiKey: "YOUR_API_KEY",
  });

  // Step 1: Check credit eligibility
  const eligibility = await krexa.credit.getEligibility();

  console.log("Eligibility:", eligibility);
  // {
  //   eligible: true,
  //   creditLevel: 1,
  //   maxCredit: 500,
  //   availableCredit: 500,
  //   outstandingDebt: 0,
  //   apr: 36.50,
  //   dailyRate: 0.10,
  //   score: 350
  // }

  // Step 2: Borrow USDC
  const borrow = await krexa.agent.requestCredit({ amount: 500 });

  console.log("Borrow result:", borrow);
  // {
  //   txSignature: "...",
  //   amount: 500,
  //   newBalance: 500,
  //   outstandingDebt: 500,
  //   dailyInterest: 0.50,  // 500 * 0.10% = $0.50/day
  //   creditLevel: 1
  // }

  // Step 3: Check updated status
  const status = await krexa.agent.getStatus();

  console.log("Post-borrow status:", status);
  // {
  //   credit: {
  //     outstanding: 500,
  //     available: 0,      // Fully utilized at L1
  //     limit: 500,
  //     dailyAccrual: 0.50,
  //     nextPaymentDue: "2026-04-11T..."
  //   },
  //   health: { factor: 1.0, zone: "Green" }
  // }

  // Step 4: Manual repayment
  // Note: If you're a Type B service agent, the Revenue Router
  // auto-repays from your x402 earnings. Manual repay is optional.
  const repay = await krexa.agent.repay({ amount: 50 });

  console.log("Repay result:", repay);
  // {
  //   txSignature: "...",
  //   amountRepaid: 50,
  //   principalReduced: 45,     // 50 - interest portion
  //   interestPaid: 5,
  //   remainingDebt: 455,
  //   availableCredit: 45
  // }

  // Step 5: Check score impact (repayment improves score)
  const score = await krexa.credit.getScore();

  console.log("Score after repayment:", score.score);
  // Score should increase slightly due to on-time repayment
  // Repayment History component (30% weight) improves

  // Step 6: Full repayment
  const fullRepay = await krexa.agent.repay({ amount: "max" });

  console.log("Full repay:", fullRepay);
  // {
  //   txSignature: "...",
  //   amountRepaid: 455.23,  // Principal + accrued interest
  //   remainingDebt: 0,
  //   availableCredit: 500,
  //   creditCycleCompleted: true  // Completing a cycle boosts Maturity score
  // }
}

main().catch(console.error);
