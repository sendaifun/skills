---
name: solana-pulse
description: Check a Solana transaction before an AI agent signs it, with Solana Pulse. Use before signing any transaction an agent built or received (transfers, Jupiter swaps, x402 payments, unknown transactions) to dry-run it on mainnet and get OK / REVIEW / BLOCK with every wallet's balance changes, to confirm it matches what the user asked (token, amount, recipient), and to vet a token (SAFE / CAUTION / AVOID). Works over MCP, plain HTTP or the Solana Agent Kit plugin; free daily calls with no API key, then x402 in USDC.
metadata:
  author: Solana Pulse
  version: "0.1.0"
  mcp-server: solana-pulse
---

# Pre-sign Safety Checks with Solana Pulse

Solana Pulse checks what a Solana transaction will really do before an agent signs it. Use this skill whenever an agent is about to sign: it turns "the model built a transaction and believes it is right" into a dry run on live mainnet state with a verdict and the exact balance changes.

## Overview

Agents lose money in ways a person would catch at a glance: an extra instruction that approves a stranger to spend the wallet's tokens, a swap that pays the bought token to someone else, wrong decimals (1,000x the amount), a copycat token with the right ticker, an expired blockhash that burns fees on retries. Pulse catches these by reading the transaction itself, not just the token.

Three checks do most of the work:

| Check | Answers | Use it |
|-------|---------|--------|
| `check_tx` | `OK` / `REVIEW` / `BLOCK` + every wallet's SOL and token changes | Before signing every transaction |
| `tx_matches` | `MATCH` / `MISMATCH` against what the user asked | Before signing a transfer or swap built from a request ("send 5 USDC to X", "swap 1 USDC for JUP") |
| `token_safety` | `SAFE` / `CAUTION` / `AVOID` with reasons and sources | Before buying, accepting or recommending a token |

Pulse never signs or sends anything. It only reads and simulates, so it cannot be the thing that loses funds. Every fact names its source (on-chain, simulation, Jupiter, RugCheck), and missing data is reported as unknown instead of guessed.

`SAFE` and `OK` mean none of the traps Pulse knows about were found. They are not a promise that a token or transaction is safe.

## Access

Prefer these in this order:

### 1. MCP (Claude Code, Cursor, any MCP client)

```bash
claude mcp add --transport http solana-pulse https://solana-pulse-gateway-1021990235790.us-central1.run.app/mcp
```

Streamable HTTP, no auth. Official MCP Registry id: `io.github.Timothymycompc/solana-pulse-gateway`.

### 2. Solana Agent Kit v2 plugin

```bash
npm install solana-agent-kit-plugin-pulse
```

```ts
import { SolanaAgentKit } from "solana-agent-kit";
import PulsePlugin from "solana-agent-kit-plugin-pulse";

const agent = new SolanaAgentKit(wallet, RPC_URL, {}).use(PulsePlugin);
const check = await agent.methods.pulseCheckTx(agent, { tx }); // tx: base64, Transaction or VersionedTransaction
if (check.verdict === "BLOCK") throw new Error(check.summary);
```

Load only the checks with `createPulsePlugin({ tools: ["check_tx", "tx_matches", "token_safety"] })`.

### 3. Plain HTTP

```bash
curl -s https://solana-pulse-gateway-1021990235790.us-central1.run.app/api/tools/check_tx \
  -H 'content-type: application/json' \
  -d '{"tx":"<base64 transaction>"}'
```

### Cost

Every tool gives each caller 25 free calls a day (reset 00:00 UTC), with no account or key. After that a call costs $0.01 USDC, or $0.02 for `check_tx`, `tx_matches` and `token_safety`, paid per request with x402 on Solana. Over HTTP an unpaid call returns `402` with a `PAYMENT-REQUIRED` header; over MCP it returns a PaymentRequired tool result. Calls that return an error are never charged.

## Instructions

When an agent is about to sign a Solana transaction:

1. **Build the transaction without signing it** and encode it as base64:
   `Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64")` (legacy) or `Buffer.from(vtx.serialize()).toString("base64")` (versioned).
