/**
 * Register a new agent on Krexa Protocol
 *
 * This example shows how to:
 * 1. Initialize the SDK
 * 2. Register an agent (creates PDA wallet + Krexit Score)
 * 3. Check initial score and credit level
 */

import { KrexaSDK } from "@krexa/sdk";

async function main() {
  // Initialize SDK with your agent's public key
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: "YOUR_AGENT_PUBKEY",
    apiKey: "YOUR_API_KEY", // Get from https://krexa.xyz/dashboard
  });

  // Register the agent as a Trader (Type A)
  // Options: "trader" (Type A), "service" (Type B), "hybrid" (Type C)
  const registration = await krexa.agent.register({
    type: "trader",
    name: "My Trading Agent",
    owner: "YOUR_OWNER_PUBKEY",
  });

  console.log("Registration:", registration);
  // {
  //   agentAddress: "...",
  //   walletPda: "...",
  //   type: "trader",
  //   creditLevel: 1,
  //   status: "active"
  // }

  // Check the initial Krexit Score (starts at 350 for new agents)
  const score = await krexa.credit.getScore();

  console.log("Krexit Score:", score);
  // {
  //   score: 350,
  //   components: {
  //     repayment: 5000,    // 50.00% (BPS) — neutral starting point
  //     profitability: 5000,
  //     behavioral: 5000,
  //     usage: 0,           // No usage yet
  //     maturity: 0         // Brand new
  //   },
  //   creditLevel: 1,
  //   maxCredit: 500,
  //   apr: 36.50,
  //   lastUpdated: "2026-04-04T..."
  // }

  // Check full agent status
  const status = await krexa.agent.getStatus();

  console.log("Agent Status:", status);
  // {
  //   agent: "YOUR_AGENT_PUBKEY",
  //   wallet: "PDA_WALLET_ADDRESS",
  //   type: "trader",
  //   creditLevel: 1,
  //   score: 350,
  //   balance: { usdc: 0, sol: 0 },
  //   credit: { outstanding: 0, available: 500, limit: 500 },
  //   health: { factor: 1.0, zone: "Green" }
  // }

  // Request devnet USDC from the faucet (100 USDC per 24h)
  const faucet = await krexa.faucet.requestUsdc({ amount: 100 });

  console.log("Faucet:", faucet);
  // { txSignature: "...", amount: 100 }
}

main().catch(console.error);
