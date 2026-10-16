import { pathToFileURL } from 'node:url';
import { classifyAccounts, validateAddress, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '@kairos_elpis/sol-rent-check';

// Two read-only RPC calls. Never print the RPC URL: it may contain credentials.
export async function scan(wallet, rpcUrl, fetchImpl = fetch) {
  if (!validateAddress(wallet)) throw new Error('Expected a base58 public address.');
  const url = new URL(rpcUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost.');
  }
  const results = await Promise.all([TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map(async (programId, id) => {
    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers: {'content-type': 'application/json'},
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({jsonrpc: '2.0', id, method: 'getTokenAccountsByOwner',
          params: [wallet, {programId}, {encoding: 'jsonParsed', commitment: 'finalized'}]}),
      });
      if (!response.ok) return {programId, error: `RPC HTTP ${response.status}`};
      const result = await response.json();
      // Do not propagate provider messages, which can contain a credential-bearing URL.
      if (result.error) return {programId, error: 'RPC returned an error'};
      return {programId, result};
    } catch {
      return {programId, error: 'RPC unavailable or invalid response'};
    }
  }));
  return classifyAccounts(wallet, results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.SOLANA_RPC_URL) throw new Error('Set SOLANA_RPC_URL to your RPC endpoint.');
    const report = await scan(process.argv[2], process.env.SOLANA_RPC_URL);
    console.log(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
    if (!report.complete) process.exitCode = 2;
  } catch {
    console.error('Scan failed: check the public address and SOLANA_RPC_URL (HTTPS or local HTTP).');
    process.exitCode = 1;
  }
}