2. **If it came from a user request, run `tx_matches`** with what the user asked for. For a transfer: `{ token, amount, to }` (`amount` in normal units, `"5"` = 5 USDC; `to` is the person's wallet, not their token account). For a swap: `{ action: "swap", sell, amount, buy }`. On `MISMATCH`, stop and show the user `summary` and `compared[]`.
3. **Run `check_tx`** on the same transaction.
   - `BLOCK`: do not sign. Show `summary` and the failing `checks[]`.
   - `REVIEW`: do not sign on your own. Show the warnings and `balance_changes[]` and ask the user.
   - `OK`: sign and send.
4. **Before buying or accepting a token, run `token_safety`.** Treat `AVOID` as "don't", `CAUTION` as "ask the user", and read `checks[]` for the reason. Resolve tickers with `find_token` first; never take a mint address from memory.
5. **If a transaction or dry run fails, run `why_failed`** with the error before retrying. After a transaction lands or fails, `explain_tx` reports what happened.

## Examples

### Transfer from a request

When user asks: "Send 5 USDC to 7xKX...gAsU"

The agent should:
1. Call `find_token` with `USDC` to get the real mint, and `convert` if it needs raw units.
2. Build the transfer, then call `tx_matches` with `{ tx, expected: { token: "<USDC mint>", amount: "5", to: "7xKX...gAsU" } }`.
3. Call `check_tx` with `{ tx }`.
4. Sign only if `tx_matches` says `MATCH` and `check_tx` says `OK`. Otherwise report `summary` and stop.

### Swap built by an aggregator

When user asks: "Swap 1 USDC for JUP"

The agent should:
1. Get the swap transaction from the aggregator.
2. Call `tx_matches` with `{ tx, expected: { action: "swap", sell: "<USDC mint>", amount: "1", buy: "<JUP mint>" } }`. This catches a swap that pays the JUP to another wallet.
3. Call `check_tx`, then sign only on `MATCH` + `OK`.

### Pre-sign gate in code

See `examples/sign-gate/gate.ts`: a dependency-free function that runs `tx_matches` (when there is a request) and `check_tx`, and returns sign / ask / stop.

## Guidelines

- **DO** run `check_tx` on every transaction before signing, including ones handed to the agent by another service.
- **DO** pass the exact transaction that will be signed. Rebuilding after the check (new blockhash, new route) means checking again.
- **DO** show the user `summary` and `balance_changes[]` when the verdict is `REVIEW` or `BLOCK`.
- **DO** treat `unknown` fields as unknown, not as safe.
- **DON'T** sign on `BLOCK` or `MISMATCH`, and don't sign on `REVIEW` without the user's say-so.
- **DON'T** present `SAFE` or `OK` as a guarantee or as investment advice.
- **DON'T** retry a failed transaction blind; call `why_failed` first.
- **DON'T** put a private key anywhere in a Pulse request. Pulse never needs one.

## Common Errors

### HTTP 402 / PaymentRequired
**Cause**: The caller used its 25 free calls for that tool today.
**Solution**: Pay per call with x402 (USDC on Solana), or wait for the 00:00 UTC reset. The Agent Kit plugin returns `{ status: "error", payment_required: true }` instead of throwing.

### `blockhash` check warns, or the dry run says BlockhashNotFound
**Cause**: The transaction's blockhash expired (about 60-90 seconds).
**Solution**: Rebuild with a fresh blockhash (`blockhash` tool shows how long one has left), then check again.

### `already_landed` fails
**Cause**: This exact signed transaction is already on chain, for example an x402 payment being retried.
**Solution**: Don't send it again; it would pay twice.

### `tx` rejected as invalid
**Cause**: Not base64, or serialized with signature checks on.
**Solution**: Serialize with `requireAllSignatures: false` and base64-encode the bytes.

## References

- [API reference](resources/api-reference.md): every check's inputs and output fields
- [Live tool docs](https://solana-pulse-gateway-1021990235790.us-central1.run.app/api/tools): `GET /api/tools/<name>` explains every input and output; `GET /api/tools/<name>/example` gives a ready-to-run input
- [Source (MIT)](https://github.com/Timothymycompc/solana-pulse-ai-agent-gateway)
- [Benchmark](https://github.com/Timothymycompc/solana-pulse-ai-agent-gateway/tree/main/benchmark): 10 attack and mistake cases built from real mainnet accounts, and a 200-transaction false-alarm test
- [Agent Kit plugin](https://www.npmjs.com/package/solana-agent-kit-plugin-pulse)
- [x402](https://github.com/x402-foundation/x402)
