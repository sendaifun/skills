/**
 * Manifest read-only market example.
 *
 * Usage:
 * 1. Install dependencies:
 *    npm install @bonasa-tech/manifest-sdk @solana/web3.js
 * 2. Set a market address below
 * 3. Run with:
 *    npx ts-node read-market.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { ManifestClient, Market } from "@bonasa-tech/manifest-sdk";

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  marketAddress: new PublicKey("REPLACE_WITH_MARKET_ADDRESS"),
};

async function readWithMarketApi(connection: Connection) {
  const market = await Market.loadFromAddress({
    connection,
    address: CONFIG.marketAddress,
  });

  console.log("Market:", CONFIG.marketAddress.toBase58());
  console.log("Base mint:", market.baseMint().toBase58());
  console.log("Quote mint:", market.quoteMint().toBase58());
  console.log("Best bid:", market.bestBidPrice());
  console.log("Best ask:", market.bestAskPrice());
}

async function readWithClient(connection: Connection) {
  const client = await ManifestClient.getClientReadOnly(
    connection,
    CONFIG.marketAddress
  );

  await client.market.reload(connection);

  const bids = client.market.bidsL2();
  const asks = client.market.asksL2();

  console.log("Top 5 bids:", bids.slice(0, 5));
  console.log("Top 5 asks:", asks.slice(0, 5));
}

async function main() {
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  await readWithMarketApi(connection);
  await readWithClient(connection);
}

main().catch((error) => {
  console.error("Failed to read market:", error);
  process.exit(1);
});
