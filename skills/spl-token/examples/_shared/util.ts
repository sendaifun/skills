/**
 * Shared utilities for SPL Token examples.
 *
 * These helpers are used by all example files. They handle:
 *   - Connection setup (devnet by default)
 *   - Payer loading (from env or ephemeral devnet keypair)
 *   - Airdrop with retry logic (devnet rate limits)
 *   - Explorer link generation
 *   - Pretty-printing token balances
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

/** Default commitment level for all examples. */
const COMMITMENT = 'confirmed' as const;

/** Devnet airdrop amount in lamports (1 SOL). */
const AIRDROP_LAMPORTS = 1 * LAMPORTS_PER_SOL;

/**
 * Create a Connection to devnet.
 * Override with the `RPC_URL` environment variable for custom endpoints.
 */
export function getConnection(): Connection {
  const rpcUrl = process.env.RPC_URL ?? clusterApiUrl('devnet');
  return new Connection(rpcUrl, COMMITMENT);
}

/**
 * Load a payer Keypair. Resolution order:
 *   1. `PAYER_SECRET_KEY` env var (base58-encoded secret key)
 *   2. `PAYER_KEYPAIR_JSON` env var (JSON array of secret key bytes)
 *   3. Generate an ephemeral keypair (devnet only)
 *
 * NEVER hardcode secret keys in source files. Use environment variables
 * or a secure key management system.
 */
export function loadPayer(): Keypair {
  if (process.env.PAYER_SECRET_KEY) {
    return Keypair.fromSecretKey(bs58.decode(process.env.PAYER_SECRET_KEY));
  }
  if (process.env.PAYER_KEYPAIR_JSON) {
    const secret = JSON.parse(process.env.PAYER_KEYPAIR_JSON) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  console.warn(
    '⚠ No PAYER_SECRET_KEY or PAYER_KEYPAIR_JSON env var — generating ephemeral keypair (devnet only).',
  );
  return Keypair.generate();
}

/**
 * Ensure the payer has at least `minLamports` SOL.
 * On devnet/testnet, request an airdrop with retry. On mainnet, just check.
 *
 * @throws if balance is insufficient and airdrop is unavailable
 */
export async function ensurePayerFunded(
  connection: Connection,
  payer: Keypair,
  minLamports: number = 0.5 * LAMPORTS_PER_SOL,
): Promise<void> {
  let balance = await connection.getBalance(payer.publicKey);
  if (balance >= minLamports) return;

  const endpoint = connection.rpcEndpoint;
  const canAirdrop =
    endpoint.includes('devnet') || endpoint.includes('testnet');

  if (!canAirdrop) {
    throw new Error(
      `Payer ${payer.publicKey.toBase58()} has ${balance} lamports (needs ${minLamports}). ` +
        `Airdrop not available on ${endpoint}. Fund manually.`,
    );
  }

  // Retry airdrop up to 3 times (devnet can be flaky).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Airdrop attempt ${attempt} (${AIRDROP_LAMPORTS / LAMPORTS_PER_SOL} SOL)...`);
      const sig = await connection.requestAirdrop(payer.publicKey, AIRDROP_LAMPORTS);
      await connection.confirmTransaction(sig, COMMITMENT);
      balance = await connection.getBalance(payer.publicKey);
      if (balance >= minLamports) {
        console.log(`Airdrop confirmed. Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
        return;
      }
    } catch (err) {
      console.warn(`Airdrop attempt ${attempt} failed: ${(err as Error).message}`);
    }
    // Wait 2s before retrying.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    `Failed to fund payer after 3 attempts. Devnet airdrop may be rate-limited.`,
  );
}

/**
 * Load and fund a payer in one call. Returns both for convenience.
 */
export async function loadOrAirdropPayer(
  connection: Connection,
): Promise<Keypair> {
  const payer = loadPayer();
  await ensurePayerFunded(connection, payer);
  return payer;
}

/**
 * Generate a Solana Explorer link for a transaction.
 */
export function explorerLink(
  signature: string,
  cluster: string = 'devnet',
): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

/**
 * Generate a Solana Explorer link for an address.
 */
export function addressLink(
  address: PublicKey | string,
  cluster: string = 'devnet',
): string {
  const base58 = typeof address === 'string' ? address : address.toBase58();
  return `https://explorer.solana.com/address/${base58}?cluster=${cluster}`;
}

/**
 * Read and pretty-print a token account's balance.
 */
export async function printTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey,
  label: string = 'Balance',
  programId: PublicKey = TOKEN_PROGRAM_ID,
): Promise<void> {
  const account = await getAccount(connection, tokenAccount, COMMITMENT, programId);
  console.log(`${label}: ${account.amount.toString()} (raw)`);
  console.log(`  Owner: ${account.owner.toBase58()}`);
  console.log(`  Mint: ${account.mint.toBase58()}`);
  console.log(`  Frozen: ${account.isFrozen}`);
}