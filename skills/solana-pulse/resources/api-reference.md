# Solana Pulse API Reference

Base URL: `https://solana-pulse-gateway-1021990235790.us-central1.run.app`

- HTTP: `POST /api/tools/<name>` with a JSON body of inputs.
- MCP: Streamable HTTP at `/mcp`, `tools/call` with the tool name.
- Live docs for every input and output: `GET /api/tools/<name>`. Ready-to-run input: `GET /api/tools/<name>/example`.
- `network` is optional on every tool: `"mainnet-beta"` (default) or `"devnet"`.

Prices: 25 free calls per tool per day per caller, then $0.01 USDC per call ($0.02 for `check_tx`, `tx_matches`, `token_safety`) via x402 on Solana. Failed calls are never charged.

## check_tx

Dry-runs a transaction on mainnet and reports what it would do.

| Input | Type | Notes |
|-------|------|-------|
| `tx` | string (base64) | Signed or not; legacy, v0 or v1 |

| Output | Type | Meaning |
|--------|------|---------|
| `verdict` | `"OK"` \| `"REVIEW"` \| `"BLOCK"` | The worst check wins: any fail is BLOCK, any warn is REVIEW |
| `summary` | string | The verdict and the main reason in one sentence |
| `fee_payer`, `signers` | string, string[] | Who pays the fee and who signs |
| `checks[]` | `{ name, result, detail }` | `name`: simulation, blockhash, already_landed, fee_payer_balance, token_approval, authority_change, wallet_reassigned, close_to_other, unknown_programs, priority_fee, outflow. `result`: pass / info / warn / fail |
| `balance_changes[]` | `{ wallet, is_you, token, symbol, before, after, change, raw_change, decimals }` | Every wallet's SOL and token changes; negative `change` means the wallet loses it |
| `steps[]` | object[] | Every instruction, decoded |
| `fee` | object | Base, priority and total fee; compute unit limit and price |
| `simulation` | `{ worked, error, compute_used, logs, error_explained }` | The raw dry run, with failures explained |

## tx_matches

Confirms a transfer or swap does exactly what was asked.

| Input | Type | Notes |
|-------|------|-------|
| `tx` | string (base64) | The transaction to check |
| `expected.action` | `"transfer"` \| `"swap"` | Default `"transfer"` |
| `expected.token` | `"SOL"` or mint address | Transfers: the token to send |
| `expected.amount` | string (decimal) | Normal units: `"5"` = 5 USDC. Swaps: the amount sold |
| `expected.to` | wallet address | Transfers: the person's wallet, not their token account |
| `expected.from` | wallet address | Optional; default is the fee payer |
| `expected.sell`, `expected.buy` | `"SOL"` or mint address | Swaps only |

| Output | Type | Meaning |
|--------|------|---------|
| `verdict` | `"MATCH"` \| `"MISMATCH"` | MISMATCH: don't sign |
| `summary` | string | Names the first thing that's off |
| `compared[]` | `{ what, expected, actual, ok }` | token, amount, to, from, simulation |
| `transfers[]` | object[] | Every transfer in the transaction |
| `unexpected[]` | string[] | Anything not asked for: extra transfers, approvals, authority changes, closed accounts, other programs |
| `received`, `fees`, `extra_spent` | object | Swaps only: what reaches your wallet, cuts to other wallets, tips paid in the sold token |

## token_safety

| Input | Type | Notes |
|-------|------|-------|
| `token` | mint address | Resolve tickers with `find_token` first |

| Output | Type | Meaning |
|--------|------|---------|
| `verdict` | `"SAFE"` \| `"CAUTION"` \| `"AVOID"` | AVOID: a check failed. CAUTION: a warning. SAFE: no warnings |
| `summary` | string | The verdict explained |
| `about` | object | symbol, decimals, supply, token program, who can mint / freeze, Token-2022 extensions, price, liquidity, holders, top-10 share, creator and its launch count |
| `checks[]` | `{ name, result, detail, source }` | sell_test, liquidity_pull, creator_history, insiders, metadata, verified, mint_authority, freeze_authority, extension:<name>, ...; `source`: on-chain, jupiter, rugcheck, simulation |

## Other tools

| Tool | Use it to | Inputs |
|------|-----------|--------|
| `find_token` | Get the real mint behind a ticker (copycats reuse tickers) | `name` |
| `convert` | Turn "5 USDC" into raw units with the real decimals | `token`, `amount`, `to?` |
| `token_account` | Find the recipient's token account for a token | `wallet`, `token` |
| `explain_tx` | Explain a landed or failed transaction | `tx_id` |
| `why_failed` | Explain an error and the fix before retrying | `error`, `program?` |
| `fee` | Priority fee in micro-lamports per compute unit, and the total in SOL | `tx?` |
| `blockhash` | A fresh blockhash and how long it has left | none |
| `wallet`, `balance`, `tokens`, `history` | Read what a wallet holds and did | `wallet`, plus `how_many?` |
| `whats_this` | Identify an address before sending to it | `address` |
