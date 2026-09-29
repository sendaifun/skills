---
name: tokenline
description: Tokenline credit scores and pay-later AI compute for Solana agents. Use to vet any tokenized ClawPump/Clawrena agent by its on-chain creator fees (grade AAA to C, score 0 to 1000, counterparty verdict), list top rated agents and rating changes, and integrate a pay-later UsePod compute line with on-chain repayment and $ANSEM collateral via REST, MCP, Solana Agent Kit, ElizaOS or Solana Actions (Blinks).
---

# Tokenline Credit Skill

Tokenline is a credit layer for AI agents on Solana. It rates every tokenized agent from its public on-chain
creator fees, fronts UsePod inference to agents on credit, and gets repaid on-chain. Read endpoints are public and
keyless.

## Overview

Use this skill when the user wants to:
- Check whether another agent or agent token is trustworthy before trading with, paying or partnering with it
- See the best rated agents, or which agents were upgraded, downgraded or went quiet
- Give an agent pay-later compute (OpenAI or Anthropic compatible) repaid from its token's creator fees
- Repay a line or lock $ANSEM as collateral from an agent wallet, or wire this into an app with Blinks

Base URL: `https://tokenline.vercel.app`

## Instructions

1. **Vet a counterparty first.** Call `GET /api/score/<MINT>` and read `grade`, `score`, `stale` and `memo.text`.
   - AAA, AA or A and `stale: false`: normal counterparty.
   - BBB, BB or B: real but thin or irregular revenue. Size exposure down.
   - C, or `stale: true`: avoid. No meaningful or recent revenue.
   Always cite grade and score and link `https://tokenline.vercel.app/agent/<MINT>`.
2. **Leaderboard and changes.** `GET /api/board` returns every rated agent ranked; `GET /api/watch?hours=24`
   returns rating actions (`upgrade`, `downgrade`, `newly_approved`, `line_pulled`).
3. **Credit line (needs a key).** Users open a line at `/apply` by signing one message with the agent wallet and
   receive a `tl_` key. Load it from `TOKENLINE_KEY`, never hardcode it.
   - `GET /api/me` with `Authorization: Bearer $TOKENLINE_KEY` returns limit, available, outstanding and the repay address.
   - `POST /v1/chat/completions` (OpenAI format) or `POST /v1/messages` (Anthropic format) with the same header runs a
     UsePod call on credit. The response header `x-tokenline-charged-usd` is the amount added to the balance.
4. **Repay and collateral.** Repayments are SOL or USDC sent from the registered agent wallet to the pool address
   from `/api/me`. $ANSEM sent from the same wallet counts as collateral at 50% of value. To have Tokenline build
   the transaction, POST `{ "account": "<wallet>" }` to `/api/actions/repay?amount=<SOL>` or
   `/api/actions/collateral?amount=<ANSEM>`; the response `transaction` is an unsigned base64 transaction to sign.
5. **Pick the integration** that fits the stack: REST (above), remote MCP at `https://tokenline.vercel.app/mcp`,
   the Solana Agent Kit or ElizaOS plugin (see `examples/`), or Solana Actions via `/actions.json`.

## Examples

### Basic Usage

When user asks: "Is agent 7TKRV4SneC6xLRaAt21a6d1kheAzXHGKP9WDzri9aD2e safe to pay?"

The agent should:
1. `curl -s https://tokenline.vercel.app/api/score/7TKRV4SneC6xLRaAt21a6d1kheAzXHGKP9WDzri9aD2e`
2. Report the grade, score and memo, apply the verdict rules above
3. Link the full report

### Top agents

When user asks: "Who are the best rated agents right now?"

The agent should call `/api/board` and list the first entries as `rank. project ($symbol) grade score`.

### Think on credit

```bash
curl -s https://tokenline.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer $TOKENLINE_KEY" -H "content-type: application/json" \
  -d '{"model":"deepseek-v4-1-flash","max_tokens":400,"messages":[{"role":"user","content":"gm"}]}'
```

See `examples/solana-agent-kit.ts` and `examples/elizaos.ts` for framework plugins, and
`resources/api-reference.md` for every endpoint.

## Guidelines

- **DO** vet counterparties with `/api/score` before paying or trading with another agent.
- **DO** load `TOKENLINE_KEY` from the environment and keep it out of logs and messages.
- **DO** say a lookup failed if an endpoint errors.
- **DON'T** invent a grade or present scores as financial advice.
- **DON'T** send funds to any address other than the pool address returned by `/api/me`.
- **DON'T** repay or lock collateral from a wallet other than the one registered with Tokenline; it will not be credited.

## Common Errors

### Error: `mint is not a tokenized Clawrena entry` (404)
**Cause**: The mint is not in ClawPump's Clawrena fee feed, so it has no fee history to rate.
**Solution**: Tell the user the agent is unrated; do not substitute a score.

### Error: `line_exhausted` (402 from `/v1/*`)
**Cause**: No credit available (limit reached, overdue or frozen).
**Solution**: Repay via the pool address or lock $ANSEM collateral, then retry.

### Error: `This wallet has no Tokenline line` (400 from `/api/actions/*`)
**Cause**: The signing wallet is not registered with Tokenline.
**Solution**: Open a line at `https://tokenline.vercel.app/apply` with that wallet first.

## References

- [Tokenline app](https://tokenline.vercel.app)
- [Docs](https://tokenline.vercel.app/docs)
- [Source and plugins](https://github.com/angelraph/tokenline)
- [Public ledger](https://tokenline.vercel.app/ledger)
