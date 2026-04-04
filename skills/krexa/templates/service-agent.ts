/**
 * Krexa Service Agent — Complete Starter Template
 *
 * A Type B service agent that:
 * 1. Initializes Krexa SDK and registers as a service agent
 * 2. Borrows USDC for infrastructure costs
 * 3. Deploys an Express API with x402 paywall
 * 4. Earns revenue from API calls
 * 5. Revenue Router auto-repays credit from every payment
 *
 * Replace the API endpoints with your actual service logic.
 */

import express from "express";
import { KrexaSDK } from "@krexa/sdk";

// ── Configuration ──
const CONFIG = {
  agentAddress: "YOUR_AGENT_PUBKEY",
  ownerAddress: "YOUR_OWNER_PUBKEY",
  apiKey: "YOUR_API_KEY",
  revenueRouter: "YOUR_REVENUE_ROUTER_ADDRESS", // Set after registration
  borrowAmount: 200,            // USDC to borrow for infrastructure
  port: 3777,
};

// ── Pricing for your API endpoints ──
const PRICING: Record<string, string> = {
  "/api/analyze": "0.50",
  "/api/research": "0.25",
  "/api/summarize": "0.10",
  "/api/generate": "1.00",
};

async function main() {
  // ── Initialize SDK ──
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: CONFIG.agentAddress,
    apiKey: CONFIG.apiKey,
  });

  // ── Register as service agent ──
  let status = await krexa.agent.getStatus();
  if (!status) {
    console.log("Registering as service agent...");
    const reg = await krexa.agent.register({
      type: "service",
      name: "My API Service",
      owner: CONFIG.ownerAddress,
    });
    CONFIG.revenueRouter = reg.revenueRouterAddress;
    status = await krexa.agent.getStatus();
  }
  console.log(`Agent registered. Score: ${status.score}, Level: L${status.creditLevel}`);

  // ── Borrow for infrastructure ──
  if (status.credit.outstanding === 0 && CONFIG.borrowAmount > 0) {
    console.log(`Borrowing ${CONFIG.borrowAmount} USDC for infrastructure...`);
    const borrow = await krexa.agent.requestCredit({ amount: CONFIG.borrowAmount });
    console.log(`Borrowed ${borrow.amount} USDC. Daily interest: $${borrow.dailyInterest}`);
  }

  // ── Setup Express server ──
  const app = express();
  app.use(express.json());

  // ── x402 payment middleware ──
  function x402Paywall(amount: string) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const payment = req.headers["x-payment"];

      if (!payment) {
        return res.status(402).json({
          "x-payment-required": true,
          "x-payment-amount": amount,
          "x-payment-currency": "USDC",
          "x-payment-recipient": CONFIG.revenueRouter,
          "x-payment-network": "solana:devnet",
          "x-payment-discovery": `http://localhost:${CONFIG.port}/.well-known/x402`,
        });
      }

      // TODO: In production, verify the payment on-chain:
      // 1. Parse tx signature from x-payment header
      // 2. Verify on Solana that the tx sent the correct amount
      // 3. Confirm recipient is the Revenue Router
      // 4. Check tx is finalized

      next();
    };
  }

  // ── .well-known/x402 discovery ──
  app.get("/.well-known/x402", (_req, res) => {
    const endpoints = Object.entries(PRICING).map(([path, amount]) => ({
      path,
      method: path === "/api/research" ? "GET" : "POST",
      amount,
      currency: "USDC",
    }));

    res.json({
      version: "1.0",
      network: "solana:devnet",
      currency: "USDC",
      recipient: CONFIG.revenueRouter,
      endpoints,
    });
  });

  // ══════════════════════════════════════════════
  // YOUR API ENDPOINTS HERE
  // Replace these with your actual service logic
  // ══════════════════════════════════════════════

  app.get("/api/research", x402Paywall(PRICING["/api/research"]), async (req, res) => {
    const topic = req.query.topic as string || "AI agents on Solana";

    // TODO: Your research logic here
    res.json({
      topic,
      findings: [
        "Finding 1: ...",
        "Finding 2: ...",
      ],
      generatedAt: new Date().toISOString(),
    });
  });

  app.post("/api/analyze", x402Paywall(PRICING["/api/analyze"]), async (req, res) => {
    const { data } = req.body;

    // TODO: Your analysis logic here
    res.json({
      analysis: "Analysis results...",
      confidence: 0.92,
      generatedAt: new Date().toISOString(),
    });
  });

  app.post("/api/summarize", x402Paywall(PRICING["/api/summarize"]), async (req, res) => {
    const { text, url } = req.body;

    // TODO: Your summarization logic here
    res.json({
      summary: "Summary of the provided content...",
      generatedAt: new Date().toISOString(),
    });
  });

  app.post("/api/generate", x402Paywall(PRICING["/api/generate"]), async (req, res) => {
    const { prompt } = req.body;

    // TODO: Your generation logic here
    res.json({
      output: "Generated content...",
      generatedAt: new Date().toISOString(),
    });
  });

  // ══════════════════════════════════════════════

  // ── Health and status endpoints (free) ──
  app.get("/health", async (_req, res) => {
    try {
      const agentStatus = await krexa.agent.getStatus();
      res.json({
        status: "ok",
        agent: CONFIG.agentAddress,
        type: "service",
        healthZone: agentStatus.health.zone,
        score: agentStatus.score,
        credit: {
          outstanding: agentStatus.credit.outstanding,
          available: agentStatus.credit.available,
        },
      });
    } catch {
      res.status(500).json({ status: "error" });
    }
  });

  // ── Start server ──
  app.listen(CONFIG.port, () => {
    console.log(`\nService agent running on port ${CONFIG.port}`);
    console.log(`Discovery: http://localhost:${CONFIG.port}/.well-known/x402`);
    console.log(`Health: http://localhost:${CONFIG.port}/health`);
    console.log(`\nEndpoints:`);
    for (const [path, amount] of Object.entries(PRICING)) {
      console.log(`  ${path} — ${amount} USDC`);
    }
    console.log(`\nRevenue flow:`);
    console.log(`  Payment -> Revenue Router`);
    console.log(`    10% protocol fee -> Treasury`);
    console.log(`    Debt service     -> Credit Vault (auto-repay)`);
    console.log(`    Remainder        -> Agent PDA wallet`);
  });

  // ── Periodic status check ──
  setInterval(async () => {
    try {
      const s = await krexa.agent.getStatus();
      console.log(
        `[Status] Health: ${s.health.zone} | ` +
        `Debt: $${s.credit.outstanding.toFixed(2)} | ` +
        `Score: ${s.score} | ` +
        `Balance: $${s.balance.usdc.toFixed(2)}`
      );
    } catch {
      // Silently skip status check failures
    }
  }, 300_000); // Every 5 minutes
}

main().catch(console.error);
