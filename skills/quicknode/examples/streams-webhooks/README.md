# Streams & Webhooks Examples

## Stream Filter Functions

### Basic Pass-Through Filter

```javascript
function main(data) {
  return data;
}
```

### Filter by Program ID

```javascript
function main(data) {
  const PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const accounts = data.transaction?.message?.accountKeys || [];

  if (!accounts.includes(PROGRAM_ID)) return null;

  return {
    signature: data.transaction.signatures[0],
    slot: data.slot,
    program: PROGRAM_ID,
    timestamp: new Date().toISOString(),
  };
}
```

### Token Transfer Detection

```javascript
function main(data) {
  const logs = data.meta?.logMessages || [];
  const isTransfer = logs.some(
    (log) => log.includes("Transfer") || log.includes("TransferChecked")
  );

  if (!isTransfer) return null;

  return {
    signature: data.transaction.signatures[0],
    slot: data.slot,
    preBalances: data.meta.preTokenBalances,
    postBalances: data.meta.postTokenBalances,
  };
}
```

### Dynamic Watchlist with Key-Value Store

```javascript
async function main(data) {
  const sender = data.transaction?.message?.accountKeys?.[0];
  if (!sender) return null;

  // Check against dynamic watchlist
  const watched = await qnLib.qnContainsListItems("vip-wallets", [sender]);
  if (!watched[0]) return null;

  // Track activity count
  const countResult = await qnLib.qnGetSet("activity-counts", sender);
  const count = countResult ? parseInt(countResult) + 1 : 1;
  await qnLib.qnAddSet("activity-counts", {
    key: sender,
    value: count.toString(),
  });

  return {
    sender,
    signature: data.transaction.signatures[0],
    slot: data.slot,
    activityCount: count,
  };
}
```

### Large Transaction Alert

```javascript
function main(data) {
  const MIN_SOL = 100;
  const preBalance = data.meta?.preBalances?.[0] || 0;
  const postBalance = data.meta?.postBalances?.[0] || 0;
  const change = Math.abs(preBalance - postBalance) / 1e9;

  if (change < MIN_SOL) return null;

  return {
    signature: data.transaction.signatures[0],
    slot: data.slot,
    solChange: change,
    direction: postBalance > preBalance ? "received" : "sent",
    sender: data.transaction.message.accountKeys[0],
  };
}
```

## Webhook Server Examples

### Express Webhook Handler

```typescript
import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Stream webhook destination
app.post("/stream", (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    console.log("Stream event:", {
      signature: event.signature,
      slot: event.slot,
    });

    // Process event asynchronously
    processEvent(event).catch(console.error);
  }

  // Respond quickly
  res.status(200).send("OK");
});

async function processEvent(event: any) {
  // Your processing logic
  console.log("Processing:", event.signature);
}

app.listen(3000, () => console.log("Webhook server on :3000"));
```

### Webhook with Deduplication

```typescript
import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

// Simple in-memory deduplication (use Redis in production)
const seen = new Set<string>();
const MAX_SEEN = 10_000;

app.post("/webhook", (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    const key = event.signature || JSON.stringify(event).slice(0, 64);

    if (seen.has(key)) {
      console.log("Duplicate skipped:", key);
      continue;
    }

    seen.add(key);
    if (seen.size > MAX_SEEN) {
      const first = seen.values().next().value;
      seen.delete(first);
    }

    processEvent(event).catch(console.error);
  }

  res.status(200).send("OK");
});

async function processEvent(event: any) {
  console.log("New event:", event.signature);
}

app.listen(3000);
```

## Admin API — Stream Management

### Create a Stream

```typescript
const response = await fetch(
  "https://api.quicknode.com/streams/rest/v1/streams",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.QUICKNODE_API_KEY!,
    },
    body: JSON.stringify({
      name: "Token Transfer Monitor",
      network: "solana-mainnet",
      dataset: "block",
      filter_function:
        'function main(data) { return data.meta?.logMessages?.some(l => l.includes("Transfer")) ? data : null; }',
      region: "usa_east",
      start_range: 0,
      end_range: 0, // 0 = live stream
      destination: {
        type: "webhook",
        url: "https://your-server.com/stream",
      },
    }),
  }
);

const stream = await response.json();
console.log("Stream created:", stream.id);
```

### List Streams

```typescript
const response = await fetch(
  "https://api.quicknode.com/streams/rest/v1/streams",
  {
    headers: { "x-api-key": process.env.QUICKNODE_API_KEY! },
  }
);

const streams = await response.json();
streams.forEach((s: any) => {
  console.log(`${s.name} (${s.id}) — ${s.status}`);
});
```
