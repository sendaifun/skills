# Yellowstone gRPC Streaming Examples

## Setup

```bash
npm install @triton-one/yellowstone-grpc
```

```typescript
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

// Derive gRPC URL from HTTP endpoint:
// HTTP:  https://example.solana-mainnet.quiknode.pro/TOKEN/
// gRPC:  https://example.solana-mainnet.quiknode.pro:10000
const GRPC_ENDPOINT = "https://example.solana-mainnet.quiknode.pro:10000";
const AUTH_TOKEN = "TOKEN";
```

## Monitor Program Transactions

```typescript
const client = new Client(GRPC_ENDPOINT, AUTH_TOKEN, {});
const stream = await client.subscribe();

stream.on("data", (data) => {
  if (data.transaction) {
    const { transaction, slot } = data.transaction;
    console.log(`[Slot ${slot}] Tx: ${Buffer.from(transaction.signature).toString("base64")}`);
  }
});

// Subscribe to Token Program transactions
stream.write({
  transactions: {
    token_txs: {
      vote: false,
      failed: false,
      accountInclude: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
      accountExclude: [],
      accountRequired: [],
    },
  },
  accounts: {},
  slots: {},
  blocks: {},
  blocksMeta: {},
  transactionsStatus: {},
  entry: {},
  accountsDataSlice: [],
  commitment: CommitmentLevel.CONFIRMED,
});
```

## Monitor Account Changes

```typescript
const client = new Client(GRPC_ENDPOINT, AUTH_TOKEN, {});
const stream = await client.subscribe();

stream.on("data", (data) => {
  if (data.account) {
    const { account, slot } = data.account;
    console.log(`[Slot ${slot}] Account ${Buffer.from(account.pubkey).toString("base64")} updated`);
    console.log(`  Owner: ${Buffer.from(account.owner).toString("base64")}`);
    console.log(`  Lamports: ${account.lamports}`);
  }
});

// Subscribe to specific account changes
stream.write({
  accounts: {
    my_accounts: {
      account: ["E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk"],
      owner: [],
      filters: [],
      nonemptyTxnSignature: true,
    },
  },
  transactions: {},
  slots: {},
  blocks: {},
  blocksMeta: {},
  transactionsStatus: {},
  entry: {},
  accountsDataSlice: [],
  commitment: CommitmentLevel.CONFIRMED,
});
```

## Monitor Slot Progress

```typescript
const client = new Client(GRPC_ENDPOINT, AUTH_TOKEN, {});
const stream = await client.subscribe();

stream.on("data", (data) => {
  if (data.slot) {
    console.log(`Slot ${data.slot.slot} — status: ${data.slot.status}`);
  }
});

stream.write({
  slots: {
    slot_updates: {
      filterByCommitment: true,
    },
  },
  accounts: {},
  transactions: {},
  blocks: {},
  blocksMeta: {},
  transactionsStatus: {},
  entry: {},
  accountsDataSlice: [],
  commitment: CommitmentLevel.CONFIRMED,
});
```

## Robust Connection with Auto-Reconnect

```typescript
import Client, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

async function createStream(
  onData: (data: any) => void,
  filters: Record<string, any>
) {
  let retries = 0;
  const maxRetries = 10;

  async function connect() {
    try {
      const client = new Client(GRPC_ENDPOINT, AUTH_TOKEN, {});
      const stream = await client.subscribe();

      retries = 0; // Reset on successful connection

      stream.on("data", onData);

      stream.on("error", async (error) => {
        console.error("Stream error:", error.message);
        await reconnect();
      });

      stream.on("end", async () => {
        console.log("Stream ended");
        await reconnect();
      });

      stream.write({
        ...filters,
        commitment: CommitmentLevel.CONFIRMED,
      });

      // Keepalive ping every 10 seconds
      const keepalive = setInterval(() => {
        try {
          stream.write({
            ping: { id: 1 },
          });
        } catch {
          clearInterval(keepalive);
        }
      }, 10_000);

      return stream;
    } catch (error) {
      console.error("Connection failed:", error);
      await reconnect();
    }
  }

  async function reconnect() {
    if (retries >= maxRetries) {
      throw new Error(`Failed to connect after ${maxRetries} retries`);
    }
    retries++;
    const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
    console.log(`Reconnecting in ${delay}ms (attempt ${retries}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return connect();
  }

  return connect();
}

// Usage
const stream = await createStream(
  (data) => {
    if (data.transaction) {
      console.log("Transaction received:", data.transaction.slot);
    }
  },
  {
    transactions: {
      my_filter: {
        vote: false,
        failed: false,
        accountInclude: ["YOUR_PROGRAM_ID"],
        accountExclude: [],
        accountRequired: [],
      },
    },
    accounts: {},
    slots: {},
    blocks: {},
    blocksMeta: {},
    transactionsStatus: {},
    entry: {},
    accountsDataSlice: [],
  }
);
```
