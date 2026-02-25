# Quicknode RPC Endpoints Reference

Quicknode provides low-latency JSON-RPC, WebSocket, and REST endpoints for 80+ blockchain networks with built-in authentication, global load balancing, and per-method documentation.

**Docs:** https://www.quicknode.com/docs/

| Property | Value |
|----------|-------|
| **Protocol** | JSON-RPC 2.0 (HTTP + WebSocket), REST (Beacon Chain) |
| **Chains** | 80+ networks (EVM, Solana, Bitcoin, and more) |
| **Authentication** | Token in URL path, optional JWT or IP allowlisting |
| **Solana Libraries** | @solana/kit, @solana/web3.js |
| **EVM Libraries** | ethers.js, viem, web3.js |
| **Endpoint Format** | `https://{name}.{network}.quiknode.pro/{token}/` |
| **WebSocket Format** | `wss://{name}.{network}.quiknode.pro/{token}/` |
| **Per-Method Docs** | `https://www.quicknode.com/docs/{chain}/{method}` |

## Solana Connection Setup

```typescript
// @solana/kit — HTTP
import { createSolanaRpc } from '@solana/kit';
const rpc = createSolanaRpc(process.env.QUICKNODE_RPC_URL!);

// @solana/kit — WebSocket
import { createSolanaRpcSubscriptions } from '@solana/kit';
const rpcSubscriptions = createSolanaRpcSubscriptions(process.env.QUICKNODE_WSS_URL!);
```

## Solana RPC Methods

### Standard Methods

| Category | Methods |
|----------|---------|
| **Account** | `getAccountInfo`, `getMultipleAccounts`, `getProgramAccounts`, `getLargestAccounts`, `getMinimumBalanceForRentExemption` |
| **Balance** | `getBalance`, `getTokenAccountBalance`, `getTokenAccountsByOwner`, `getTokenAccountsByDelegate`, `getTokenLargestAccounts`, `getTokenSupply` |
| **Block** | `getBlock`, `getBlockCommitment`, `getBlockHeight`, `getBlockProduction`, `getBlocks`, `getBlocksWithLimit`, `getBlockTime`, `getFirstAvailableBlock` |
| **Transaction** | `getTransaction`, `getParsedTransaction`, `getTransactionCount`, `getSignaturesForAddress`, `getSignatureStatuses`, `simulateTransaction`, `sendTransaction` |
| **Slot** | `getSlot`, `getSlotLeader`, `getSlotLeaders`, `getHighestSnapshotSlot`, `getMaxRetransmitSlot`, `getMaxShredInsertSlot` |
| **Fees** | `getFeeForMessage`, `getRecentPrioritizationFees` |
| **Epoch & Inflation** | `getEpochInfo`, `getEpochSchedule`, `getInflationGovernor`, `getInflationRate`, `getInflationReward`, `getLeaderSchedule` |
| **Network** | `getClusterNodes`, `getHealth`, `getIdentity`, `getVersion`, `getGenesisHash`, `getSupply`, `getVoteAccounts`, `getStakeMinimumDelegation`, `getRecentPerformanceSamples`, `minimumLedgerSlot` |
| **Utility** | `isBlockhashValid`, `requestAirdrop` (testnet/devnet only) |

### Code Examples

**Get balance and account info:**

```typescript
import { createSolanaRpc } from '@solana/kit';
import { address } from '@solana/addresses';

const rpc = createSolanaRpc(process.env.QUICKNODE_RPC_URL!);

const balance = await rpc.getBalance(address('E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk')).send();
// balance.value: bigint (lamports)

const accountInfo = await rpc.getAccountInfo(address('E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk'), {
  encoding: 'base64',
}).send();
// accountInfo.value: { data, executable, lamports, owner, rentEpoch }
```

**Send transaction:**

```typescript
// Transaction must be signed before sending
const signature = await rpc.sendTransaction(signedTransactionBytes, {
  encoding: 'base64',
  skipPreflight: false,
  preflightCommitment: 'confirmed',
}).send();
// signature: base-58 encoded transaction signature
```

**Get program accounts (with filters):**

```typescript
const accounts = await rpc.getProgramAccounts(
  address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  {
    encoding: 'base64',
    filters: [
      { dataSize: 165n }, // Token account size
      { memcmp: { offset: 32n, bytes: 'OwnerPubkeyBase58...' as `${string}`, encoding: 'base58' } },
    ],
  }
).send();
// accounts: Array of { pubkey, account: { data, executable, lamports, owner } }
```

### Solana WebSocket Subscriptions

| Subscription | Description |
|-------------|-------------|
| `accountSubscribe` | Monitor changes to a specific account |
| `programSubscribe` | Monitor all accounts owned by a program |
| `logsSubscribe` | Subscribe to transaction log output |
| `signatureSubscribe` | Track confirmation of a specific transaction |
| `slotSubscribe` | Monitor slot progression |
| `blockSubscribe` | Track new confirmed/finalized blocks |
| `rootSubscribe` | Receive root slot notifications |
| `slotsUpdatesSubscribe` | Detailed slot update notifications |

