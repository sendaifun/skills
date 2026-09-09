---
name: solenrich
description: SolEnrich onchain intelligence API for Solana agents, pay-per-call over x402 (USDC on Solana or Base) with no API key. Use for wallet risk scoring, token due diligence and rug flags, smart-money and whale tracking, memecoin trenches entry and exit verdicts (runner-scan, trenches-check, exit-signal), cross-venue perps funding and venue comparison (Jupiter, Adrena, Flash, Hyperliquid, dYdX), StonkFun reward-coin gems and payout status, and plain-English questions routed to the right enricher. Returns JSON or an LLM-ready briefing.
---

# SolEnrich — Solana Onchain Intelligence for Agents

SolEnrich turns raw Solana data into verdicts an agent can act on: SAFE / CAUTION / RISKY for a token,
EXIT / DERISK / HOLD for a position you hold, GEM / WATCH / NOISE for a StonkFun coin, best venue for a
perp at your size. 44 paid endpoints plus one free, $0.001 to $0.25 per call, settled over x402. No
account, no API key: the agent pays USDC per request from its own wallet.

Base URL: `https://api.solenrich.com`

## Overview

Use this skill when the user asks about:

- Is this token safe, is it a rug, who holds it, how much slippage at size
- Is this wallet risky, is it a bot, what does it hold, how has it performed
- Where is smart money moving, which proven-winner wallets are buying fresh launches
- Should I enter, should I exit, is this memecoin still running (the trenches lifecycle)
- Which perps venue has the best funding or the lowest entry cost for SOL / BTC / ETH
- Which StonkFun reward coins are paying holders, which look like gems, what to launch against
- Any plain-English Solana question the agent cannot answer from one source

All scoring is deterministic. There is no LLM in SolEnrich's pipeline; the `llm` format is a template,
so a briefing costs the same as JSON and never hallucinates.

## Instructions

1. **Discover for free.** `GET /docs` (every endpoint with input schema and scoring methodology),
   `GET /openapi.json`, `GET /llms.txt`, `GET /.well-known/x402`. Read `resources/endpoints.md` in
   this skill for the decision table with prices.
2. **Choose the payment path.**
   - Agent has a Solana wallet with USDC → x402 from code. Read `resources/x402.md`, then use
     `examples/x402/pay-per-request.ts`. Base USDC works the same way with the EVM scheme.
   - Agent has a terminal → `pay curl` from the Solana Foundation `pay` CLI handles the 402 challenge
     and returns the body. Install: `npm i -g @solana/pay`.
   - No wallet at all → `POST /demo/enrich` is free (10 calls per hour, one token or wallet) and
     `stonk-pairs` is free. The MCP endpoint `https://api.solenrich.com/mcp` lists tools but returns
     payment instructions instead of data.
3. **Call the endpoint.** Every paid route is `POST /entrypoints/{key}/invoke` with a JSON body. A flat
   body works (`{ "mint": "...", "format": "llm" }`) and so does an `input` envelope
   (`{ "input": { ... } }`). `format` is `json` (default), `llm` (briefing), or `both`.
4. **Pick the endpoint by intent.**

| User intent | Endpoint | Price |
|---|---|---|
| Is this token safe / rug check with a verdict | `due-diligence` | $0.02 |
| Quick token price, liquidity, slippage, risk flags | `enrich-token-light` | $0.002 |
| Token holders, concentration (HHI), volatility | `enrich-token-full` | $0.004 |
| Is this wallet risky, is it a bot, what does it hold | `enrich-wallet-light` | $0.002 |
| Wallet DeFi positions, connected wallets, tx history | `enrich-wallet-full` | $0.005 |
| Does this wallet trade well (PnL, win rate, Sharpe) | `copy-trade-signals` | $0.01 |
| Who are the whales and are they buying or selling | `whale-watch` | $0.008 |
| What are proven winners buying on spot | `smart-money-flow` | $0.10 |
| Which winners are aping fresh (<6h) launches right now | `smart-money-trenches` | $0.05 |
| Which fresh tokens are accelerating right now | `runner-scan` | $0.04 |
| Should I enter THIS token (velocity + smart money + attention) | `trenches-check` | $0.03 |
| Should I exit the token I hold | `exit-signal` | $0.04 |
| Best venue for a SOL / BTC / ETH perp at my size | `perps-venue-comparison` | $0.02 |
| Funding and OI across Jupiter, Adrena, Flash, Hyperliquid, dYdX | `perps-cross-venue-funding` | $0.015 |
| Where is Hyperliquid smart money positioned | `hyperliquid-smart-money` | $0.05 |
| Which StonkFun coins look early, real, and paying | `stonk-gems` | $0.03 |
| Is this StonkFun coin paying holders, what does the tax cost | `stonk-reward-risk` | $0.005 |
| What to launch on StonkFun and against which quote | `stonk-launch-intel` | $0.02 |
| A plain-English question, unsure which endpoint | `query` | $0.003 |

   Full table with inputs and the remaining 25 endpoints: `resources/endpoints.md`.

5. **Chain the trade lifecycle in this order.** Find → vet → size → hold → exit:
   `runner-scan` or `smart-money-trenches` → `trenches-check` on one mint → `due-diligence` →
   `enrich-token-light` for slippage at size → `exit-signal` while holding. Every response carries a
   `next_steps` array naming the next call. See `examples/trade-lifecycle.md`.
