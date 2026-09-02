---
name: tnt-risk-api
description: Solana token risk scoring for AI trading agents — insider wallet cluster detection, mint/freeze authority checks, honeypot risk, and LP-lock status via a single API call before a trade. Use when an agent needs to evaluate whether a Solana token is safe to buy, or is deciding whether to execute a swap on a token it hasn't seen before.
---

# RiskDataApi

Pre-trade risk assessment for Solana tokens, built for AI trading agents that need to decide whether a token is safe to buy before they buy it.

## Overview

Most Solana trading agents check price, liquidity, and volume before a trade — but not whether the token itself is structured to rug. This skill gives an agent a single-call risk check that covers:

- **Insider wallet cluster detection** — finds groups of "different" holders that trace back to the same funding wallet, a common way to fake organic distribution before a coordinated dump
- **Mint/freeze authority status** — whether the dev retained the ability to mint more supply or freeze holder wallets
- **Honeypot risk** — whether the token can actually be sold
- **LP-lock status** — whether liquidity is locked or can be pulled
- **Holder concentration and live market data** — price, liquidity, volume for the mint

The API is designed to sit in front of a trade decision, not replace one: it returns a safety score (0-100) and structured findings the agent can gate on.

## Instructions

1. When a user or agent flow is about to buy, snipe, or otherwise commit funds to a Solana token, call `check_token_risk` with the token mint address before constructing the trade transaction.
2. If checking multiple candidate tokens (e.g. filtering a discovery feed), use `check_token_risk_batch` (up to 25 mints per call) instead of looping single calls.
3. Read the `safety_score` and `insider_clusters` fields first — a low score or a detected cluster is a stronger signal than price momentum alone.
4. If historical context matters (e.g. "has this token's risk profile changed recently"), use `get_token_risk_history` for up to 90 days of hourly data.
5. Treat the check as a gate, not a guarantee: pass the result into the agent's own risk policy (e.g. skip trade below a score threshold) rather than hard-coding a single cutoff.

## Examples

- "Before you buy this token, check if it's safe" → call `check_token_risk` with the mint, surface `safety_score` and any `insider_clusters` found, then proceed or abort based on the agent's risk policy.
- "Filter this list of 15 tokens down to the ones without insider clustering" → call `check_token_risk_batch` with all 15 mints in one call, filter on `insider_clusters.length === 0`.
- "Has $MINT gotten riskier in the last week?" → call `get_token_risk_history` and compare the safety score trend.

## Guidelines

- **DO** call the risk check before the trade instruction is built, not after — the point is to gate the trade, not audit it retroactively.
- **DO** treat a detected insider cluster as a stronger red flag than a low liquidity number alone; clustering indicates coordinated intent, not just a thin market.
- **DON'T** rely on mint authority status alone — a renounced mint authority does not rule out insider wallet clustering; check both.
- **DON'T** treat the safety score as financial advice or a guarantee; it's a structured input to the agent's own decision, not a final verdict.

## Access

- No signup: `check_token_risk` can be called directly (3 calls/day per IP, no key).
- Free API key at [tnt-audit.com/risk-api](https://tnt-audit.com/risk-api) raises the limit to 15 calls/day.
- Higher volume: pay-per-call ($0.04), subscription ($45/1000 calls), or x402 for autonomous agents (no key needed, $0.02/call).
- MCP endpoint: `https://tnt-audit.com/api/mcp` (Streamable HTTP, `Authorization: Bearer <api_key>`).

## Notes

- Built for Solana specifically; mint addresses only.
- Insider cluster detection can take longer than a simple price lookup (cluster analysis walks funder history) — plan for this as a pre-filter on a token shortlist rather than a per-millisecond gate on execution.

## References

- [Risk-Data API docs](https://tnt-audit.com/risk-api)
- [MCP server source](https://github.com/menantonio83-hue/tnt-house/blob/main/app/api/mcp/README.md)
