---
name: lifi
creator: LI.FI
description: Integrate LI.FI for cross-chain swaps, bridging, payments, route discovery, and transfer status tracking across Solana, EVM, Bitcoin, and Sui. Use when building Solana applications or AI agents that need quotes, routes, executable transactions, supported chains/tokens/tools, or cross-chain transfer monitoring.
---

# LI.FI Cross-Chain Integration Guide

Use LI.FI when a Solana app, wallet, backend, or AI agent needs cross-chain token transfers, bridge aggregation, same-chain swaps, payment flows, or transfer status tracking. LI.FI exposes the same routing engine through REST API, SDK, MCP server, CLI, and Widget surfaces.

## Overview

LI.FI is a multi-chain liquidity aggregation platform for swaps and bridging. For agent and backend integrations, the REST API is the lowest-dependency default. For frontend apps, prefer the SDK because it handles wallets, signing, execution tracking, and ecosystem-specific transaction handling. For MCP-compatible AI hosts, prefer the LI.FI MCP server for typed tool discovery.

Core capabilities:

- **Quotes**: Get a ready-to-sign transaction for the best route.
- **Routes**: Compare multiple route options and execute step-by-step.
- **Status tracking**: Track source and destination chain transfer progress.
- **Discovery**: Query supported chains, tokens, bridges, and exchanges at runtime.
- **Solana support**: Request Solana-specific chain/token data via `chainTypes=SVM` and use `SOL` as the Solana chain key in API examples.

## Product Surface Selection

Choose the smallest surface that matches the task:

- **REST API**: Backend services, scripts, and general AI agents. Simple HTTP calls, no runtime dependency.
- **SDK (`@lifi/sdk`)**: Frontend or full execution flows. Handles wallet connectors, signing, route execution, and update hooks.
- **MCP Server**: MCP-compatible AI hosts such as Claude, Cursor, or Windsurf. Use when typed tool discovery is available.
- **CLI**: Token-efficient agent workflows where compact human-readable output is preferable to raw JSON.
- **Widget**: Ready-made UI when the user wants embedded swap/bridge UX rather than custom integration.

Do not force every integration through the SDK. For quote lookup, route comparison, or status checks, the API is often simpler and easier to audit.

## Base URLs and Authentication

```text
Production API: https://li.quest/v1
Staging API:    https://staging.li.quest/v1
Docs:           https://docs.li.fi
OpenAPI:        https://docs.li.fi/openapi.yaml
LLM overview:   https://docs.li.fi/llms.txt
```

LI.FI APIs can be used without an API key. Use the `x-lifi-api-key` header when the integrator has a key or needs higher rate limits.

```bash
curl 'https://li.quest/v1/chains?chainTypes=EVM,SVM' \
  --header 'accept: application/json' \
  --header 'x-lifi-api-key: YOUR_API_KEY_IF_AVAILABLE'
```

## Integration Workflow

1. **Clarify the transfer intent**
   - Source chain, destination chain, source token, destination token.
   - Amount in the token's smallest unit.
   - Sender address and, when different, recipient address.
   - Whether the user wants a single best route or route comparison.

2. **Discover support instead of hardcoding**
   - Use `/chains` to verify chains.
   - Use `/tokens` or `/token` to verify token addresses and decimals.
   - Use `/tools` to list current bridges and exchanges.
   - Do not assume every token, bridge, or chain pair is available.

3. **Choose quote vs routes**
   - Use `GET /quote` for a simple transfer where the best executable route is enough.
   - Use `POST /advanced/routes` when comparing alternatives or when the user asks for route choice, cost, speed, tool allowlists, or multiple steps.
   - Use `POST /advanced/stepTransaction` to populate transaction data for individual route steps when executing advanced routes.

4. **Show the user what they will sign**
   - Summarize from-chain, to-chain, from-token, to-token, amount, estimated output, tool/bridge, fees, recipient, and slippage.
   - Never ask a user to sign opaque transaction data without a human-readable summary.

5. **Execute through the appropriate wallet path**
   - EVM transaction requests usually include fields such as `to`, `data`, `value`, and gas fields.
   - Solana-originating transfers return Solana transaction data as base64 in `transactionRequest.data`; deserialize, sign, and send through the user's Solana wallet or SDK path.
   - Never mutate `transactionRequest.data`, calldata, recipient, refund, memo, or bridge-specific payloads after receiving them from LI.FI.

