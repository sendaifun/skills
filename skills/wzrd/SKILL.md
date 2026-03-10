---
name: wzrd
description: WZRD Attention Oracle — real-time AI model velocity data, attention leaderboards, yield simulation, and merkle proof verification on Solana via MCP
---

# WZRD Attention Oracle

Real-time AI model attention tracking on Solana. 16 MCP tools for velocity EMA scores, ranked leaderboards, market data, yield flywheel state, Jupiter routing, and verifiable merkle claims.

## Overview

WZRD tracks where developer attention is moving across HuggingFace and GitHub. The protocol computes EMA velocity scores for open-source AI models, publishes merkle roots on-chain, and exposes the full data surface through a permissionless MCP endpoint.

- **16 tools** covering market data, protocol health, DeFi composability, and claim verification
- **On-chain anchored** — every score is backed by a cryptographic merkle root on Solana mainnet
- **Zero config** — HTTP endpoint, no API key required for read-only tools

| Item | Value |
|------|-------|
| MCP Endpoint | `https://app.twzrd.xyz/api/mcp` |
| Protocol | JSON-RPC 2.0 over HTTP POST |
| Program ID | `GnGzNdsQMxMpJfMeqnkGPsvHm8kwaDidiKjNU2dCVZop` |
| CCM Mint | `Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM` (Token-2022) |
| GitHub | [twzrd-sol/wzrd-mcp](https://github.com/twzrd-sol/wzrd-mcp) |

## Quick Start

Add to your MCP config (Claude Desktop, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "wzrd": {
      "url": "https://app.twzrd.xyz/api/mcp"
    }
  }
}
```

Test with a raw JSON-RPC call:

```bash
curl -X POST https://app.twzrd.xyz/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_leaderboard","arguments":{"limit":5}}}'
```

## Tools

### Market Data (4 tools)

**get_leaderboard** — Ranked AI model markets sorted by velocity EMA.

```json
{"name": "get_leaderboard", "arguments": {"limit": 10, "platform": "huggingface"}}
```

Returns: market_id, channel_id, velocity_ema, tvl_usdc, multiplier_bps, root_seq. Filter by platform: `huggingface`, `github`, `artificial_analysis`, or `all`.

**get_market** — Full market data for a specific model by ID.

```json
{"name": "get_market", "arguments": {"market_id": 3}}
```

Returns: velocity EMAs, TVL, on-chain position count, status, platform metadata.

**get_feeds** — All active velocity oracle feeds across platforms.

```json
{"name": "get_feeds", "arguments": {}}
```

Returns: channel_id, entity_hash, velocity_ema, platform, last_updated for every tracked model.

**get_feed** — Single feed by SHA-256 entity hash.

```json
{"name": "get_feed", "arguments": {"entity_hash": "a1b2c3..."}}
```

### Protocol Health (3 tools)

**get_health** — Protocol health: DB status, circuit breakers, keeper fleet, deposit/market-creation flags, and background job status.

**get_keeper_status** — Status of all background keeper jobs (compound, route_yield, fee_harvest, scoring, publisher, etc.). Filter by job_name.

```json
{"name": "get_keeper_status", "arguments": {"job_name": "compound"}}
```

**get_circuit_breaker_state** — State of all circuit breakers (scoring, publisher, relay). States: CLOSED (healthy), OPEN (tripped), HALF_OPEN (recovering).

### DeFi Composability (5 tools)

**get_yield_flywheel** — Full yield flywheel state: exchange rate, total_staked, buffer_balance, treasury_ccm_balance, compound_count, daily_change_bps.

**get_exchange_rate_history** — CCM/vLOFI exchange rate history (up to 168 hourly points = 7 days).

**get_dlmm_pools** — Status of all Meteora DLMM liquidity pools: active_bin, is_in_range, position_count, stranded_since.

**simulate_compound_cycle** — Dry-run compound keeper checks. Returns would_execute, buffer_ccm, threshold_ccm, and blockers.

**simulate_route_yield** — Dry-run route_yield keeper checks. Returns would_execute, treasury_ccm, available_ccm, sweep_ccm, and blockers.

### Claims & Verification (2 tools)

**verify_merkle_proof** — Verify a WZRD V4 merkle proof against the stored on-chain root.

```json
{"name": "verify_merkle_proof", "arguments": {"wallet": "2pHj...", "root_seq": 1534, "cumulative_total": 1000000000, "proof": ["ab12...", "cd34..."]}}
```

**simulate_claim** — Pre-flight check for a gasless CCM claim relay. Returns claimable, unclaimed_ccm_base, proof_valid, circuit breaker state, and blockers.

```json
{"name": "simulate_claim", "arguments": {"wallet": "2pHj..."}}
```

### Jupiter Routing (2 tools)

**get_jupiter_quote** — Best Jupiter V6 swap quote for any Solana token pair. Supports Token-2022.

```json
{"name": "get_jupiter_quote", "arguments": {"inputMint": "Dxk8mAb3C7AM8JN6tAJfVuSja5yidhZM5sEKW3SRX2BM", "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "amount": 1000000000}}
```

**get_ccm_price** — Current CCM → USDC price via Jupiter. Convenience wrapper with mints pre-filled.

## Best Practices

- Use `get_leaderboard` with `platform: "huggingface"` for the highest-signal velocity data
- Check `get_health` before submitting claims — a tripped relay circuit breaker blocks gasless submissions
- Use `simulate_claim` before `verify_merkle_proof` to avoid wasted RPC calls
- The `velocity_ema` field is the primary attention signal — higher EMA = faster-growing model attention
- All amounts are in base units (1 CCM = 10^9 base units, 1 USDC = 10^6 base units)

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `entity_hash not found` | Invalid SHA-256 hash passed to `get_feed` | Use `get_feeds` first to discover valid entity hashes |
| `market not found` | Invalid market_id | Use `get_leaderboard` to list valid market IDs |
| `relay_circuit_breaker_open` | Relay circuit breaker tripped | Wait for HALF_OPEN recovery or use self-signed claims |
| `proof_invalid` | Stale or incorrect merkle proof | Re-fetch proof via `/v1/claims/:pubkey` endpoint |

## Resources

- [MCP Integration Guide](https://twzrd.xyz/mcp-guide.md)
- [OpenAPI Spec (25 endpoints)](https://twzrd.xyz/openapi.json)
- [Agent Discovery (llms.txt)](https://twzrd.xyz/llms.txt)
- [GitHub](https://github.com/twzrd-sol/wzrd-mcp)
- [Website](https://twzrd.xyz)
