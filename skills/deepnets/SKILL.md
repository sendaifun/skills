---
name: deepnets
description: Solana token intelligence for trading agents. Use Deepnets to screen tokens before swap, detect bundled-supply scams, audit holder concentration and funding-wallet networks (catches scam clusters), get AI-generated social research, and pull a curated safety-screened watchlist + trending feed. No API keys — pay-per-call via x402 USDC on Solana.
---

# Deepnets — Solana Token Intelligence

Use this skill when the user wants to research, screen, or audit a Solana SPL token, a Solana wallet, or a funding network — especially **before** executing a swap, providing liquidity, or recommending a token. Deepnets analyzes on-chain wallet relationships (funding-source graphs) to catch bundled supply, coordinated wallet clusters, exchange-attributed wallets, and bad-actor networks that simple contract scanners miss.

## When to use this skill

Trigger on user intents like:

- "Is this token safe?" / "Check this token before I buy"
- "Who holds this token?" / "Show me the holder concentration"
- "Was this a bundled launch?" / "Did one funder set up these wallets?"
- "Who funded this wallet?" / "What network is this wallet part of?"
- "Find new tokens that already passed a safety screen"
- "What's trending on Solana right now (filtered for safety)?"
- "Look up the AI social research on this token (Twitter, Telegram, website)"

Do **not** trigger this skill for:
- Non-Solana tokens (EVM, Sui, Aptos, etc.). Deepnets only covers Solana SPL tokens.
- Live-price trading execution (Deepnets is intelligence/screening, not a DEX router).

## Auth & payment

- **No API keys, no signup, no rate limits.** Pay per call in USDC on Solana via the x402 protocol.
- Fees are sponsored by the Coinbase facilitator — only USDC is needed (no SOL for gas).
- Public endpoints are served at `https://api.deepnets.ai`.
- Pricing is uniform: **$0.01 USDC per call** for everything *except* `/api/token-details` (also aliased as `/api/holder-analysis`), which is **$0.15 USDC** because it returns the full holder breakdown + per-network holder list.

### Recommended integration paths

1. **Already speak x402?** Call any endpoint directly with an x402-aware HTTP client. The 402 response includes the payment requirements; pay and retry.
2. **Claude Code / Cursor / Windsurf:** install the published MCP server. Tools auto-discover from the API's `/.well-known/x402`:
   ```bash
   claude mcp add deepnets npx @deepnets/mcp-server@latest
   ```
   Set `SOLANA_PRIVATE_KEY` in env (base58, Phantom-export format). The MCP server signs payments in-process and never exposes the key to the model.
3. **AgentCash:** the API is auto-discovered via the OpenAPI doc. From an AgentCash-enabled agent, just `agentcash fetch https://api.deepnets.ai/api/token-safety?mint=…` — payment is automatic from the AgentCash wallet.

## Endpoint decision table

| User intent | Endpoint | Price |
|---|---|---|
| "Is this token safe?" (verdict + warnings) | `GET /api/token-safety?mint=<MINT>` | $0.01 |
| Full holder breakdown (networks, per-network members, exchange attribution) | `GET /api/token-details?mint=<MINT>` | $0.15 |
| Token price, market cap, volume, holder count | `GET /api/token/stats?mint=<MINT>` | $0.01 |
| Funding-source graph for a token (wallet → wallet edges, exchange labels) | `GET /api/token/holder-graph?mint=<MINT>` | $0.01 |
| AI-generated social research (Twitter, Telegram, website, sentiment) | `GET /api/social-research?mint=<MINT>` | $0.01 |
| Streamflow vesting locks (locked supply + unlock schedule) | `GET /api/streamflow-locks?mint=<MINT>` | $0.01 |
| Tibane staking stats (staked supply + staker count) | `GET /api/tibane-staking?mint=<MINT>` | $0.01 |
| Recently flagged DANGEROUS or RISKY tokens | `GET /api/flagged-tokens` | $0.01 |
| Active watchlist (high-volume tokens that passed safety screen) | `GET /api/watchlist` | $0.01 |
| Trending Solana tokens (Birdeye-powered) with safety overlay | `GET /api/trending` | $0.01 |
| Historical safety analyses for a token | `GET /api/token-safety-history?mint=<MINT>` | $0.01 |
| Wallet profile (funder, network root, exchange, tags, tokens created) | `GET /api/wallet-details?address=<WALLET>` | $0.01 |
| Wallets directly funded by an address | `GET /api/wallet-details/children?address=<WALLET>` | $0.01 |
| Funding network overview (root wallet, total size, member sample) | `GET /api/network-details?networkAddress=<ROOT>` | $0.01 |
| Network member wallets (paginated) | `GET /api/network-details/wallets?networkAddress=<ROOT>` | $0.01 |

### Parameter conventions

- **Token endpoints** take `?mint=<base58>`. Solana mint addresses are 32–44 base58 chars; pump.fun tokens end in `pump`.
- **Wallet endpoints** take `?address=<base58>`.
- **Funding-network endpoints** take `?networkAddress=<base58>` — this is the network's root wallet address (`topFundingSource`), not just any wallet in the network.
- All responses are JSON.

