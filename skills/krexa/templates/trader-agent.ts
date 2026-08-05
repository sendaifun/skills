/**
 * Krexa Trader Agent — Complete Starter Template
 *
 * A Type A trading agent that:
 * 1. Initializes Krexa SDK and registers as a trader
 * 2. Borrows USDC from the Credit Vault
 * 3. Trades via Jupiter aggregator
 * 4. Monitors P&L and health factor
 * 5. Auto-repays from profits
 *
 * Replace the strategy logic in executeTradingStrategy() with your own.
 */

import { KrexaSDK } from "@krexa/sdk";

// ── Configuration ──
const CONFIG = {
  agentAddress: "YOUR_AGENT_PUBKEY",
  ownerAddress: "YOUR_OWNER_PUBKEY",
  apiKey: "YOUR_API_KEY",
  borrowAmount: 500,             // USDC to borrow
  profitRepayPercent: 0.50,      // Repay 50% of profits each cycle
  maxDrawdownPercent: 0.10,      // Stop trading if drawdown exceeds 10%
  tradingIntervalMs: 60_000,     // Check for trades every 60 seconds
  healthFloor: 1.2,              // Stop trading if health factor drops below 1.2
};

async function main() {
  // ── Initialize SDK ──
  const krexa = new KrexaSDK({
    chain: "solana",
    agentAddress: CONFIG.agentAddress,
    apiKey: CONFIG.apiKey,
  });

  // ── Check registration ──
  let status = await krexa.agent.getStatus();
  if (!status) {
    console.log("Registering as trader agent...");
    await krexa.agent.register({
      type: "trader",
      name: "My Trader Bot",
      owner: CONFIG.ownerAddress,
    });
    status = await krexa.agent.getStatus();
  }
  console.log(`Agent registered. Score: ${status.score}, Level: L${status.creditLevel}`);

  // ── Borrow USDC ──
  if (status.credit.outstanding === 0) {
    console.log(`Borrowing ${CONFIG.borrowAmount} USDC...`);
    const borrow = await krexa.agent.requestCredit({ amount: CONFIG.borrowAmount });
    console.log(`Borrowed ${borrow.amount} USDC. Daily interest: $${borrow.dailyInterest}`);
  }

  // ── Track P&L ──
  const initialBalance = (await krexa.agent.getStatus()).balance.usdc;
  let peakBalance = initialBalance;

  // ── Trading Loop ──
  console.log("Starting trading loop...");

  setInterval(async () => {
    try {
      // Refresh status
      const current = await krexa.agent.getStatus();
      const currentBalance = current.balance.usdc;

      // Check health factor — stop if too low
      if (current.health.factor < CONFIG.healthFloor) {
        console.log(`Health factor ${current.health.factor} below floor ${CONFIG.healthFloor}. Pausing.`);
        return;
      }

      // Check drawdown — stop if exceeded
      peakBalance = Math.max(peakBalance, currentBalance);
      const drawdown = (peakBalance - currentBalance) / peakBalance;
      if (drawdown > CONFIG.maxDrawdownPercent) {
        console.log(`Drawdown ${(drawdown * 100).toFixed(1)}% exceeds max ${CONFIG.maxDrawdownPercent * 100}%. Pausing.`);
        return;
      }

      // ══════════════════════════════════════════════
      // YOUR STRATEGY LOGIC HERE
      // ══════════════════════════════════════════════
      const signal = await executeTradingStrategy(krexa);
      // ══════════════════════════════════════════════

      if (signal) {
        console.log(`Executing trade: ${signal.side} ${signal.amount} ${signal.from} -> ${signal.to}`);

        const swap = await krexa.agent.swap({
          from: signal.from,
          to: signal.to,
          amount: signal.amount,
          ownerAddress: CONFIG.ownerAddress,
        });

        console.log(`Swap executed. Got ${swap.amountOut} ${signal.to}`);
      }

      // Auto-repay from profits
      const profit = currentBalance - initialBalance;
      if (profit > 0) {
        const repayAmount = profit * CONFIG.profitRepayPercent;
        if (repayAmount >= 1) { // Minimum $1 repayment
          console.log(`Repaying $${repayAmount.toFixed(2)} from profits...`);
          await krexa.agent.repay({ amount: repayAmount });
        }
      }

      // Log status
      console.log(
        `Balance: $${currentBalance.toFixed(2)} | ` +
        `P&L: $${profit.toFixed(2)} | ` +
        `Health: ${current.health.factor.toFixed(2)} (${current.health.zone}) | ` +
        `Debt: $${current.credit.outstanding.toFixed(2)} | ` +
        `Score: ${current.score}`
      );
    } catch (err) {
      console.error("Trading loop error:", err);
    }
  }, CONFIG.tradingIntervalMs);
}

// ── Replace this with your actual trading strategy ──
async function executeTradingStrategy(
  krexa: InstanceType<typeof KrexaSDK>
): Promise<{ side: "buy" | "sell"; from: string; to: string; amount: number } | null> {
  // Example: Simple yield scan strategy
  // Scan for yield opportunities and swap into the best one

  // Get a quote to check current prices
  const quote = await krexa.agent.quote({
    from: "USDC",
    to: "SOL",
    amount: 50,
  });

  // TODO: Replace with your strategy logic
  // Some ideas:
  // - Momentum: Buy when SOL is trending up over last N candles
  // - Mean reversion: Buy when SOL drops >5% in 24h
  // - Arbitrage: Compare prices across DEXs
  // - Yield farming: Deposit into highest-APR Meteora pool

  // Return null to skip this cycle (no trade)
  return null;

  // Example return value to execute a trade:
  // return { side: "buy", from: "USDC", to: "SOL", amount: 50 };
}

main().catch(console.error);
