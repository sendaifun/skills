---
name: integrating-potbot
description: Comprehensive guidance for integrating PotBot — Solana group-trading vaults with on-chain governance and Personal AI Voters. Covers vault discovery, real on-chain proposal/vote/delegate transactions via @potbot/mcp, market & sentiment grounding, and production hardening. Use when an AI agent needs to participate in a group vault as a delegate, vote on proposals, or propose swaps grounded in fundamentals.
license: MIT
metadata:
  author: potbot
  version: "0.6.0"
tags:
  - potbot
  - group-vault
  - personal-ai-voters
  - on-chain-delegation
  - vault-governance
  - mcp
  - x402
  - jupiter-cpi
  - pyth-oracle
  - money-tree
  - share-weighted-voting
  - vault-analytics
  - market-analytics
  - social-sentiment
  - vader-sentiment
  - coingecko-grounding
  - defillama-grounding
  - delegate-pda
  - proposal-pda
  - votersrecord-pda
---

# PotBot Integration

Single skill for AI agents participating in **PotBot** — group-trading vaults on Solana where each member can delegate their vote to an AI. The skill covers the `@potbot/mcp` server (stdio + HTTP+SSE), the underlying program at `GJap9DjUoKZ9dhXMqGCPTeTzY6kPyBJ51SXL1pi8AmiK` (devnet), and the AI-agent flows that produce **real on-chain transactions** (not advice).

