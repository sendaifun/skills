# Quicknode Marketplace Add-ons Reference

Enhanced blockchain APIs available as add-ons to standard RPC endpoints. Enable add-ons in the Quicknode dashboard to access these methods.

**Marketplace:** https://marketplace.quicknode.com/

## Solana Add-ons

### DAS API (Metaplex Digital Asset Standard)

Unified API for querying Solana NFTs, compressed NFTs, fungible tokens, MPL Core Assets, and Token 2022 Assets. 12 methods available.

See [das-api-reference.md](./das-api-reference.md) for complete documentation.

### Yellowstone gRPC (Solana Geyser)

High-performance real-time data streaming via gRPC on port 10000.

See [yellowstone-grpc-reference.md](./yellowstone-grpc-reference.md) for complete documentation.

### Solana Priority Fee API

Get recommended priority fees for transaction landing.

```javascript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'qn_estimatePriorityFees',
    params: {
      last_n_blocks: 100,
      account: 'YourAccountPubkey...'
    }
  })
});
const { result } = await response.json();
```

**Response:**

```json
{
  "result": {
    "per_compute_unit": {
      "low": 100,
      "medium": 1000,
      "high": 10000,
      "extreme": 100000
    },
    "per_transaction": {
      "low": 1000,
      "medium": 10000,
      "high": 100000,
      "extreme": 1000000
    }
  }
}
```

### Metis — Jupiter Swap API

Access Jupiter DEX aggregator for swaps via REST endpoints on your Quicknode Solana endpoint. Enable the **Metis - Jupiter V6 Swap API** add-on.

> Set `QUICKNODE_METIS_URL` to your Quicknode Metis endpoint (e.g., `https://jupiter-swap-api.quiknode.pro/YOUR_TOKEN`). Do not use the public Jupiter API for production — it has lower rate limits and no SLA.

**Docs:** https://www.quicknode.com/docs/solana/metis-overview

**Using REST API:**

```javascript
// Get swap quote (GET request)
const quoteUrl = new URL(`${process.env.QUICKNODE_METIS_URL}/quote`);
quoteUrl.searchParams.set('inputMint', 'So11111111111111111111111111111111111111112');  // SOL
quoteUrl.searchParams.set('outputMint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
quoteUrl.searchParams.set('amount', '1000000000'); // 1 SOL in lamports
quoteUrl.searchParams.set('slippageBps', '50');     // 0.5% slippage

const quoteResponse = await fetch(quoteUrl.toString());
const quote = await quoteResponse.json();

// Execute swap (POST request)
const swapResponse = await fetch(`${process.env.QUICKNODE_METIS_URL}/swap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userPublicKey: 'YourPubkey...',
    quoteResponse: quote
  })
});

const { swapTransaction, lastValidBlockHeight } = await swapResponse.json();
// swapTransaction is a serialized transaction ready for signing and sending
```

**Using Jupiter SDK:**

```typescript
import { createJupiterApiClient } from '@jup-ag/api';

const jupiterApi = createJupiterApiClient({
  basePath: process.env.QUICKNODE_METIS_URL!,
});

const quote = await jupiterApi.quoteGet({
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: 1000000000,
  slippageBps: 50,
});

const swapResult = await jupiterApi.swapPost({
  swapRequest: {
    quoteResponse: quote,
    userPublicKey: 'YourPubkey...',
  },
});
```

**Metis Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/quote` | GET | Get swap quote |
| `/swap` | POST | Get swap transaction |
| `/swap-instructions` | POST | Get swap instructions (for custom transaction building) |
| `/tokens` | GET | List supported tokens |
| `/price` | GET | Get real-time SPL token prices |
| `/new-pools` | GET | List recently deployed liquidity pools and tokens |
| `/program-id-to-label` | GET | Map program IDs to DEX names |
| `/limit-orders/create` | POST | Create limit order |
| `/limit-orders/cancel` | POST | Cancel limit orders |
| `/limit-orders/open` | GET | Get all open limit orders for a wallet |
| `/limit-orders/{pubkey}` | GET | Get details of a specific limit order |
| `/limit-orders/history` | GET | Get limit order history for a wallet |
| `/limit-orders/fee` | GET | Get limit order fee in basis points |
| `/pump-fun/quote` | GET | Get Pump.fun quote |
| `/pump-fun/swap` | POST | Get Pump.fun swap transaction |
| `/pump-fun/swap-instructions` | POST | Get Pump.fun swap instructions (for custom transaction building) |
| `/ws` | WS | WebSocket quote — get swap quotes with lower latency |
| `/ws` | WS | WebSocket swap — get swap transactions from a quote |
| `/webhooks/referral-account` | POST | Webhook for referral account creation |
| `/webhooks/commission-claim` | POST | Webhook for claiming token commissions |
| `/webhooks/commission-swap` | POST | Webhook for commission swaps |

