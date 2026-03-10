/**
 * Manifest AMM-style reverse-liquidity batch example.
 *
 * This example mirrors the liquidity-modal pattern used in the Manifest app:
 * - build a symmetric ladder of bids and asks around a reference price
 * - auto-select `ReverseTight` for very small spreads
 * - fall back to `Reverse` for larger spreads
 * - place the whole ladder in one `batchUpdateIx(...)`
 *
 * Notes:
 * - This example assumes wrapper setup and market funding are already complete.
 * - Reverse orders use `spreadBps` instead of `lastValidSlot`.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ManifestClient,
  OrderType,
  WrapperPlaceOrderReverseParamsExternal,
} from "@bonasa-tech/manifest-sdk";

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  marketAddress: new PublicKey("REPLACE_WITH_MARKET_ADDRESS"),
  levelsPerSide: 4,
  referencePrice: 100,
  quoteStepPercent: 0.25,
  spreadPercent: 0.04,
  quantityPerLevel: 1,
};

function toReverseOrderTypeAndSpread(spreadPercent: number): {
  orderType: OrderType.Reverse | OrderType.ReverseTight;
  spreadBps: number;
} {
  let spreadBps = spreadPercent * 100;
  const orderType =
    spreadBps < 6.5535 ? OrderType.ReverseTight : OrderType.Reverse;

  if (orderType === OrderType.Reverse) {
    spreadBps = Math.round(spreadBps * 10) / 10;
  } else {
    spreadBps = Math.round(spreadBps * 10000) / 10000;
  }

  return { orderType, spreadBps };
}

function buildSymmetricReverseOrders(): WrapperPlaceOrderReverseParamsExternal[] {
  const orders: WrapperPlaceOrderReverseParamsExternal[] = [];
  const { orderType, spreadBps } = toReverseOrderTypeAndSpread(
    CONFIG.spreadPercent
  );

  let clientOrderId = Date.now();

  for (let level = 1; level <= CONFIG.levelsPerSide; level += 1) {
    const offsetMultiplier = (CONFIG.quoteStepPercent / 100) * level;
    const bidPrice = CONFIG.referencePrice * (1 - offsetMultiplier);
    const askPrice = CONFIG.referencePrice * (1 + offsetMultiplier);

    orders.push({
      numBaseTokens: CONFIG.quantityPerLevel,
      tokenPrice: bidPrice,
      isBid: true,
      spreadBps,
      orderType,
      clientOrderId: clientOrderId--,
    });

    orders.push({
      numBaseTokens: CONFIG.quantityPerLevel,
      tokenPrice: askPrice,
      isBid: false,
      spreadBps,
      orderType,
      clientOrderId: clientOrderId--,
    });
  }

  return orders;
}

async function main() {
  const trader = Keypair.generate(); // Replace with real signer loading
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const client = await ManifestClient.getClientForMarket(
    connection,
    CONFIG.marketAddress,
    trader
  );

  const reverseOrders = buildSymmetricReverseOrders();
  const batchIx = client.batchUpdateIx(reverseOrders, [], false);

  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    batchIx
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    trader,
  ]);

  console.log("Placed reverse-liquidity ladder:", signature);
  console.log("Levels:", reverseOrders.length);
  console.log(
    "Order type:",
    reverseOrders[0]?.orderType === OrderType.ReverseTight
      ? "ReverseTight"
      : "Reverse"
  );
}

main().catch((error) => {
  console.error("Reverse-liquidity batch example failed:", error);
  process.exit(1);
});
