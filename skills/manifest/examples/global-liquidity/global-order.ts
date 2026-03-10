/**
 * Manifest global-liquidity example.
 *
 * Shows:
 * 1. one-time global account setup for a token
 * 2. deposit into the global account
 * 3. place an OrderType.Global order
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { ManifestClient, OrderType } from "@bonasa-tech/manifest-sdk";

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  marketAddress: new PublicKey("REPLACE_WITH_MARKET_ADDRESS"),
  supportingMint: new PublicKey("REPLACE_WITH_SUPPORTING_MINT"),
};

async function main() {
  const trader = Keypair.generate(); // Replace with real signer loading
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const addTraderIx = await ManifestClient.createGlobalAddTraderIx(
    trader.publicKey,
    CONFIG.supportingMint
  );

  const globalDepositIx = await ManifestClient.globalDepositIx(
    connection,
    trader.publicKey,
    CONFIG.supportingMint,
    100
  );

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(addTraderIx, globalDepositIx),
    [trader]
  );

  const client = await ManifestClient.getClientForMarket(
    connection,
    CONFIG.marketAddress,
    trader
  );

  const orderIx = client.placeOrderIx({
    numBaseTokens: 1,
    tokenPrice: 100,
    isBid: true,
    lastValidSlot: 0,
    orderType: OrderType.Global,
    clientOrderId: 1,
  });

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(orderIx),
    [trader]
  );

  console.log("Global order tx:", signature);
}

main().catch((error) => {
  console.error("Global order example failed:", error);
  process.exit(1);
});
