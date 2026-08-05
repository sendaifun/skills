/**
 * Shared helpers for the examples.
 *
 * These keep the examples runnable end-to-end without silently failing on an
 * unfunded payer (the #1 reason a copy-pasted example "does nothing"):
 *   - loadOrAirdropPayer — get a funded keypair (env wallet, or a devnet airdrop)
 *   - confirmAirdrop — wait for an airdrop to land by polling its signature status
 */

import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  type TransactionSignature,
} from '@solana/web3.js';

/** Insist on at least this much balance before running an example. */
const MIN_PAYER_LAMPORTS = LAMPORTS_PER_SOL / 2; // 0.5 SOL

/**
 * Wait for a devnet airdrop to land by polling its signature status until it
 * reaches `confirmed`/`finalized` or the timeout elapses.
 *
 * Why poll instead of `confirmTransaction`? The blockhash-strategy
 * `confirmTransaction` needs the exact blockhash the transaction was sent with.
 * An airdrop only hands back a signature, so confirming it against a freshly
 * fetched blockhash races the wrong expiry window and can resolve before the
 * airdrop actually lands. Polling the signature status sidesteps that.
 *
 * On timeout this falls through silently — the balance assertion in
 * `loadOrAirdropPayer` is the real gate. Airdrops are devnet/testnet only.
 */
async function confirmAirdrop(
  connection: Connection,
  signature: TransactionSignature,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) {
      throw new Error(`Airdrop ${signature} failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  // Timed out waiting for confirmation; fall through to the balance check.
}

/**
 * Return a FUNDED payer keypair.
 *
 * - If `SOLANA_KEYPAIR` is set, treat it as a FILE PATH to a JSON array of
 *   secret-key bytes — exactly what `solana-keygen` writes (e.g.
 *   `~/.config/solana/id.json`) and what `Keypair.secretKey` produces. Use this
 *   on any real cluster — airdrops do not work on mainnet.
 * - Otherwise (devnet/testnet convenience), generate a throwaway keypair and
 *   `requestAirdrop` 1 SOL so the example can actually pay fees.
 *
 * EITHER WAY the balance is asserted above a minimum before returning, so the
 * example fails fast with a clear message instead of deep inside an unfunded
 * transaction ("Attempt to debit an account but found no record of a prior
 * credit" / "insufficient funds for fee").
 */
export async function loadOrAirdropPayer(connection: Connection): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR;
  let payer: Keypair;

  if (keypairPath) {
    let secret: number[];
    try {
      secret = JSON.parse(readFileSync(keypairPath, 'utf8')) as number[];
    } catch (err) {
      throw new Error(
        `SOLANA_KEYPAIR must be a path to a JSON secret-key file (an array of ` +
          `bytes, as written by solana-keygen). Failed to read "${keypairPath}": ` +
          `${(err as Error).message}`,
      );
    }
    payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  } else {
    // No wallet supplied — fall back to a funded devnet keypair.
    payer = Keypair.generate();
    const airdropSig = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await confirmAirdrop(connection, airdropSig);
  }

  // Assert the payer is actually funded, regardless of how it was obtained.
  const balance = await connection.getBalance(payer.publicKey);
  if (balance < MIN_PAYER_LAMPORTS) {
    throw new Error(
      `Payer ${payer.publicKey.toBase58()} has ${balance} lamports, below the ` +
        `${MIN_PAYER_LAMPORTS} lamport minimum. Fund the wallet at SOLANA_KEYPAIR, ` +
        `or (devnet only) retry the rate-limited airdrop. Airdrops do not work on ` +
        `mainnet-beta — set SOLANA_KEYPAIR to a funded keypair file there.`,
    );
  }
  return payer;
}
