import { readFileSync } from 'node:fs';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  type TransactionSignature,
} from '@solana/web3.js';

/**
 * Best-effort DEVNET convenience: wait for an airdrop to land by polling its
 * signature status until it reaches `confirmed`/`finalized` or the timeout
 * elapses.
 *
 * Why poll instead of `confirmTransaction`? The blockhash-strategy
 * `confirmTransaction` needs the exact blockhash the transaction was sent with.
 * An airdrop only hands back a signature, so confirming it against a freshly
 * fetched blockhash races the wrong expiry window and can resolve before the
 * airdrop actually lands. Polling the signature status sidesteps that.
 *
 * This intentionally does not throw on timeout — the balance assertion in
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
      throw new Error(
        `Airdrop ${signature} failed: ${JSON.stringify(status.err)}`,
      );
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

/** Insist on at least this much balance before running an example. */
const MIN_PAYER_LAMPORTS = LAMPORTS_PER_SOL / 2; // 0.5 SOL

/**
 * Get a funded payer keypair.
 *
 * - If `SOLANA_KEYPAIR` is set, treat it as a FILE PATH and load the keypair
 *   from that file — a JSON array of secret-key bytes, the format written by
 *   `solana-keygen new` (e.g. `~/.config/solana/id.json`). Same convention as
 *   the priority-fees skill.
 * - Otherwise generate a fresh keypair and request a 1 SOL devnet airdrop.
 *
 * Either way the balance is asserted above a threshold, so the example fails
 * fast with a clear message instead of deep inside an unfunded transaction.
 */
export async function loadOrAirdropPayer(connection: Connection): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR;
  let payer: Keypair;

  if (keypairPath) {
    payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8')) as number[]),
    );
  } else {
    payer = Keypair.generate();
    // Devnet only; airdrops are rate-limited and unavailable on mainnet-beta.
    const signature = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await confirmAirdrop(connection, signature);
  }

  const balance = await connection.getBalance(payer.publicKey);
  if (balance < MIN_PAYER_LAMPORTS) {
    throw new Error(
      `Payer ${payer.publicKey.toBase58()} has ${balance} lamports, below the ` +
        `${MIN_PAYER_LAMPORTS} lamport minimum. Fund it from a wallet, or (devnet only) ` +
        `retry the rate-limited airdrop. On mainnet-beta set SOLANA_KEYPAIR to a funded keypair.`,
    );
  }

  return payer;
}
