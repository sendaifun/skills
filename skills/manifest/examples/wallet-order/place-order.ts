/**
 * Manifest wallet-adapter order flow example.
 *
 * This example shows the safe browser-wallet pattern:
 * 1. call getSetupIxs(...)
 * 2. execute setup if needed
 * 3. create getClientForMarketNoPrivateKey(...)
 * 4. build order instructions
 *
 * Replace the wallet hooks with your framework's wallet adapter wiring.
 */

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { ManifestClient, OrderType } from "@bonasa-tech/manifest-sdk";

type SendTransaction = (transaction: Transaction) => Promise<string>;

async function createOrderFlow(params: {
  connection: Connection;
  marketAddress: PublicKey;
  walletPublicKey: PublicKey;
  sendTransaction: SendTransaction;
}) {
  const { connection, marketAddress, walletPublicKey, sendTransaction } = params;

  const setup = await ManifestClient.getSetupIxs(
    connection,
    marketAddress,
    walletPublicKey
  );

  if (setup.setupNeeded) {
    const setupTx = new Transaction().add(...setup.instructions);
    setupTx.feePayer = walletPublicKey;
    setupTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    if (setup.wrapperKeypair) {
      setupTx.partialSign(setup.wrapperKeypair);
    }

    await sendTransaction(setupTx);
  }

  const client = await ManifestClient.getClientForMarketNoPrivateKey(
    connection,
    marketAddress,
    walletPublicKey
  );

  const orderIx = client.placeOrderIx({
    numBaseTokens: 1,
    tokenPrice: 100,
    isBid: true,
    lastValidSlot: 0,
    orderType: OrderType.Limit,
    clientOrderId: Date.now(),
  });

  const orderTx = new Transaction().add(orderIx);
  orderTx.feePayer = walletPublicKey;
  orderTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return sendTransaction(orderTx);
}

export { createOrderFlow };
