/**
 * Setup template for SPL Token development.
 *
 * Copy this file into your project and adapt as needed.
 * It provides a Connection to devnet and a funded payer Keypair.
 *
 * Usage:
 *   import { getConnection, getPayer } from './setup';
 *   const connection = getConnection();
 *   const payer = await getPayer(connection);
 *
 * Security: never hardcode secret keys. Either generate an ephemeral
 * devnet keypair (default) or load from an environment variable.
 */

import {
  Connection,
  Keypair,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Connection to devnet. For mainnet, change the cluster or
 * use a dedicated RPC endpoint:
 *   new Connection('https://mainnet.example.com', 'confirmed')
 */
export function getConnection(): Connection {
  return new Connection(clusterApiUrl('devnet'), 'confirmed');
}

/**
 * Load a payer from the `PAYER_SECRET_KEY` environment variable (base58),
 * or generate an ephemeral devnet keypair if the env var is not set.
 *
 * In production (mainnet), always load from an environment variable or
 * a secure key vault — never generate a random keypair.
 */
export function getPayer(): Keypair {
  const secretKey = process.env.PAYER_SECRET_KEY;
  if (secretKey) {
    return Keypair.fromSecretKey(bs58.decode(secretKey));
  }
  // Devnet only: generate an ephemeral keypair.
  console.warn(
    '⚠ PAYER_SECRET_KEY not set — generating ephemeral devnet keypair. ' +
      'Do NOT use this approach on mainnet.',
  );
  return Keypair.generate();
}

/**
 * Ensure the payer has SOL. On devnet, request an airdrop if the balance
 * is below 0.5 SOL. On mainnet, this will log a warning and return.
 *
 * @returns the payer's SOL balance in lamports
 */
export async function ensurePayerFunded(
  connection: Connection,
  payer: Keypair,
): Promise<number> {
  const balance = await connection.getBalance(payer.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    const cluster = connection.rpcEndpoint;
    if (cluster.includes('devnet') || cluster.includes('testnet')) {
      console.log('Requesting airdrop (1 SOL)...');
      const sig = await connection.requestAirdrop(
        payer.publicKey,
        1 * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('Airdrop confirmed.');
      return await connection.getBalance(payer.publicKey);
    }
    console.warn(
      '⚠ Payer balance is low and airdrop is not available on this cluster. ' +
        'Fund the payer manually.',
    );
  }
  return balance;
}

/**
 * Convenience: returns a ready-to-use connection + funded payer pair.
 */
export async function setupConnection(): Promise<{
  connection: Connection;
  payer: Keypair;
}> {
  const connection = getConnection();
  const payer = getPayer();
  await ensurePayerFunded(connection, payer);
  return { connection, payer };
}