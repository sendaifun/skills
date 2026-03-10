/**
 * Manifest SDK setup template.
 *
 * Copy this file into your project and customize the config.
 *
 * Install:
 *   npm install @bonasa-tech/manifest-sdk @solana/web3.js
 *
 * Run:
 *   npx ts-node manifest-setup.ts
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { ManifestClient } from "@bonasa-tech/manifest-sdk";

const CONFIG = {
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  marketAddress: new PublicKey("REPLACE_WITH_MARKET_ADDRESS"),
};

export class ManifestIntegration {
  readonly connection: Connection;
  readonly marketAddress: PublicKey;

  constructor() {
    this.connection = new Connection(CONFIG.rpcUrl, "confirmed");
    this.marketAddress = CONFIG.marketAddress;
  }

  async getReadOnlyClient(trader?: PublicKey) {
    return ManifestClient.getClientReadOnly(
      this.connection,
      this.marketAddress,
      trader
    );
  }

  async getSignerClient(trader: Keypair) {
    return ManifestClient.getClientForMarket(
      this.connection,
      this.marketAddress,
      trader
    );
  }

  async getWalletSetup(walletPublicKey: PublicKey) {
    return ManifestClient.getSetupIxs(
      this.connection,
      this.marketAddress,
      walletPublicKey
    );
  }
}

async function demo() {
  const integration = new ManifestIntegration();
  const client = await integration.getReadOnlyClient();

  await client.market.reload(integration.connection);

  console.log("Market:", integration.marketAddress.toBase58());
  console.log("Best bid:", client.market.bestBidPrice());
  console.log("Best ask:", client.market.bestAskPrice());
  console.log("Top bids:", client.market.bidsL2().slice(0, 3));
  console.log("Top asks:", client.market.asksL2().slice(0, 3));
}

demo().catch((error) => {
  console.error("Manifest template demo failed:", error);
  process.exit(1);
});
