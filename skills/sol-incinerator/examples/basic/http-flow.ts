/**
 * Minimal end-to-end REST examples:
 * 1) Generate API key
 * 2) Preview + build close transaction
 * 3) Preview + build token burn transaction
 * 4) Preview + build NFT burn transaction
 * 5) Sign locally (not shown) and submit
 *
 * Env vars:
 * - USER_PUBLIC_KEY (required)
 * - CLOSE_ASSET_ID (optional, fallback: ASSET_ID)
 * - TOKEN_ASSET_ID (optional)
 * - NFT_ASSET_ID (optional)
 */

const BASE_URL = 'https://v2.api.sol-incinerator.com';

async function main(): Promise<void> {
  const apiKey = await generateApiKey();
  const userPublicKey = getRequiredEnv('USER_PUBLIC_KEY');

  const closeAssetId = process.env.CLOSE_ASSET_ID ?? process.env.ASSET_ID;
  const tokenAssetId = process.env.TOKEN_ASSET_ID;
  const nftAssetId = process.env.NFT_ASSET_ID;

  if (!closeAssetId && !tokenAssetId && !nftAssetId) {
    throw new Error('Set at least one of CLOSE_ASSET_ID, TOKEN_ASSET_ID, or NFT_ASSET_ID');
  }

  if (closeAssetId) {
    await runCloseFlow({ apiKey, userPublicKey, assetId: closeAssetId });
  }

  if (tokenAssetId) {
    await runBurnFlow({ apiKey, userPublicKey, assetId: tokenAssetId, label: 'token', burnAmount: '1' });
  }

  if (nftAssetId) {
    await runBurnFlow({ apiKey, userPublicKey, assetId: nftAssetId, label: 'nft', burnAmount: '1' });
  }
}

async function runCloseFlow(input: { apiKey: string; userPublicKey: string; assetId: string }): Promise<void> {
  const preview = await postJson('/close/preview', input.apiKey, {
    userPublicKey: input.userPublicKey,
    assetId: input.assetId,
  });
  console.log('close preview', preview);

  const build = await postJson('/close', input.apiKey, {
    userPublicKey: input.userPublicKey,
    assetId: input.assetId,
  }) as { serializedTransaction: string };
  console.log('close serializedTransaction length', build.serializedTransaction.length);
}

async function runBurnFlow(input: {
  apiKey: string;
  userPublicKey: string;
  assetId: string;
  label: 'token' | 'nft';
  burnAmount: string;
}): Promise<void> {
  const preview = await postJson('/burn/preview', input.apiKey, {
    userPublicKey: input.userPublicKey,
    assetId: input.assetId,
    burnAmount: input.burnAmount,
  });
  console.log(`${input.label} burn preview`, preview);

  const build = await postJson('/burn', input.apiKey, {
    userPublicKey: input.userPublicKey,
    assetId: input.assetId,
    burnAmount: input.burnAmount,
    autoCloseTokenAccounts: true,
  }) as { serializedTransaction: string };
  console.log(`${input.label} burn serializedTransaction length`, build.serializedTransaction.length);

  // Sign build.serializedTransaction locally using your wallet.
  // Submit through your preferred RPC/wallet path.
  // Optional relay path:
  // const relay = await postJson('/transactions/send', input.apiKey, {
  //   signedTransaction: signedBase58Transaction,
  // });
  // console.log('relay', relay);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function generateApiKey(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api-keys/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'sol-incinerator-skill-example' }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate API key: ${response.status}`);
  }

  const data = await response.json() as { apiKey?: string };
  if (!data.apiKey) {
    throw new Error('Missing apiKey in response');
  }
  return data.apiKey;
}

async function postJson(path: string, apiKey: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.text();
  const parsed = payload ? JSON.parse(payload) : {};

  if (!response.ok) {
    throw new Error(`Request failed ${path}: ${response.status} ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

void main();