6. **Track status after source-chain submission**
   - Poll `/status` every 10-30 seconds until terminal status.
   - Include `fromChain`, `toChain`, and `bridge` from the quote when available to speed up lookup.
   - Treat source-chain confirmation as only the start of a cross-chain transfer, not proof of final delivery.

## Minimal Endpoint Set

### Get a quote

Use for a single best route with transaction data included.

```bash
curl --request GET \
  --url 'https://li.quest/v1/quote?fromChain=ARB&toChain=SOL&fromToken=0xaf88d065e77c8cC2239327C5EDb3A432268e5831&toToken=7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs&fromAddress=YOUR_EVM_WALLET&toAddress=YOUR_SOL_WALLET&fromAmount=1000000000' \
  --header 'accept: application/json'
```

Required parameters:

- `fromChain`: source chain ID or key.
- `toChain`: destination chain ID or key.
- `fromToken`: source token symbol or address.
- `toToken`: destination token symbol or address.
- `fromAmount`: amount in smallest unit.
- `fromAddress`: sender wallet address.
- `toAddress`: recipient wallet address when different from sender or when bridging across ecosystems.

### Get multiple routes

Use when the user asks to compare routes or when the application needs route selection.

```bash
curl --request POST \
  --url 'https://li.quest/v1/advanced/routes' \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{
    "fromChainId": "ARB",
    "toChainId": "SOL",
    "fromTokenAddress": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "toTokenAddress": "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    "fromAmount": "1000000000",
    "fromAddress": "YOUR_EVM_WALLET",
    "toAddress": "YOUR_SOL_WALLET"
  }'
```

### Check transfer status

```bash
curl --request GET \
  --url 'https://li.quest/v1/status?txHash=SOURCE_TX_HASH&fromChain=ARB&toChain=SOL&bridge=BRIDGE_KEY' \
  --header 'accept: application/json'
```

Status handling:

- `NOT_FOUND`: Transaction may not be indexed or mined yet. Retry with `fromChain` and bridge if known.
- `PENDING`: Continue polling.
- `DONE` + `COMPLETED`: Successful final delivery.
- `DONE` + `PARTIAL`: Successful but output token may differ while preserving value semantics.
- `DONE` + `REFUNDED`: Transfer failed but funds were refunded.
- `FAILED`: Stop polling and surface the error/substatus.

### List supported chains

```bash
curl --request GET \
  --url 'https://li.quest/v1/chains?chainTypes=EVM,SVM' \
  --header 'accept: application/json'
```

Solana-only:

```bash
curl --request GET \
  --url 'https://li.quest/v1/chains?chainTypes=SVM' \
  --header 'accept: application/json'
```

### List Solana tokens

```bash
curl --request GET \
  --url 'https://li.quest/v1/tokens?chains=SOL&chainTypes=SVM' \
  --header 'accept: application/json'
```

### List bridges and exchanges

```bash
curl --request GET \
  --url 'https://li.quest/v1/tools' \
  --header 'accept: application/json'
```

## Solana-Specific Guidance

Use this section whenever either side of the transfer is Solana.

- Use `chainTypes=SVM` when querying Solana chain support.
- Use `SOL` as the Solana chain key in API examples.
- Always pass a Solana `toAddress` when bridging from an EVM chain to Solana; the sender's EVM address is not a valid Solana recipient.
- For SOL -> EVM transfers, expect `transactionRequest.data` to contain base64-encoded Solana transaction data. This is not EVM calldata.
- Use a Solana wallet adapter or the LI.FI SDK to deserialize, sign, and submit Solana transactions. Do not manually rebuild the transaction unless the docs for the exact flow require it.
- Validate token decimals from `/tokens` or `/token`; do not assume EVM and Solana versions of a token share decimals or addresses.
- If status is slow, pass the source transaction hash plus `fromChain`, `toChain`, and bridge/tool key from the quote.

## SDK Usage Pattern

Prefer the SDK when building a frontend or when the agent needs full route execution rather than only quote/status lookup.

```bash
npm install @lifi/sdk
```

```typescript
import { createConfig, getQuote } from '@lifi/sdk'

createConfig({
  integrator: 'YourAppName',
})

const quote = await getQuote({
  fromChain: 'ARB',
  toChain: 'SOL',
  fromToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  toToken: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  fromAmount: '1000000000',
  fromAddress: 'YOUR_EVM_WALLET',
  toAddress: 'YOUR_SOL_WALLET',
})

console.log(quote.estimate.toAmount, quote.tool, quote.transactionRequest)
```

If executing routes, configure the correct wallet clients/providers for every ecosystem involved and surface route updates to the user.