6. **Read the transfer tax.** Token-2022 mints (all StonkFun reward coins) carry a `transfer_tax` block
   on token, runner, trenches-check, and exit-signal responses. `round_trip_pct` is the buy plus sell
   cost before slippage; `exit-signal.position.net_pnl_after_exit_tax_pct` is the number to act on.
7. **Present verdicts first, evidence second.** Lead with the verdict word and score, then the two or
   three reasons the response gives, then the caveats. Never drop the `caveats` array; it says which
   legs failed or what the data cannot see.

## Examples

### Token safety with a verdict

User: "Is BONK safe to hold?"

```typescript
import { createPaidFetch } from './examples/x402/pay-per-request';
const fetch402 = await createPaidFetch();
const res = await fetch402('https://api.solenrich.com/entrypoints/due-diligence/invoke', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', format: 'both' }),
});
const { verdict, risk_score, risk_factors, llm_summary } = await res.json();
```

Reply with the verdict, the score, the top risk factors, and the slippage line from the summary.

### Same call from a terminal

```bash
pay curl -X POST https://api.solenrich.com/entrypoints/due-diligence/invoke \
  -H 'content-type: application/json' \
  -d '{"mint":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","format":"llm"}'
```

### Should I exit

User: "I bought ZCAT at 0.10, should I sell?"

Call `exit-signal` with `{ "mint": "<ZCAT mint>", "entry_price_usd": 0.10 }`. Report `verdict`,
`exit_score`, `position.unrealized_pnl_pct`, and `position.net_pnl_after_exit_tax_pct` (ZCAT carries a
300 bps tax, so the net figure is lower). Quote the `reasoning` string.

### Find StonkFun gems

User: "What's worth looking at on StonkFun right now?"

Call `stonk-gems` with `{ "limit": 10, "format": "llm" }`. Show the GEM rows with their reasons and
warnings, and say that the list refreshes every ten minutes. Follow with `trenches-check` on any GEM the
user wants to size.

### Plain-English fallback

User: "Should I buy JUP?"

Call `query` with `{ "question": "Should I buy JUP?" }`. It chains due-diligence, token-trend, and
whale-watch and returns one answer. Use `query` when the intent is compound or unclear; use the specific
endpoint when it is clear, because it is cheaper and returns typed fields.

## Guidelines

- **DO** start with `-light` endpoints ($0.002) and escalate to `-full` or `due-diligence` only when the
  light result flags something.
- **DO** pass `format: "llm"` when the result feeds a context window; it is shorter and reads better.
- **DO** respect cache windows: results are cached server-side 30 seconds to 10 minutes by data type.
  Re-polling faster spends money for the same answer. Trenches endpoints unlock liquidity and holder
  deltas on a second call 5 or more minutes later, not sooner.
- **DO** use `batch-enrich` for three or more addresses; it amortizes overhead.
- **DON'T** call `whale-watch` or `enrich-token-full` before `due-diligence`; it already bundles them.
- **DON'T** treat any verdict as financial advice or auto-execute a trade on it. Confirm with the user
  before any swap.
- **DON'T** send the private key anywhere except the local x402 signer. SolEnrich never sees it.
- Prices are per call in USDC. Read the `pricing` block of any 402 response for the live number.

## Common Errors

### HTTP 402 with a JSON body
**Cause**: No payment header, or the payment was rejected. The body carries `pricing`, `how_to_pay`,
and `all_endpoints` (every paid key with its price).
**Solution**: Use the x402 fetch wrapper or `pay curl`. Confirm the wallet holds USDC and a little SOL
for fees on Solana, or USDC on Base.

### HTTP 404 on `/entrypoints/<key>/invoke`
**Cause**: Unknown endpoint key. Keys are lowercase with hyphens, for example `enrich-wallet-light`.
**Solution**: `GET /entrypoints` lists every key.

### HTTP 400 validation error
**Cause**: Wrong field name or an address that is not base58 (Solana) or 0x (Hyperliquid endpoints).
**Solution**: Field names are snake_case (`entry_price_usd`, `max_age_days`). Check the schema in
`GET /docs` or `GET /openapi.json`.

### `index is warming up` caveat on stonk endpoints
**Cause**: The server just restarted; the 10-minute StonkFun index rebuilds within a minute.
**Solution**: Retry after 60 seconds.

### `holders_source: unavailable` or a leg marked FAILED in `caveats`
**Cause**: An upstream source (RPC, DexScreener, Birdeye) timed out. Verdicts degrade instead of failing.
**Solution**: Report the caveat with the verdict. Retry later if the missing leg matters.

## References

- Docs (agent-readable JSON): https://api.solenrich.com/docs
- OpenAPI: https://api.solenrich.com/openapi.json
- LLM summary of every endpoint: https://api.solenrich.com/llms.txt
- x402 discovery: https://api.solenrich.com/.well-known/x402
- MCP (tool listing): https://api.solenrich.com/mcp
- Landing and pricing: https://solenrich.com
- x402 protocol: https://www.x402.org/
- Solana Foundation `pay` CLI: https://github.com/solana-foundation/pay