```typescript
import { createSolanaRpcSubscriptions } from '@solana/kit';
import { address } from '@solana/addresses';

const rpcSubscriptions = createSolanaRpcSubscriptions(process.env.QUICKNODE_WSS_URL!);

// Subscribe to account changes
const accountNotifications = await rpcSubscriptions
  .accountNotifications(address('E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk'), { commitment: 'confirmed' })
  .subscribe({ abortSignal: AbortSignal.timeout(60_000) });

for await (const notification of accountNotifications) {
  console.log('Account changed:', notification.value.lamports);
}
```

### Solana-Specific Add-on Methods

| Category | Methods |
|----------|---------|
| **Priority Fees** | `qn_estimatePriorityFees` |
| **DAS (Digital Asset Standard)** | `getAsset`, `getAssets`, `getAssetProof`, `getAssetProofs`, `getAssetsByOwner`, `getAssetsByCreator`, `getAssetsByAuthority`, `getAssetsByGroup`, `getAssetSignatures`, `getTokenAccounts`, `getNftEditions`, `searchAssets` |
| **Jito Bundles** | `sendBundle`, `getBundleStatuses`, `getInflightBundleStatuses`, `simulateBundle`, `getTipAccounts`, `getTipFloor`, `getRegions` |
| **Jito Transaction** | `sendTransaction` (Jito-routed) |
| **Metis (Jupiter)** | `/quote`, `/swap`, `/swap-instructions`, `/tokens`, `/price`, `/new-pools`, `/program-id-to-label` |
| **Metis Limit Orders** | `/limit-orders/{pubkey}`, `/limit-orders/create`, `/limit-orders/cancel`, `/limit-orders/fee`, `/limit-orders/history`, `/limit-orders/open` |
| **Metis Pump.fun** | `/pump-fun/quote`, `/pump-fun/swap`, `/pump-fun/swap-instructions` |

## EVM Connection Setup

```typescript
// ethers.js
import { JsonRpcProvider, WebSocketProvider } from 'ethers';
const provider = new JsonRpcProvider(process.env.QUICKNODE_RPC_URL!);
const wsProvider = new WebSocketProvider(process.env.QUICKNODE_WSS_URL!);

// viem
import { createPublicClient, http, webSocket } from 'viem';
import { mainnet } from 'viem/chains';
const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.QUICKNODE_RPC_URL!),
});
```

## EVM RPC Methods

| Category | Methods |
|----------|---------|
| **Account** | `eth_getBalance`, `eth_getCode`, `eth_getStorageAt`, `eth_getAccount`, `eth_getTransactionCount`, `eth_getProof` |
| **Block** | `eth_blockNumber`, `eth_getBlockByHash`, `eth_getBlockByNumber`, `eth_getBlockReceipts`, `eth_getBlockTransactionCountByHash`, `eth_getBlockTransactionCountByNumber` |
| **Transaction** | `eth_getTransactionByHash`, `eth_getTransactionByBlockHashAndIndex`, `eth_getTransactionByBlockNumberAndIndex`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`, `eth_getRawTransactionByHash` |
| **Call & Simulate** | `eth_call`, `eth_estimateGas`, `eth_simulateV1`, `eth_callMany` |
| **Logs & Filters** | `eth_getLogs`, `eth_newFilter`, `eth_newBlockFilter`, `eth_newPendingTransactionFilter`, `eth_getFilterChanges`, `eth_getFilterLogs`, `eth_uninstallFilter` |
| **Gas & Fees** | `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_blobBaseFee` |
| **Network** | `eth_chainId`, `eth_syncing`, `net_version`, `net_listening`, `net_peerCount`, `web3_clientVersion`, `web3_sha3` |
| **Subscription** | `eth_subscribe`, `eth_unsubscribe` |

### EVM Code Examples

```typescript
// Get balance
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'eth_getBalance',
    params: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'latest'],
  }),
});
// result: "0x..." (balance in wei, hex-encoded)

