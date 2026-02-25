# DAS API Examples

## Setup

DAS API methods are called as JSON-RPC requests to your Quicknode Solana endpoint (requires the Metaplex DAS API add-on).

```typescript
const QUICKNODE_RPC_URL = process.env.QUICKNODE_RPC_URL!;

async function dasCall(method: string, params: Record<string, unknown>) {
  const response = await fetch(QUICKNODE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = await response.json();
  if (error) throw new Error(`DAS API error: ${error.message}`);
  return result;
}
```

## Get All NFTs for a Wallet

```typescript
const assets = await dasCall("getAssetsByOwner", {
  ownerAddress: "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
  limit: 100,
  options: { showCollectionMetadata: true },
});

console.log(`Total NFTs: ${assets.total}`);
assets.items.forEach((asset: any) => {
  console.log(`- ${asset.content.metadata.name} (${asset.id})`);
});
```

## Get All Tokens (Fungible) for a Wallet

```typescript
const tokens = await dasCall("searchAssets", {
  ownerAddress: "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
  tokenType: "fungible",
  limit: 100,
});

tokens.items.forEach((token: any) => {
  const info = token.token_info;
  console.log(
    `${info.symbol}: ${info.balance / Math.pow(10, info.decimals)} ` +
    `($${(info.price_info?.price_per_token * info.balance / Math.pow(10, info.decimals)).toFixed(2)})`
  );
});
```

## Get Complete Wallet Portfolio

```typescript
const portfolio = await dasCall("getAssetsByOwner", {
  ownerAddress: "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
  limit: 100,
  options: {
    showFungible: true,
    showCollectionMetadata: true,
    showNativeBalance: true,
  },
});

console.log(`SOL Balance: ${portfolio.nativeBalance?.lamports / 1e9} SOL`);
console.log(`Total Assets: ${portfolio.total}`);
```

## Get Assets by Collection

```typescript
const collectionAssets = await dasCall("getAssetsByGroup", {
  groupKey: "collection",
  groupValue: "COLLECTION_ADDRESS",
  limit: 100,
  page: 1,
});

console.log(`Collection size: ${collectionAssets.total}`);
collectionAssets.items.forEach((asset: any) => {
  console.log(`- ${asset.content.metadata.name}`);
});
```

## Get Compressed NFT Proof

```typescript
// Get proof (needed for transfers of compressed NFTs)
const proof = await dasCall("getAssetProof", {
  id: "COMPRESSED_NFT_ID",
});

console.log("Root:", proof.root);
console.log("Proof length:", proof.proof.length);
console.log("Tree ID:", proof.tree_id);
```

## Search with Advanced Filters

```typescript
// Search for specific NFTs
const results = await dasCall("searchAssets", {
  ownerAddress: "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
  tokenType: "nonFungible",
  burnt: false,
  compressed: true,  // Only compressed NFTs
  limit: 50,
});
```

## Paginate Through All Assets

```typescript
async function getAllAssets(ownerAddress: string) {
  const allAssets: any[] = [];
  let cursor: string | undefined;

  do {
    const result = await dasCall("getAssetsByOwner", {
      ownerAddress,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    allAssets.push(...result.items);
    cursor = result.cursor;
  } while (cursor);

  return allAssets;
}

const allAssets = await getAllAssets("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk");
console.log(`Total assets fetched: ${allAssets.length}`);
```

## Batch Asset Lookup

```typescript
const assets = await dasCall("getAssets", {
  ids: ["ASSET_ID_1", "ASSET_ID_2", "ASSET_ID_3"],
});

assets.forEach((asset: any) => {
  console.log(`${asset.id}: ${asset.content.metadata.name}`);
});
```

## Check Collection Ownership

```typescript
async function ownsNFTInCollection(
  ownerAddress: string,
  collectionAddress: string
): Promise<boolean> {
  const assets = await dasCall("searchAssets", {
    ownerAddress,
    grouping: ["collection", collectionAddress],
    limit: 1,
  });
  return assets.total > 0;
}

const owns = await ownsNFTInCollection(
  "E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk",
  "COLLECTION_ADDRESS"
);
console.log("Owns NFT in collection:", owns);
```
