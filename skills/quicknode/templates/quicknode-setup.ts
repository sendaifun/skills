/**
 * Quicknode Solana Starter Template
 *
 * Setup:
 * 1. npm install @solana/kit @quicknode/sdk @triton-one/yellowstone-grpc
 * 2. Set environment variables:
 *    - QUICKNODE_RPC_URL: Your Quicknode Solana HTTP endpoint
 *    - QUICKNODE_WSS_URL: Your Quicknode Solana WebSocket endpoint
 *    - QUICKNODE_API_KEY: (Optional) Admin API key
 *    - QUICKNODE_METIS_URL: (Optional) Metis Jupiter Swap endpoint
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
} from "@solana/kit";

// ============================================================
// Configuration
// ============================================================

const QUICKNODE_RPC_URL = process.env.QUICKNODE_RPC_URL!;
const QUICKNODE_WSS_URL = process.env.QUICKNODE_WSS_URL!;

const rpc = createSolanaRpc(QUICKNODE_RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(QUICKNODE_WSS_URL);

// ============================================================
// RPC Helpers
// ============================================================

/** Get SOL balance for an address */
async function getBalance(walletAddress: string): Promise<bigint> {
  const result = await rpc.getBalance(address(walletAddress)).send();
  return result.value;
}

/** Get account info */
async function getAccountInfo(walletAddress: string) {
  const result = await rpc
    .getAccountInfo(address(walletAddress), { encoding: "base64" })
    .send();
  return result.value;
}

/** Get recent transaction signatures for an address */
async function getRecentTransactions(walletAddress: string, limit = 10) {
  const result = await rpc
    .getSignaturesForAddress(address(walletAddress), { limit })
    .send();
  return result;
}

/** Get latest blockhash */
async function getLatestBlockhash() {
  const { value } = await rpc.getLatestBlockhash().send();
  return value;
}

/** Get token accounts for a wallet */
async function getTokenAccounts(walletAddress: string) {
  const result = await rpc
    .getTokenAccountsByOwner(
      address(walletAddress),
      {
        programId: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      },
      { encoding: "jsonParsed" }
    )
    .send();
  return result.value;
}

// ============================================================
// DAS API Helpers
// ============================================================

/** Generic DAS API call */
async function dasApiCall(method: string, params: Record<string, unknown>) {
  const response = await fetch(QUICKNODE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = await response.json();
  if (error) throw new Error(`DAS API error: ${error.message}`);
  return result;
}

/** Get all assets (NFTs + tokens) for a wallet */
async function getAssetsByOwner(ownerAddress: string, limit = 100) {
  return dasApiCall("getAssetsByOwner", {
    ownerAddress,
    limit,
    options: { showFungible: true, showCollectionMetadata: true },
  });
}

/** Search assets with filters */
async function searchAssets(
  ownerAddress: string,
  tokenType: "fungible" | "nonFungible" | "all" = "all",
  limit = 50
) {
  return dasApiCall("searchAssets", {
    ownerAddress,
    tokenType,
    burnt: false,
    limit,
  });
}

/** Get single asset metadata */
async function getAsset(assetId: string) {
  return dasApiCall("getAsset", { id: assetId });
}

/** Get Merkle proof for compressed NFT */
async function getAssetProof(assetId: string) {
  return dasApiCall("getAssetProof", { id: assetId });
}

/** Get assets by collection */
async function getAssetsByCollection(collectionAddress: string, limit = 100) {
  return dasApiCall("getAssetsByGroup", {
    groupKey: "collection",
    groupValue: collectionAddress,
    limit,
  });
}

// ============================================================
// Priority Fee Helper
// ============================================================

/** Get priority fee estimates */
async function estimatePriorityFees(account?: string) {
  const response = await fetch(QUICKNODE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "qn_estimatePriorityFees",
      params: { last_n_blocks: 100, ...(account ? { account } : {}) },
    }),
  });
  const { result } = await response.json();
  return result;
}

// ============================================================
// Admin API Helpers
// ============================================================

const CONSOLE_API_BASE = "https://api.quicknode.com/v0";

/** List all endpoints */
async function listEndpoints() {
  const response = await fetch(`${CONSOLE_API_BASE}/endpoints`, {
    headers: { "x-api-key": process.env.QUICKNODE_API_KEY! },
  });
  return response.json();
}

/** Get usage metrics */
async function getUsage() {
  const response = await fetch(`${CONSOLE_API_BASE}/usage/rpc`, {
    headers: { "x-api-key": process.env.QUICKNODE_API_KEY! },
  });
  return response.json();
}

// ============================================================
// IPFS Helper
// ============================================================

/** Upload file buffer to IPFS */
async function uploadToIPFS(fileBuffer: Buffer, fileName: string) {
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(
    "https://api.quicknode.com/ipfs/rest/v1/s3/put-object",
    {
      method: "POST",
      headers: { "x-api-key": process.env.QUICKNODE_API_KEY! },
      body: formData,
    }
  );
  const { pin } = await response.json();
  return {
    cid: pin.cid,
    url: `https://quicknode.quicknode-ipfs.com/ipfs/${pin.cid}`,
  };
}

// ============================================================
// Example Usage
// ============================================================

async function main() {
  const WALLET = "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk";

  // RPC calls
  const balance = await getBalance(WALLET);
  console.log("Balance:", Number(balance) / 1e9, "SOL");

  const blockhash = await getLatestBlockhash();
  console.log("Latest blockhash:", blockhash.blockhash);

  // DAS API
  const assets = await getAssetsByOwner(WALLET);
  console.log("Total assets:", assets.total);

  // Priority fees
  const fees = await estimatePriorityFees();
  console.log("Priority fees:", fees.per_compute_unit);

  // Token accounts
  const tokens = await getTokenAccounts(WALLET);
  console.log("Token accounts:", tokens.length);
}

main().catch(console.error);