## Workflow patterns

### Pattern: "Is this token safe to buy?"

1. Call `/api/token-safety?mint=<MINT>`.
2. Read `overallSafetyLevel`:
   - `OK` / `SAFE`: no major risks detected. Look at `topNetworkOwnership` (% of supply concentrated in one funding network) and `topHolderOwnership` (largest single holder). High `topNetworkOwnership` (>15%) on an OK token is unusual — recommend checking with `/api/token-details` before a large position.
   - `RISKY`: surface every entry in `warnings` to the user.
   - `DANGEROUS`: surface every entry in `criticalRisks` first, then `warnings`. Recommend NOT swapping without due diligence.
3. If `isMintable` is true, mention that the team can mint more supply.
4. If `ruggerHoldingsPct > 0`, mention that wallets tagged as ruggers in prior detected rugs hold N% of supply.

### Pattern: "Was this a bundled launch / coordinated rug setup?"

1. Call `/api/token-details?mint=<MINT>` (the $0.15 endpoint — only call when the user asks for a deep audit).
2. Look at `networks[]`. Each entry is one funding network (group of wallets traceable to the same root funder).
3. For the network with the highest `percentOwnership`:
   - If `percentOwnership > 50%` and `walletCount > 5`, this is a strong bundled-supply signal — flag it.
   - The `holders[]` list under that network is the actual member wallets to watch.
   - The `address` field is the network root; you can dig deeper with `/api/network-details?networkAddress=<address>`.
4. Cross-reference with `exchange` on the root — if `exchange` is null and `totalNetworkSize` is small (under a few hundred), that's a freshly-set-up bundle network.

### Pattern: "What's trending on Solana that's already safety-screened?"

1. Call `/api/watchlist` (curated, all tokens have passed a safety screen) or `/api/trending` (Birdeye top-by-volume, with safety overlay).
2. Watchlist is the safer surface for autonomous agents — every token has a recent `token_safety` analysis that came back OK.
3. Each entry includes the mint, current price, performance multiplier since watchlist add, and a brief safety summary.

### Pattern: "Is this wallet a bot / part of a known network?"

1. Call `/api/wallet-details?address=<WALLET>`.
2. `fundingSource` is the immediate funder; `topFundingSource` is the network root.
3. `exchange` is the upstream funding exchange (e.g. "Binance", "Mayan Finance"). Note: a wallet with `exchange: "Binance"` is *funded via* Binance — it isn't itself a Binance wallet unless its `address` matches a curated exchange address.
4. `isPuppet: true` flags wallets the system has identified as automation/coordinated activity.
5. `fundedWalletCount` is how many wallets this wallet has directly funded — a high number on a non-exchange wallet is suspicious.

## Guidelines

- **Cost discipline.** Default to `/api/token-safety` (`$0.01`) for screening; only escalate to `/api/token-details` (`$0.15`) when the user explicitly asks for a deep audit or the cheap check flags concentration risk.
- **Don't speculate.** Deepnets returns facts about wallet relationships and supply concentration. Phrase the output as evidence, not advice ("X% of supply sits in a 21-wallet network funded by Y" beats "this is a scam").
- **Verify before flagging exchange wallets.** The `exchange` field on a wallet describes its *funder*, not its identity. A wallet labeled `exchange: "Binance"` is downstream of Binance — it isn't the Binance hot wallet.
- **`topFundingSource` vs `fundingSource`.** `fundingSource` = immediate one-hop funder. `topFundingSource` = the root of the funding chain (where the chain hits a curated exchange or the first non-curated wallet below one). Use `topFundingSource` when asking "what network is this wallet in"; use `fundingSource` when asking "who literally sent the first SOL".

## Common errors

### `402 Payment Required` with no payment attempted
**Cause:** Calling without an x402-aware client.
**Solution:** Use the published MCP server (`@deepnets/mcp-server`), AgentCash, or any x402-fetch library. The 402 response body contains the payment requirements.

### `404 No safety analysis available for this token`
**Cause:** The token isn't in our analyzed set yet — Deepnets ingests via Birdeye top-200-by-volume polling, so very new or very illiquid tokens may not have a safety record.
**Solution:** Try `/api/token/stats` first to confirm the token exists; otherwise wait until it gets enough volume to be ingested.

### Wrong query parameter name (`?token=` instead of `?mint=`)
**Cause:** Common LLM guess.
**Solution:** Always use `?mint=` for token endpoints, `?address=` for wallets, `?networkAddress=` for funding networks. See parameter conventions above.

## References

- API docs: <https://deepnets.ai/api-docs>
- For-agents guide: <https://deepnets.ai/agents>
- OpenAPI 3.1: <https://api.deepnets.ai/openapi.json>
- x402 discovery: <https://api.deepnets.ai/.well-known/x402>
- MCP-Config: <https://api.deepnets.ai/.well-known/mcp.json>
- A2A AgentCard: <https://api.deepnets.ai/.well-known/agent-card.json>
- MCP server (npm): <https://www.npmjs.com/package/@deepnets/mcp-server>