## Error Handling

Handle both HTTP status codes and LI.FI API error codes.

Common API error codes:

- `1002 NoQuoteError`: No quote was found. Try another token, amount, destination, or route constraint.
- `1005 RateLimitError`: Back off and retry; use API key for higher limits if available.
- `1007 SlippageError`: Ask the user before increasing slippage.
- `1008 ThirdPartyError`: A bridge/exchange/tool failed. Retry later or request alternative routes.
- `1009 TimeoutError`: Retry with backoff or use route comparison to find another tool.
- `1011 ValidationError`: Check chain IDs, token addresses, amount units, and address format.
- `1012 RpcFailure`: Retry later or configure a more reliable RPC through the SDK when applicable.

Common tool error codes:

- `NO_POSSIBLE_ROUTE`: No supported path for the requested action.
- `INSUFFICIENT_LIQUIDITY`: Reduce amount or choose another token/path.
- `TOOL_TIMEOUT`: Retry or exclude the timing-out tool if the API request supports tool constraints.
- `AMOUNT_TOO_LOW` / `AMOUNT_TOO_HIGH`: Adjust amount.
- `FEES_HIGHER_THAN_AMOUNT`: Amount is uneconomic; increase transfer size or choose another route.
- `DIFFERENT_RECIPIENT_NOT_SUPPORTED`: Use the same sender/recipient where required or choose another tool.
- `CANNOT_GUARANTEE_MIN_AMOUNT`: Explain the risk and ask the user before proceeding.

## Guidelines

- **DO** query live chains, tokens, and tools before giving integration advice.
- **DO** use `/quote` for simple execution and `/advanced/routes` for comparison.
- **DO** show estimated output, fees, bridge/exchange tool, recipient, and slippage before signing.
- **DO** poll `/status` for cross-chain transfers until a terminal state.
- **DO** preserve LI.FI transaction data exactly as returned.
- **DO NOT** hardcode stale bridge lists, token lists, or chain support.
- **DO NOT** treat source-chain confirmation as final cross-chain completion.
- **DO NOT** increase slippage, change recipients, or alter transaction data without explicit user consent.
- **DO NOT** store or request private keys. Use wallet signing flows.
- **DO NOT** present the Widget as the only integration path when the API or SDK fits better.

## Common Errors

### Error: No route found

**Cause:** Unsupported chain/token pair, insufficient liquidity, amount too small or too large, or restrictive route options.

**Solution:** Verify `/chains`, `/tokens`, and `/tools`; try canonical token addresses; adjust amount; request `/advanced/routes` for alternatives.

### Error: Solana transaction data treated like EVM calldata

**Cause:** A SOL-originating quote returns base64 Solana transaction data in `transactionRequest.data`, not an EVM `to/data/value` call.

**Solution:** Use a Solana wallet/SDK path to deserialize, sign, and submit the transaction. Do not send it through an EVM provider.

### Error: Status endpoint returns `NOT_FOUND`

**Cause:** Transaction not indexed yet, wrong source transaction hash, missing `fromChain`, or wrong bridge/tool filter.

**Solution:** Retry with backoff and pass `fromChain`, `toChain`, and bridge from the quote. Confirm the hash is the source-chain transaction hash.

### Error: Wrong amount due to decimals

**Cause:** The amount was not converted into the source token's smallest unit, or token decimals were assumed incorrectly across ecosystems.

**Solution:** Fetch token metadata from `/tokens` or `/token` and convert amounts before requesting a quote.

### Error: Different recipient unsupported

**Cause:** Some tools do not support sending to a recipient different from the sender.

**Solution:** Request another route/tool or use the same recipient when acceptable to the user.

## References

- Agent integration overview: https://docs.li.fi/agents/overview
- Agent concepts and object definitions: https://docs.li.fi/agents/concepts
- LLM-readable docs: https://docs.li.fi/llms.txt
- OpenAPI specification: https://docs.li.fi/openapi.yaml
- Quote API: https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer
- Routes API: https://docs.li.fi/api-reference/advanced/get-a-set-of-routes-for-a-request-that-describes-a-transfer-of-tokens
- Status API: https://docs.li.fi/api-reference/check-the-status-of-a-cross-chain-transfer
- Solana transaction execution: https://docs.li.fi/introduction/user-flows-and-examples/solana-tx-execution
- Error codes: https://docs.li.fi/api-reference/error-codes
- SDK installation: https://docs.li.fi/integrate-li.fi-js-sdk/install-li.fi-sdk
