# Basic RPC Examples

## Setup

```bash
npm install @solana/kit
```

```typescript
import { createSolanaRpc, address } from "@solana/kit";

const rpc = createSolanaRpc(process.env.QUICKNODE_RPC_URL!);
```

## Get Account Balance

```typescript
const balance = await rpc
  .getBalance(address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"))
  .send();

console.log("Balance:", Number(balance.value) / 1e9, "SOL");
```

## Get Account Info

```typescript
const accountInfo = await rpc
  .getAccountInfo(
    address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"),
    { encoding: "base64" }
  )
  .send();

console.log("Owner:", accountInfo.value?.owner);
console.log("Lamports:", accountInfo.value?.lamports);
```

## Get Multiple Accounts

```typescript
const accounts = await rpc
  .getMultipleAccounts(
    [
      address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"),
      address("So11111111111111111111111111111111111111112"),
    ],
    { encoding: "base64" }
  )
  .send();

accounts.value.forEach((account, i) => {
  console.log(`Account ${i}:`, account?.lamports);
});
```

## Get Token Accounts

```typescript
const tokenAccounts = await rpc
  .getTokenAccountsByOwner(
    address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"),
    {
      programId: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    },
    { encoding: "jsonParsed" }
  )
  .send();

tokenAccounts.value.forEach((ta) => {
  const info = ta.account.data.parsed.info;
  console.log(`Mint: ${info.mint}, Amount: ${info.tokenAmount.uiAmountString}`);
});
```

## Get Transaction Signatures

```typescript
const signatures = await rpc
  .getSignaturesForAddress(
    address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"),
    { limit: 10 }
  )
  .send();

signatures.forEach((sig) => {
  console.log(`${sig.signature} — slot ${sig.slot}`);
});
```

## Get Latest Blockhash

```typescript
const { value: blockhash } = await rpc.getLatestBlockhash().send();

console.log("Blockhash:", blockhash.blockhash);
console.log("Last valid block height:", blockhash.lastValidBlockHeight);
```

## Get Slot and Epoch Info

```typescript
const slot = await rpc.getSlot().send();
console.log("Current slot:", slot);

const epochInfo = await rpc.getEpochInfo().send();
console.log("Epoch:", epochInfo.epoch);
console.log("Slot index:", epochInfo.slotIndex);
```

## Batch Requests (Raw Fetch)

```typescript
const batchRequest = [
  { jsonrpc: "2.0", id: 1, method: "getSlot", params: [] },
  { jsonrpc: "2.0", id: 2, method: "getBlockHeight", params: [] },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "getBalance",
    params: ["E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"],
  },
];

const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(batchRequest),
});

const results = await response.json();
console.log("Slot:", results[0].result);
console.log("Block height:", results[1].result);
console.log("Balance:", results[2].result.value);
```

## WebSocket Subscription

```typescript
import { createSolanaRpcSubscriptions, address } from "@solana/kit";

const rpcSubscriptions = createSolanaRpcSubscriptions(
  process.env.QUICKNODE_WSS_URL!
);

// Subscribe to account changes
const subscription = await rpcSubscriptions
  .accountNotifications(
    address("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"),
    { commitment: "confirmed" }
  )
  .subscribe();

for await (const notification of subscription) {
  console.log("Account changed:", notification);
}
```

## Using Legacy web3.js

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection(process.env.QUICKNODE_RPC_URL!);

const balance = await connection.getBalance(
  new PublicKey("E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk")
);
console.log("Balance:", balance / 1e9, "SOL");
```
