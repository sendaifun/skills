/**
 * SolEnrich pay-per-request over x402 (USDC on Solana).
 *
 * Builds a `fetch` that answers every HTTP 402 by signing a USDC payment and
 * retrying. This is the client SolEnrich's own consumer agent (SolScout) uses
 * in production.
 *
 *   npm install @x402/fetch @x402/core @x402/svm @solana/kit @scure/base
 *
 * Env:
 *   SOLANA_PRIVATE_KEY  base58 secret key; wallet needs USDC + ~0.01 SOL for fees
 *   SOLANA_RPC_URL      optional paid RPC (Helius etc.). Strongly recommended —
 *                       the public mainnet-beta RPC drops sockets under load.
 *
 * Why the schemes are registered by hand: `registerExactSvmScheme` in
 * @x402/svm accepts an options object but never forwards `rpcUrl`, so it
 * always falls back to the public RPC. Registering `ExactSvmScheme` and
 * `ExactSvmSchemeV1` directly keeps the RPC you chose.
 */

import { createKeyPairSignerFromBytes } from '@solana/kit';
import { toClientSvmSigner } from '@x402/svm';
import { x402Client } from '@x402/core/client';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { ExactSvmSchemeV1 } from '@x402/svm/exact/v1/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { base58 } from '@scure/base';

const BASE_URL = 'https://api.solenrich.com';

/** Plain fetch signature — portable across Node, Bun, and Deno typings. */
export type PaidFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function createPaidFetch(): Promise<PaidFetch> {
  const secret = process.env.SOLANA_PRIVATE_KEY;
  if (!secret) throw new Error('SOLANA_PRIVATE_KEY is not set');
  const rpcUrl = process.env.SOLANA_RPC_URL; // undefined → library default (public RPC)

  const keypair = await createKeyPairSignerFromBytes(base58.decode(secret));
  const signer = toClientSvmSigner(keypair);

  const client = new x402Client();
  // v2 scheme, any Solana mainnet CAIP-2 id.
  client.register('solana:*', new ExactSvmScheme(signer, { rpcUrl }));
  // v1 scheme for servers that still advertise the older challenge shape.
  client.registerV1('solana', new ExactSvmSchemeV1(signer, { rpcUrl }));

  return wrapFetchWithPayment(globalThis.fetch, client) as PaidFetch;
}

/** Call any SolEnrich entrypoint. `input` is the flat parameter object. */
export async function solenrich<T = unknown>(
  fetch402: PaidFetch,
  key: string,
  input: Record<string, unknown>,
): Promise<T> {
  const res = await fetch402(`${BASE_URL}/entrypoints/${key}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SolEnrich ${key} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { output?: T } & T;
  // Responses are `{ output: {...} }`; unwrap so callers get the payload.
  return (json.output ?? json) as T;
}

// --- Example: the trenches lifecycle on one token -------------------------

if (import.meta.main) {
  const fetch402 = await createPaidFetch();
  const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

  const dd = await solenrich<{ verdict: string; risk_score: number; llm_summary?: string }>(
    fetch402, 'due-diligence', { mint: BONK, format: 'both' },
  );
  console.log(`due-diligence: ${dd.verdict} (risk ${dd.risk_score})`);

  const check = await solenrich<{ verdict: string; reasoning: string; transfer_tax: { bps: number } | null }>(
    fetch402, 'trenches-check', { mint: BONK },
  );
  console.log(`trenches-check: ${check.verdict} — ${check.reasoning}`);

  const exit = await solenrich<{ verdict: string; exit_score: number; position: { net_pnl_after_exit_tax_pct: number | null } | null }>(
    fetch402, 'exit-signal', { mint: BONK, entry_price_usd: 0.00002 },
  );
  console.log(`exit-signal: ${exit.verdict} (score ${exit.exit_score}), net after tax ${exit.position?.net_pnl_after_exit_tax_pct}%`);
}