// Get logs (filter by contract events)
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'eth_getLogs',
    params: [{
      fromBlock: '0x118C5E0',
      toBlock: '0x118C5FF',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
    }],
  }),
});
// result: Array of log objects { address, topics, data, blockNumber, transactionHash }
```

### Debug, Trace & Extended Namespaces

| Namespace | Methods |
|-----------|---------|
| **debug** | `debug_traceTransaction`, `debug_traceCall`, `debug_traceBlock`, `debug_traceBlockByHash`, `debug_traceBlockByNumber`, `debug_getBadBlocks`, `debug_storageRangeAt` |
| **trace** (Erigon) | `trace_block`, `trace_call`, `trace_callMany`, `trace_filter`, `trace_rawTransaction`, `trace_replayBlockTransactions`, `trace_replayTransaction`, `trace_transaction` |
| **txpool** (Geth) | `txpool_content`, `txpool_contentFrom`, `txpool_inspect`, `txpool_status` |

### Quicknode Custom Methods (qn_*)

| Method | Description |
|--------|-------------|
| `qn_getBlockFromTimestamp` | Find block closest to a Unix timestamp |
| `qn_getBlocksInTimestampRange` | List blocks within a timestamp range |
| `qn_getBlockWithReceipts` | Get block data with all transaction receipts |
| `qn_getReceipts` | Batch-fetch receipts for a block |
| `qn_broadcastRawTransaction` | Multi-region transaction broadcast |
| `qn_resolveENS` | Resolve ENS name to address (and reverse) |
| `qn_fetchNFTs` | Fetch NFTs owned by an address |
| `qn_fetchNFTCollectionDetails` | Get collection-level metadata |
| `qn_fetchNFTsByCollection` | Fetch NFTs from a specific collection |
| `qn_getTokenMetadataByContractAddress` | Token metadata by contract |
| `qn_getTokenMetadataBySymbol` | Token metadata by symbol |
| `qn_getWalletTokenBalance` | All ERC-20 balances for a wallet |
| `qn_getWalletTokenTransactions` | Token transfer history for a wallet |
| `qn_getTransactionsByAddress` | Transaction history for an address |
| `qn_verifyNFTsOwner` | Verify NFT ownership |

### EVM WebSocket Subscriptions

| Type | Description |
|------|-------------|
| `newHeads` | New block headers as they are mined |
| `logs` | Log entries matching a filter (address, topics) |
| `newPendingTransactions` | Transaction hashes entering the mempool |
| `syncing` | Node sync status changes |

## Bitcoin Connection Setup

```typescript
async function btcRpc(method: string, params: unknown[] = []) {
  const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const { result, error } = await response.json();
  if (error) throw new Error(`${error.code}: ${error.message}`);
  return result;
}
```

## Bitcoin RPC Methods

| Category | Methods |
|----------|---------|
| **Blockchain** | `getbestblockhash`, `getblock`, `getblockchaininfo`, `getblockcount`, `getblockhash`, `getblockheader`, `getblockstats`, `getchaintips`, `getchaintxstats` |
| **Transaction** | `getrawtransaction`, `decoderawtransaction`, `decodescript`, `sendrawtransaction`, `gettxout`, `gettxoutproof`, `gettxoutsetinfo`, `testmempoolaccept` |
| **Mempool** | `getrawmempool`, `getmempoolancestors`, `getmempooldescendants`, `getmempoolinfo` |
| **Mining & Network** | `getdifficulty`, `getmininginfo`, `estimatesmartfee`, `getconnectioncount`, `getnetworkinfo` |
| **Ordinals** | `ord_getInscription`, `ord_getInscriptions`, `ord_getInscriptionsByBlock`, `ord_getContent`, `ord_getMetadata`, `ord_getCollections` |
| **Runes** | `ord_getRune`, `ord_getRunes` |
| **Blockbook** | `bb_getAddress`, `bb_getBalanceHistory`, `bb_getBlock`, `bb_getTx`, `bb_getUTXOs` |

## Batch Requests

Send multiple RPC calls in a single HTTP request:

```typescript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'getBlockHeight', params: [] },
    { jsonrpc: '2.0', id: 3, method: 'getBalance', params: ['E645TckHQnDcavVv92Etc6xSWQaq8zzPtPRGBheviRAk'] },
  ]),
});
const results = await response.json();
// results[0].result — slot
// results[1].result — block height
// results[2].result — balance object
```

## Best Practices

1. **Use WebSocket for subscriptions** — HTTP polling wastes requests and adds latency. Use `wss://` endpoints for real-time data.
2. **Batch read requests** — Combine multiple queries into a single batch request to reduce round trips and credit usage.
3. **Cache immutable data** — Block data, transaction receipts, and finalized results never change. Cache them locally.
4. **Retry with exponential backoff** — On 429 (rate limit) or network errors, retry with increasing delays: 1s, 2s, 4s, up to 30s max.
5. **Use archive endpoints for historical data** — Queries against old blocks require archive mode. Enable it on your endpoint.
6. **Set Solana commitment levels appropriately** — Use `confirmed` for most reads, `finalized` when irreversibility matters, and `processed` only for lowest latency.
7. **Consult chain-specific llms.txt for method details** — `https://www.quicknode.com/docs/{chain}/llms.txt`

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Method not found` | Method not available on plan or endpoint type | Check method availability; some require add-ons or archive mode |
| `429 Too Many Requests` | Rate limit exceeded | Implement backoff/retry; batch requests; upgrade plan |
| `execution reverted` | Smart contract call failed | Check `to` address, `data` encoding, block tag; use `eth_estimateGas` first |
| Empty `eth_getLogs` result | Block range too narrow or wrong address/topics | Widen range; verify contract address and topic hashes |
| Solana `blockhash expired` | Transaction submitted too late | Fetch fresh blockhash immediately before signing; use `isBlockhashValid` |
| WebSocket disconnects | Idle timeout or server maintenance | Implement automatic reconnection with exponential backoff |

## Documentation

- **Solana**: https://www.quicknode.com/docs/solana
- **Ethereum**: https://www.quicknode.com/docs/ethereum
- **Bitcoin**: https://www.quicknode.com/docs/bitcoin
- **Full Chain List**: https://www.quicknode.com/chains
- **LLM-Optimized Docs**: `https://www.quicknode.com/docs/{chain}/llms.txt`
