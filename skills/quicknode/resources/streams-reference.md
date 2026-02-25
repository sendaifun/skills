# Quicknode Streams Reference

Real-time and historical blockchain data pipelines that filter, transform, and deliver data to various destinations.

**Docs:** https://www.quicknode.com/docs/streams

## Architecture

Blockchain → Quicknode Node → Filter Function → Transform → Destination

## Stream Types

| Stream Type | `dataset` Value | Description |
|-------------|----------------|-------------|
| Block | `block` | Full block data including all transactions |
| Block with Receipts | `block_with_receipts` | Block data with transaction receipts |
| Transaction | `transaction` | Individual transaction data |
| Logs | `log` | Contract event logs |
| Receipt | `receipt` | Transaction receipts with execution results |

## Filter Functions

Filter functions are JavaScript functions that receive raw blockchain data and return transformed output. Return `null` to skip the record.

### Function Signature

```javascript
function main(data) {
  // data — raw blockchain data (block, transaction, log, or receipt)
  // Return processed data or null to filter out
  return data;
}
```

### EVM Examples

**Monitor specific contract:**

```javascript
function main(data) {
  const TARGET = "0xdAC17F958D2ee523a2206206994597C13D831ec7"; // USDT
  const logs = data.logs || [];
  const relevant = logs.filter((log) => log.address.toLowerCase() === TARGET.toLowerCase());
  if (relevant.length === 0) return null;
  return { blockNumber: data.number, logs: relevant };
}
```

**Track whale transactions (>1000 ETH):**

```javascript
function main(data) {
  const MIN_VALUE = BigInt("1000000000000000000000"); // 1000 ETH
  const txs = (data.transactions || []).filter((tx) => BigInt(tx.value) >= MIN_VALUE);
  if (txs.length === 0) return null;
  return {
    blockNumber: data.number,
    whaleTransactions: txs.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: (Number(BigInt(tx.value)) / 1e18).toFixed(4) + " ETH",
    })),
  };
}
```

**NFT transfer tracking (ERC-721):**

```javascript
function main(data) {
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const nftTransfers = (data.logs || []).filter(
    (log) => log.topics[0] === TRANSFER_TOPIC && log.topics.length === 4
  );
  if (nftTransfers.length === 0) return null;
  return {
    blockNumber: data.number,
    transfers: nftTransfers.map((log) => ({
      contract: log.address,
      from: "0x" + log.topics[1].slice(26),
      to: "0x" + log.topics[2].slice(26),
      tokenId: parseInt(log.topics[3], 16),
      txHash: log.transactionHash,
    })),
  };
}
```

### Solana Examples

**Monitor program logs:**

```javascript
function main(data) {
  const PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const accounts = data.transaction?.message?.accountKeys || [];
  if (!accounts.includes(PROGRAM_ID)) return null;
  return {
    signature: data.transaction.signatures[0],
    slot: data.slot,
    logs: data.meta?.logMessages,
  };
}
```

**Track large SOL transfers:**

```javascript
function main(data) {
  const MIN_SOL = 1000;
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

### Filter with Key-Value Store

```javascript
async function main(data) {
  const sender = data.transaction?.message?.accountKeys?.[0];
  if (!sender) return null;

  // Check against dynamic watchlist
  const watched = await qnLib.qnContainsListItems("watchlist", [sender]);
  if (!watched[0]) return null;

  // Track transaction count
  const countResult = await qnLib.qnGetSet("tx-counts", sender);
  const count = countResult ? parseInt(countResult) + 1 : 1;
  await qnLib.qnAddSet("tx-counts", { key: sender, value: count.toString() });

  return {
    sender,
    signature: data.transaction.signatures[0],
    totalTransactions: count,
  };
}
```

## Destinations

### Webhook

```json
{
  "type": "webhook",
  "url": "https://your-server.com/stream",
  "headers": { "Authorization": "Bearer YOUR_TOKEN" },
  "retry": { "max_retries": 3, "backoff_ms": 1000 }
}
```

### Amazon S3

```json
{
  "type": "s3",
  "bucket": "your-bucket",
  "region": "us-east-1",
  "prefix": "streams/",
  "format": "json",
  "compression": "gzip"
}
```

### PostgreSQL

```json
{
  "type": "postgresql",
  "connection_string": "postgresql://user:pass@host:5432/db",
  "schema": "public",
  "table": "stream_events"
}
```

### Snowflake

```json
{
  "type": "snowflake",
  "account": "your-account",
  "database": "your-db",
  "schema": "public",
  "table": "events"
}
```

## Key-Value Store Integration

Streams filter functions can use the `qnLib` helper to persist state across invocations. All methods are async.

**List operations:**
- `qnLib.qnUpsertList(name, items)` — create or update a list
- `qnLib.qnAddListItem(name, item)` — add item to a list
- `qnLib.qnRemoveListItem(name, item)` — remove item from a list
- `qnLib.qnContainsListItems(name, items)` — batch membership check
- `qnLib.qnDeleteList(name)` — delete a list

**Set operations:**
- `qnLib.qnAddSet(name, { key, value })` — create a key-value pair
- `qnLib.qnGetSet(name, key)` — retrieve value by key
- `qnLib.qnBulkSets(name, operations)` — bulk create/remove sets
- `qnLib.qnDeleteSet(name)` — delete a set

## Stream Management API

### Create Stream

```typescript
const response = await fetch("https://api.quicknode.com/streams/rest/v1/streams", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.QUICKNODE_API_KEY!,
  },
  body: JSON.stringify({
    name: "Token Transfer Monitor",
    network: "solana-mainnet",
    dataset: "block",
    filter_function: 'function main(data) { return data; }',
    region: "usa_east",
    start_range: 0,
    end_range: 0, // 0 = live stream
    destination: {
      type: "webhook",
      url: "https://your-server.com/stream",
    },
  }),
});
```

### List Streams

```typescript
const response = await fetch("https://api.quicknode.com/streams/rest/v1/streams", {
  headers: { "x-api-key": process.env.QUICKNODE_API_KEY! },
});
```

### Update Stream

```typescript
const response = await fetch(`https://api.quicknode.com/streams/rest/v1/streams/${streamId}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.QUICKNODE_API_KEY!,
  },
  body: JSON.stringify({ status: "paused" }),
});
```

### Delete Stream

```typescript
const response = await fetch(`https://api.quicknode.com/streams/rest/v1/streams/${streamId}`, {
  method: "DELETE",
  headers: { "x-api-key": process.env.QUICKNODE_API_KEY! },
});
```

## Best Practices

1. Start with narrow filters and expand as needed
2. Test filter functions locally before deployment
3. Use Key-Value Store for dynamic filtering (watchlists, state tracking)
4. Monitor stream health via the Quicknode dashboard
5. Streams automatically retry on destination failures
6. Design consumers for idempotent duplicate handling

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No data received | Overly restrictive filter | Broaden filter conditions; return `data` without filtering to test |
| Webhook failures | Endpoint unavailable or timeout | Verify server health and response time (<30s) |
| Data lag | Processing backlog | Optimize filter function performance |
| Missing events | Incorrect event signatures or topics | Validate topic hashes and program IDs |
| Filter errors | Syntax or runtime errors in filter function | Check stream logs in dashboard; test locally first |

## Documentation

- **Streams Overview**: https://www.quicknode.com/docs/streams
- **Filter Functions**: https://www.quicknode.com/docs/streams/filter-functions
- **Destinations**: https://www.quicknode.com/docs/streams/destinations
- **REST API**: https://www.quicknode.com/docs/streams/rest-api
- **Guides**: https://www.quicknode.com/guides/tags/streams
