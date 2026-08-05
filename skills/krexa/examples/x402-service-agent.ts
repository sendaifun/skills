/**
 * x402 Service Agent — Monetize an API with auto-repayment
 *
 * This example shows how to:
 * 1. Register as a Type B (Service) agent
 * 2. Borrow USDC for infrastructure costs
 * 3. Deploy an Express API with x402 paywall
 * 4. Serve .well-known/x402 discovery endpoint
 * 5. Revenue Router auto-repays your credit from every payment
 */

import express from "express";
import { KrexaSDK } from "@krexa/sdk";

const AGENT_ADDRESS = "YOUR_AGENT_PUBKEY";
const REVENUE_ROUTER = "YOUR_REVENUE_ROUTER_ADDRESS"; // From agent registration
const PORT = 3777;

async function main() {
  // Initialize Krexa SDK
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: AGENT_ADDRESS,
    apiKey: "YOUR_API_KEY",
  });

  // Check agent status (must be registered as Type B or C)
  const status = await krexa.agent.getStatus();
  console.log(`Agent type: ${status.type}, Score: ${status.score}`);

  const app = express();
  app.use(express.json());

  // ── .well-known/x402 discovery endpoint ──
  // Clients discover your pricing and payment details here
  app.get("/.well-known/x402", (_req, res) => {
    res.json({
      version: "1.0",
      network: "solana:devnet",
      currency: "USDC",
      recipient: REVENUE_ROUTER, // Payments go to Revenue Router, NOT directly to agent
      endpoints: [
        {
          path: "/api/research",
          method: "GET",
          amount: "0.25",
          description: "AI research report on any topic",
        },
        {
          path: "/api/analyze",
          method: "POST",
          amount: "0.50",
          description: "Deep analysis of provided data",
        },
        {
          path: "/api/summarize",
          method: "POST",
          amount: "0.10",
          description: "Summarize text or URL content",
        },
      ],
    });
  });

  // ── x402 payment middleware ──
  function requirePayment(amount: string) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const payment = req.headers["x-payment"];

      if (!payment) {
        // Return 402 with payment instructions
        return res.status(402).json({
          "x-payment-required": true,
          "x-payment-amount": amount,
          "x-payment-currency": "USDC",
          "x-payment-recipient": REVENUE_ROUTER,
          "x-payment-network": "solana:devnet",
          "x-payment-description": `Payment of ${amount} USDC required`,
          "x-payment-discovery": `http://localhost:${PORT}/.well-known/x402`,
        });
      }

      // In production, verify the payment on-chain here:
      // 1. Decode the x-payment header (contains tx signature)
      // 2. Verify the transaction on Solana
      // 3. Confirm payment amount and recipient match
      // 4. Check the Revenue Router processed it

      next();
    };
  }

  // ── API endpoints ──

  app.get("/api/research", requirePayment("0.25"), async (req, res) => {
    const topic = req.query.topic as string || "AI agents";

    // Your agent's actual logic here
    const result = {
      topic,
      report: `Research findings on ${topic}...`,
      generatedAt: new Date().toISOString(),
      agent: AGENT_ADDRESS,
    };

    res.json(result);
  });

  app.post("/api/analyze", requirePayment("0.50"), async (req, res) => {
    const { data } = req.body;

    const result = {
      analysis: `Analysis of provided data...`,
      confidence: 0.87,
      generatedAt: new Date().toISOString(),
    };

    res.json(result);
  });

  app.post("/api/summarize", requirePayment("0.10"), async (req, res) => {
    const { text } = req.body;

    const result = {
      summary: `Summary of ${(text || "").substring(0, 50)}...`,
      wordCount: (text || "").split(" ").length,
      generatedAt: new Date().toISOString(),
    };

    res.json(result);
  });

  // ── Health check (free) ──
  app.get("/health", async (_req, res) => {
    const agentStatus = await krexa.agent.getStatus();
    res.json({
      status: "ok",
      agent: AGENT_ADDRESS,
      healthZone: agentStatus.health.zone,
      outstandingDebt: agentStatus.credit.outstanding,
      score: agentStatus.score,
    });
  });

  app.listen(PORT, () => {
    console.log(`x402 service agent running on port ${PORT}`);
    console.log(`Discovery: http://localhost:${PORT}/.well-known/x402`);
    console.log(`Revenue Router: ${REVENUE_ROUTER}`);
    console.log();
    console.log("Payment flow for each API call:");
    console.log("  Client pays -> Revenue Router");
    console.log("    10% protocol fee -> Treasury");
    console.log("    Debt service     -> Credit Vault");
    console.log("    Remainder        -> Agent PDA wallet");
  });
}

main().catch(console.error);
