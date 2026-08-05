/**
 * Check Krexit Score — SDK and REST API
 *
 * This example shows how to:
 * 1. Query score via the SDK
 * 2. Query score via the REST API (curl equivalent)
 * 3. Interpret score components
 */

import { KrexaSDK } from "@krexa/sdk";

const AGENT_ADDRESS = "YOUR_AGENT_PUBKEY";
const API_BASE = "https://tcredit-backend.onrender.com/api/v1";

async function main() {
  // ── Method 1: SDK ──
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: AGENT_ADDRESS,
    apiKey: "YOUR_API_KEY",
  });

  const score = await krexa.credit.getScore();

  console.log("=== Krexit Score (SDK) ===");
  console.log(`Overall Score: ${score.score} / 850`);
  console.log(`Credit Level: L${score.creditLevel}`);
  console.log(`Max Credit: $${score.maxCredit}`);
  console.log(`APR: ${score.apr}%`);
  console.log();

  // Component breakdown (each stored as 0-10000 BPS)
  console.log("=== Score Components ===");
  console.log(`Repayment History (30%): ${(score.components.repayment / 100).toFixed(1)}%`);
  console.log(`Profitability    (25%): ${(score.components.profitability / 100).toFixed(1)}%`);
  console.log(`Behavioral Health(20%): ${(score.components.behavioral / 100).toFixed(1)}%`);
  console.log(`Usage Patterns   (15%): ${(score.components.usage / 100).toFixed(1)}%`);
  console.log(`Account Maturity (10%): ${(score.components.maturity / 100).toFixed(1)}%`);
  console.log();

  // Score history (last 30 entries)
  console.log("=== Score History (last 5) ===");
  for (const entry of score.history.slice(-5)) {
    console.log(`  ${new Date(entry.timestamp).toISOString()}: ${entry.score}`);
  }

  // ── Method 2: REST API ──
  // Equivalent curl command:
  //
  // curl https://tcredit-backend.onrender.com/api/v1/solana/score/AGENT_ADDRESS
  //
  // Response:
  // {
  //   "success": true,
  //   "data": {
  //     "agent": "AGENT_ADDRESS",
  //     "score": 350,
  //     "components": {
  //       "repayment": 5000,
  //       "profitability": 5000,
  //       "behavioral": 5000,
  //       "usage": 0,
  //       "maturity": 0
  //     },
  //     "creditLevel": 1,
  //     "maxCredit": 500,
  //     "apr": 36.50,
  //     "lastUpdated": "2026-04-04T...",
  //     "isBlacklisted": false,
  //     "expiresAt": "2026-07-03T..."
  //   }
  // }

  const response = await fetch(`${API_BASE}/solana/score/${AGENT_ADDRESS}`);
  const data = await response.json();

  console.log("\n=== Krexit Score (REST API) ===");
  console.log(JSON.stringify(data, null, 2));

  // ── Interpreting the score ──
  console.log("\n=== Score Interpretation ===");
  if (score.score >= 750) {
    console.log("L4 Prime: Top-tier credit. Up to $500k at 18.25% APR.");
  } else if (score.score >= 650) {
    console.log("L3 Growth: Strong credit. Up to $50k at 21.90% APR.");
  } else if (score.score >= 500) {
    console.log("L2 Standard: Established credit. Up to $20k at 29.20% APR.");
  } else {
    console.log("L1 Micro: Starting credit. Up to $500 at 36.50% APR.");
    console.log("Tip: Repay on time and trade consistently to improve your score.");
  }
}

main().catch(console.error);
