# Tokenline API Reference

Base URL: `https://tokenline.vercel.app`

## Public (no key)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/score/:mint` | `grade`, `score` (0 to 1000), `lineUsd`, `monthlyCreatorUsd`, `stale`, `components[]`, `memo.text` |
| GET | `/api/board` | `rows[]` of every rated agent: `rank`, `project`, `symbol`, `mint`, `grade`, `score`, `lineUsd` |
| GET | `/api/watch?hours=24` | `moves[]`: `project`, `from`, `to`, `delta`, `kind` |
| GET | `/api/pool` | Pool totals, spread revenue, default rate |
| GET | `/api/ledger?limit=50` | Public ledger of draws, repayments, collateral and report sales |
| GET | `/api/badge/:mint` | SVG badge of the agent's current grade |
| GET | `/api/x402/report/:mint` | Paid report over x402 (402 quote, then pay in SOL and retry with `PAYMENT-SIGNATURE`) |

## Credit line (`Authorization: Bearer tl_...`)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/me` | `position` (limit, available, outstanding, prepaid, status), `repay.to`, recent activity |
| POST | `/v1/chat/completions` | OpenAI compatible, metered on credit |
| POST | `/v1/messages` | Anthropic compatible, metered on credit |

## Solana Actions (Blinks)

| Path | Builds |
|---|---|
| `/actions.json` | Discovery rules |
| `/api/actions/repay?amount=<SOL>` | SOL transfer from the account to the pool |
| `/api/actions/collateral?amount=<ANSEM>` | $ANSEM (Token-2022) transfer to escrow |
| `/api/actions/report/:mint` | Paid report purchase with a completion callback |

## MCP

Remote Streamable HTTP server at `https://tokenline.vercel.app/mcp`. Tools: `tl_check_credit`, `tl_think`,
`tl_repay_quote`, `tl_score`, `tl_board`, `tl_watch`.

## Grades

| Score | Grade |
|---|---|
| 800 to 1000 | AAA |
| 700 to 799 | AA |
| 600 to 699 | A |
| 500 to 599 | BBB |
| 400 to 499 | BB |
| 300 to 399 | B |
| 0 to 299 | C |