**Live program (devnet):** `GJap9DjUoKZ9dhXMqGCPTeTzY6kPyBJ51SXL1pi8AmiK`
**npm (stdio + HTTP+SSE):** `@potbot/mcp` (latest 0.6.0)
**For-agents docs:** [potbot.fun/for-agents](https://potbot.fun/for-agents)

## Use / Do Not Use

Use when:
- An AI agent is asked to **become a delegate** for a member of a group vault.
- An agent needs to **cast a vote** on a `ProposalAccount` on behalf of a member.
- An agent needs to **propose a swap** grounded in real market & sentiment data.
- A user wants the agent to **discover, analyze, or join** a public group vault.
- A client wants to **read** decoded `PotAccount` / `ProposalAccount` / `MemberDelegate` state.

Do not use when:
- The task is trading via a **single-manager** vault — use `drift-vaults` skill.
- The task is generic DAO governance with no vault — use Realms.
- The task is single-sig wallet management — use Squads.
- The task is solo on-chain trading — use `jupiter` skill directly.

**Triggers**: `group vault`, `pot`, `potbot`, `share-weighted vote`, `delegate vote`, `AI voter`, `personal ai voter`, `register delegate`, `revoke delegate`, `vote as delegate`, `swap proposal`, `create proposal`, `pot governance`, `trading club`, `investment club`, `money tree`, `pot health`, `vault leaderboard`, `member account`, `MemberDelegate`, `VoterRecord`, `PotAccount`, `ProposalAccount`, `vault analytics`, `social sentiment crypto`, `RSI realized volatility`, `defillama solana protocols`, `coingecko grounding`, `vader sentiment`, `lunarcrush twitter`, `cryptopanic news`.

## Developer Quickstart — connect via MCP

PotBot exposes 18 tools over MCP. Configure once:

```jsonc
// Claude Desktop / Cursor / any MCP client
{
  "mcpServers": {
    "potbot": {
      "command": "npx",
      "args": ["-y", "@potbot/mcp"],
      "env": {
        "SOLANA_NETWORK": "devnet",
        "PROGRAM_ID": "GJap9DjUoKZ9dhXMqGCPTeTzY6kPyBJ51SXL1pi8AmiK",
        // Optional — only set on a deployment that should auto-sign for one wallet:
        // "AGENT_KEYPAIR": "<base58 secret>",
        // Optional for richer sentiment:
        // "LUNARCRUSH_API_KEY": "...",
        // "CRYPTOPANIC_API_KEY": "..."
      }
    }
  }
}
```

For HTTP+SSE deployments (multiple AI clients sharing one server, or x402 micropayments enabled), use `npx @potbot/mcp-http` and connect via `https://<host>/sse`.

## Tool Map

### Reads — discovery & analysis (no signing required)
| Tool | Returns |
|---|---|
| `list_vaults()` | All `PotAccount` PDAs under the program — name, emoji, authority, member_count, trade_count, total_shares, governance, vault PDA balance |
| `get_leaderboard(sort_by)` | Same set, sorted by `tvl_lamports` / `member_count` / `trade_count` / `total_volume_lamports` |
| `get_vault_analytics(pubkey)` | Decoded `PotAccount` header, vault PDA balance, SPL holdings via `getTokenAccountsByOwner`, NAV priced via Jupiter Price API v2 |
| `get_proposals(pot)` | Decoded `ProposalAccount` list — Swap params, status, vote tally, snapshot, timestamps |
| `check_delegate(pot, member)` | On-chain `MemberDelegate` PDA — delegate pubkey, rules_uri, registered/revoked timestamps, active flag |
| `agent_status()` | Identity of AI delegate loaded by this MCP instance — pubkey, devnet SOL balance, source format |
| `get_agent_rules()` | The default AI strategist rule template |

### Reads — grounded data (call before any recommendation)
| Tool | Source | Returns |
|---|---|---|
| `get_market_analytics(token)` | CoinGecko + 30d daily chart | price, mcap, %-changes, ATH, FDV, circulating supply, **30d realized volatility**, **14d RSI**, **trend label** |
| `get_top_solana_protocols(limit)` | DefiLlama (CEX/Bridge/RWA filtered) | Solana-only TVL ranking, 1d/7d % TVL change, category |
| `get_protocol_stats(slug)` | DefiLlama | Per-chain breakdown |
| `get_yield_rates()` | DefiLlama yields, Solana, TVL > $100k | APY + risk class (low/medium/high) |
| `get_token_prices(mints)` | Jupiter Price API v2 | Live spot prices for SPL mints |
| `get_social_sentiment(token)` | LunarCrush (Twitter, key-gated) + Reddit (no key) + CryptoPanic (key-gated), all VADER-scored | overall verdict + numeric score [-1,1] + confidence + per-source breakdown |

### Writes — produce real on-chain transactions
| Tool | Effect | When `AGENT_KEYPAIR` set | When unset |
|---|---|---|---|
| `register_delegate(pot, member_wallet, delegate_pubkey, rules_uri)` | Init/update `MemberDelegate` PDA | signs+submits if `AGENT_KEYPAIR == member_wallet` | returns base64 unsigned tx for member's wallet |
| `revoke_delegate(pot, member_wallet)` | Sets `revoked_at`, preserves PDA for audit | signs+submits if member matches | returns unsigned tx |
| `vote_on_proposal(pot, proposal, member_wallet, approve, rationale?)` | **Submits real `vote_as_delegate` tx** when active delegation exists | always signs as delegate | returns dApp signing link |
| `create_swap_proposal(pot, from_mint, to_mint, amount_in, min_amount_out, description?)` | Auto-derives `next_proposal_id`, builds real `create_proposal` ix with `ProposalType::Swap` | signs+submits if proposer | unsigned tx |
| `join_strategy_vault(pot, amount_lamports, member_wallet)` | Builds real `deposit` ix (creates `MemberAccount` via `init_if_needed` on first deposit) | signs+submits if member | unsigned tx |

### Prompts — multi-tool playbooks
- `vault_strategist` — refuses to recommend without first calling `get_market_analytics` AND `get_social_sentiment`. Forces grounded analysis.
- `risk_auditor` — audits a pot's drawdown / concentration / governance posture.
- `yield_hunter` — finds yield opportunities matching the pot's `yield_strategy` profile.

### Resources
- `potbot://network/info` — program ID, RPC, version
- `potbot://vaults/list` — same as `list_vaults` but as MCP resource
- `potbot://yields/solana` — same as `get_yield_rates`

## Common flows

### Flow 1 — AI agent joins as a member's delegate

```text
1. User: "Be my delegate for pot CFke4rJqmx1HyWQxNuZWGitFGDSE5rmf7fhr3zJ1dWjC.
   My wallet is <member>. My rules are at ar://<arweave-tx>."
2. Agent → check_delegate(pot, member) — confirm no active delegate.
3. Agent → register_delegate(pot, member, agent_pubkey, rules_uri).
   - With AGENT_KEYPAIR == member: tx submitted, returns signature.
   - Without: returns unsigned tx; user signs in their wallet.
4. Agent → check_delegate again — confirm active=true, rules_uri matches.
```

### Flow 2 — Agent casts a delegated vote, grounded

```text
1. Agent → get_proposals(pot) — find Active ones.
2. For each proposal:
   a. get_vault_analytics(pot) — current NAV, holdings, governance.
   b. get_market_analytics(from_mint), get_market_analytics(to_mint).
   c. get_social_sentiment(to_mint) — overall verdict + confidence.
   d. Read agent's rules (from rules_uri) — apply criteria.
3. Agent → vote_on_proposal(pot, proposal, member, approve, rationale).
   Returns real tx signature when delegation is active.
```

### Flow 3 — Agent proposes a swap with rationale

```text
1. Agent → get_market_analytics(SOL), get_market_analytics(<target>).
2. Agent → get_social_sentiment(<target>).
3. Agent → get_top_solana_protocols(10) — sanity check liquidity / TVL.
4. Agent → get_yield_rates() — confirm idle capital isn't earning more elsewhere.
5. Agent → get_vault_analytics(pot) — confirm allowed_mints includes target.
6. Agent → create_swap_proposal(pot, from_mint, to_mint, amount_in, min_out, description)
   description should cite the numbers from steps 1-3.
```

### Flow 4 — Risk-aware monitoring (read-only)

```text
1. Periodically: get_leaderboard(sort_by="tvl_lamports").
2. For each watched pot: get_vault_analytics — check `paused`, `defensive_only`,
   high_water_mark vs current vault balance (drawdown).
3. If health drops below threshold, surface a `risk_auditor` prompt run.
```

## Error handling

| Symptom | Cause | Fix |
|---|---|---|
| `MemberDelegate not found` | No active delegation | Call `register_delegate` first |
| `Delegate revoked` | `revoked_at != 0` on the PDA | Member must `register_delegate` again to renew |
| `Proposal not Active` | Already passed/failed/executed | Read `get_proposals(pot)` for current status |
| `Insufficient shares` | Member has 0 voting weight | Call `join_strategy_vault(amount)` first |
| `KillSwitchActive` (Phase 1+) | Pot paused via `kill_switch_admin` | Wait for unpause; cannot vote/swap during pause |
| Vote tx returns base64 instead of signature | No delegation OR `AGENT_KEYPAIR` does not match registered delegate | Confirm delegate pubkey via `check_delegate` |
| `description_hash_invalid` (Phase 1+) | Off-chain proposal text doesn't match on-chain hash | Refuse to act; flag possible backend tampering |
| LunarCrush 401 in `get_social_sentiment` | Missing `LUNARCRUSH_API_KEY` | Tool degrades to Reddit-only — confidence drops to "low" |

## Production hardening

- **Always verify delegation before acting.** Call `check_delegate` immediately before any `vote_on_proposal` — covers race conditions where member revoked off-chain.
- **Refuse to propose without grounded data.** The `vault_strategist` prompt enforces this; bare-tool callers should follow the same rule manually.
- **Cite numbers in rationale.** Vote rationale (≤200 chars) should reference the specific RSI / sentiment / TVL value the agent used. Audit trail compounds.
- **Honor on-chain risk caps.** `single_swap_cap_bps`, `daily_budget_lamports`, `max_trade_size_bps` — agent must read `PotAccount` before proposing and self-cap below those.
- **Defensive-only mode.** When `pot.paused` or (Phase 1+) `pot.kill_switch_paused` — only vote `reject` on speculative swaps; only propose swaps that reduce risk (BTC/SOL → USDC).
- **Rate limits.** CoinGecko 10-30 req/min keyless; cache `get_market_analytics` results for ≥60s. DefiLlama generous but cache `get_top_solana_protocols` for ≥5 min.

## Security model

- **MemberDelegate PDA** is keyed by `[b"delegate", pot, member]` — one delegate per (pot, member). Re-register overwrites.
- **VoterRecord PDA** is keyed by `[b"voter", proposal, member.wallet]` (NOT delegate signer). This prevents double-voting whether the member or their AI casts the vote.
- **rules_uri** is public on-chain — the AI's behavior contract is auditable. Use immutable storage (`ar://`) so historical versions are forever provable.
- **Authority vs kill-switch (Phase 1+).** `pot.authority` can do anything. `pot.kill_switch_admin` can only pause. Agents should not be promoted to either.
- **AGENT_KEYPAIR** is a hot wallet — fund with the minimum needed for tx fees + small dust for `init_if_needed`. Never fund it with member assets.

## Related

- `jupiter` — used internally by `execute_swap` after a proposal passes (CPI from program).
- `pyth` — used by program inside StrategyTrigger swaps to verify oracle prices on-chain.
- `helius` — recommended RPC + priority fees for fast confirmation of vote/proposal txs.
- `metaplex` — Strategy Shares NFTs (post-Full Bloom).
- `squads` — recommended for `kill_switch_admin` on mainnet pots (Phase 1+).

## Verification — devnet E2E (finalized)

The skill is exercised against this reproducible flow:

1. Pot creation: `5oJpF5Ai…4GQ7hZk` ([Explorer](https://explorer.solana.com/tx/5oJpF5AiLAtQ4aM178Hq5JNdskuTHMUwPzMzTMcUmcHbR6eS7jMUAzcYD9f5ZHSDDL9nvBggMWEisbRwW4GQ7hZk?cluster=devnet))
2. Deposit (via `join_strategy_vault`): `4V8i9MD3…HLWn4` ([Explorer](https://explorer.solana.com/tx/4V8i9MD3qTyqhgpjaMQeBAkZBDRhZAzDvS5iVnPN2kP3h8chmDyroVtbu3xBga57ymkXVQ9kaUzzhuMKPFTHLWn4?cluster=devnet))
3. Swap proposal (via `create_swap_proposal`): `2xQNzisj…g5d3AXn` ([Explorer](https://explorer.solana.com/tx/2xQNzisjTAqWwUdrWdXky1bvF18S1DSWgrNwa1DGg1pRwWFoFi8GsmaRnd2GbhnAPPb9xngUT5s1SdbqZg5d3AXn?cluster=devnet))

Demo pot: `CFke4rJqmx1HyWQxNuZWGitFGDSE5rmf7fhr3zJ1dWjC`. All three were submitted entirely from MCP tooling.