### Jito Bundles

MEV protection and bundle submission for Solana.

```javascript
// Submit bundle
const bundleResult = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [['Base58EncodedTx1...', 'Base58EncodedTx2...']]
  })
});

// Check bundle status
const status = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getBundleStatuses',
    params: [[bundleId]]
  })
});
```

**Jito Methods:**

| Method | Description |
|--------|-------------|
| `sendBundle` | Submit a bundle of transactions |
| `getBundleStatuses` | Get status of submitted bundles |
| `getInflightBundleStatuses` | Get status of in-flight bundles |
| `simulateBundle` | Simulate a bundle without submitting |
| `getTipAccounts` | Get current tip accounts |
| `getTipFloor` | Get minimum tip amount |
| `getRegions` | Get available regions |
| `sendTransaction` | Send Jito-routed transaction |

## EVM Add-ons

### Token API

Query wallet token balances across EVM chains.

```javascript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'qn_getWalletTokenBalance',
    params: [{
      wallet: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      contracts: []
    }]
  })
});
const { result } = await response.json();
// result.assets: Array of { address, name, symbol, decimals, balance, balanceUSD }
```

**Token API Methods:**

| Method | Description |
|--------|-------------|
| `qn_getWalletTokenBalance` | Get all ERC-20 balances for an address |
| `qn_getTokenMetadataByContractAddress` | Get token metadata by contract |
| `qn_getTokenMetadataBySymbol` | Get token metadata by symbol |

### NFT API

Query NFTs owned by addresses on EVM chains.

```javascript
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'qn_fetchNFTs',
    params: [{
      wallet: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      page: 1,
      perPage: 10,
      contracts: []
    }]
  })
});
const { result } = await response.json();
// result.assets: Array of NFT objects
// result.totalItems: Total count
// result.pageNumber: Current page
```

**NFT API Methods:**

| Method | Description |
|--------|-------------|
| `qn_fetchNFTs` | Fetch NFTs owned by an address |
| `qn_fetchNFTCollectionDetails` | Get collection-level metadata |
| `qn_fetchNFTsByCollection` | Fetch NFTs from a specific collection |
| `qn_verifyNFTsOwner` | Verify NFT ownership |

### Trace & Debug APIs

```javascript
// trace_call — trace without executing
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'trace_call',
    params: [{ to: '0xContract...', data: '0xSelector...' }, ['trace'], 'latest']
  })
});

// debug_traceTransaction — detailed transaction debugging
const response = await fetch(process.env.QUICKNODE_RPC_URL!, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'debug_traceTransaction',
    params: ['0xTxHash...', { tracer: 'callTracer' }]
  })
});
```

## Add-on Availability by Chain

| Add-on | Ethereum | Polygon | Arbitrum | Base | Solana |
|--------|----------|---------|----------|------|--------|
| Token API | Yes | — | — | — | — |
| NFT API | Yes | — | — | — | DAS |
| Trace API | Yes | Yes | Yes | Yes | — |
| Debug API | Yes | Yes | Yes | Yes | — |
| Archive | Yes | Yes | Yes | Yes | — |
| Priority Fee | — | — | — | — | Yes |
| Jupiter/Metis | — | — | — | — | Yes |
| Yellowstone | — | — | — | — | Yes |
| Jito | — | — | — | — | Yes |

## Credit Costs

Add-on methods consume credits based on complexity:

| Method Type | Credits |
|-------------|---------|
| Token balance | 50 |
| NFT fetch | 100 |
| Collection details | 50 |
| Trace call | 200 |
| Debug trace | 500 |
| Archive query | 100 |

## Enabling Add-ons

1. Navigate to your endpoint in the Quicknode dashboard
2. Click **Add-ons** tab
3. Browse the marketplace or search for the add-on
4. Click **Enable** and configure if needed
5. The add-on methods become available on your existing endpoint URL

## Documentation

- **Marketplace**: https://marketplace.quicknode.com/
- **Token API**: https://www.quicknode.com/docs/ethereum/qn_getWalletTokenBalance
- **NFT API**: https://www.quicknode.com/docs/ethereum/qn_fetchNFTs
- **Solana Add-ons**: https://www.quicknode.com/docs/solana
- **Metis Jupiter API**: https://www.quicknode.com/docs/solana/metis-overview
- **DAS API**: https://www.quicknode.com/docs/solana/solana-das-api
- **Trace API**: https://www.quicknode.com/docs/ethereum/trace_call
- **Guides**: https://www.quicknode.com/guides/tags/marketplace
