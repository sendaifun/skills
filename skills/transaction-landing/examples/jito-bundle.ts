/**
 * jito-bundle.ts — land a transaction through a Jito bundle (rung 3).
 *
 * A bundle lands all-or-nothing, in order, in one slot, off the public mempool
 * (front-run protection). This example bundles a single transaction with a
 * dynamically-sized tip, submits it to the Block Engine, and polls the bundle
 * status. The same shape extends to up to 5 transactions.
 *
 * Tip accounts are FETCHED at runtime via getTipAccounts — never hardcode them.
 * The set rotates, and a wrong/stale address sends your tip into the void.
 *
 *   npm install @solana/web3.js bs58
 *   RPC_URL=... SECRET_KEY=... ts-node jito-bundle.ts
 */

import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

/** Source of truth for tip accounts — fetched live, never hardcoded. */
async function getTipAccounts(): Promise<PublicKey[]> {
  const res = await fetch(BLOCK_ENGINE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
  });
  const json = await res.json();
  if (json.error || !Array.isArray(json.result)) {
    throw new Error(
      `getTipAccounts failed (${JSON.stringify(json.error)}). ` +
        `Do NOT guess addresses — see https://docs.jito.wtf/lowlatencytxnsend/#tip-amount`,
    );
  }
  return (json.result as string[]).map((a) => new PublicKey(a));
}

async function getDynamicTipLamports(): Promise<number> {
  // Size the tip from the live tip floor; floor at 0.0001 SOL so it actually lands.
  const FLOOR = Math.floor(0.0001 * LAMPORTS_PER_SOL);
  try {
    const res = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
    const data = await res.json();
    const sol = data?.[0]?.landed_tips_75th_percentile;
    if (typeof sol === 'number') return Math.max(Math.floor(sol * LAMPORTS_PER_SOL), FLOOR);
  } catch {
    /* fall through to floor */
  }
  return FLOOR;
}

async function buildBundledTx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  tipAccounts: PublicKey[],
): Promise<{ base64: string; signature: string }> {
  const tipLamports = await getDynamicTipLamports();
  const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      ...instructions,
      // Tip transfer LAST. The tip pays for bundle inclusion (separate from the priority fee).
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: tipAccount,
        lamports: tipLamports,
      }),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  return {
    base64: Buffer.from(tx.serialize()).toString('base64'),
    signature: bs58.encode(tx.signatures[0]),
  };
}

async function sendBundle(base64Txs: string[]): Promise<string> {
  const res = await fetch(BLOCK_ENGINE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [base64Txs, { encoding: 'base64' }],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`sendBundle failed: ${JSON.stringify(json.error)}`);
  return json.result as string; // bundle id
}

async function confirmBundle(connection: Connection, signature: string): Promise<void> {
  // Confirm by the contained signature — a landed bundle lands its transactions.
  for (let i = 0; i < 30; i++) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const st = value[0];
    if (st?.err) throw new Error(`Bundled tx failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Bundle not confirmed in time: ${signature}`);
}

async function main() {
  if (!process.env.SECRET_KEY) throw new Error('Set SECRET_KEY (bs58) — mainnet bundle costs real SOL.');
  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = Keypair.fromSecretKey(bs58.decode(process.env.SECRET_KEY));

  const tipAccounts = await getTipAccounts();
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1_000,
    }),
  ];

  const { base64, signature } = await buildBundledTx(connection, payer, instructions, tipAccounts);
  const bundleId = await sendBundle([base64]);
  console.log(`Bundle submitted: ${bundleId}`);
  await confirmBundle(connection, signature);
  console.log(`Landed: https://explorer.solana.com/tx/${signature}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { getTipAccounts, getDynamicTipLamports, buildBundledTx, sendBundle, confirmBundle };
