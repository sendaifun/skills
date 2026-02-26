# Tool Discovery Map

After completing CT research, check what MCP tools the user has available and suggest actionable follow-up steps. This turns research into execution.

## How to Discover Available Tools

The agent should check which MCP tools are available in the current session context. Look for tool name prefixes to identify installed servers.

## Token / Ticker Findings

When CT research surfaces token tickers ($SOL, $PENDLE, $JTO, etc.):

### DeFi Llama (mcp__defillama__*)
- Check TVL: `get_protocol_tvl` with protocol slug
- Compare protocols: `compare_protocols` with array of slugs
- Check yields: `get_top_yield_pools` filtered by project or chain
- Check fees/revenue: `get_fees_protocol` for revenue data
- Price data: `get_current_prices` with chain:address format
- Full protocol info: `get_protocol` for historical TVL + chain breakdown

### Backpack Exchange (mcp__backpack__*)
- Check price: `backpack_get_ticker` with symbol (e.g., "SOL_USDC")
- Check depth: `backpack_get_depth` for liquidity analysis
- Recent trades: `backpack_get_trades` for trade flow
- Price chart: `backpack_get_klines` for OHLCV candles
- Available markets: `backpack_get_markets` to check if token is listed

### Polymarket (mcp__polymarket__*)
- Search related prediction markets: `search_polymarket` with token/protocol name
- Check specific event: `get_event_by_slug` for odds
- Trending markets: `list_markets` to see what's hot

### Postgres/Database (mcp__postgres-mcp__*)
- If user has on-chain data in a database, suggest relevant queries

## Protocol / DeFi Findings

When narratives or ecosystem trends are detected:

### DeFi Llama
- Chain protocols: `get_chain_protocols` for all protocols on a chain
- Top by TVL: `get_top_protocols_by_tvl` with category filter (e.g., "Dexes", "Lending")
- DeFi overview: `get_defi_overview` for macro context
- Top chains: `get_top_chains_by_tvl` for ecosystem comparison
- DEX volumes: `get_top_dexs_by_volume` for trading activity
- Top fees: `get_top_protocols_by_fees` for revenue leaders

## Contract Address Findings

When CAs are extracted from tweets:

### Suggest verification steps:
- "Verify this contract on Solscan/Etherscan"
- "Check liquidity on DexScreener"
- If any rug-check tools available (e.g., Sendai MCP): suggest `RUGCHECK` with the CA

### DeFi Llama
- Token price: `get_current_prices` with "solana:<mint_address>" or "ethereum:<address>"
- Price history: `get_price_chart` for trend analysis

## Risk / FUD Findings

When exploits, hacks, or risks are mentioned:

### DeFi Llama
- Hack database: `get_hacks` to cross-reference with known exploits
- Protocol TVL drop: `get_protocol` to check for sudden TVL changes

## Narrative / Trend Findings

### DeFi Llama
- Categories: `get_categories` for TVL by category
- Yields: `get_top_yield_pools` filtered by narrative theme
- Stablecoins: `get_all_stablecoins` if stablecoin narrative detected

### Polymarket
- Search: `search_polymarket` for prediction markets related to the narrative

## Example Output Format

After research, suggest concrete actions:

```
### Suggested Next Steps (based on available tools)

1. **Check Pendle TVL**: Pendle mentioned 47 times by 23 unique authors
   → `get_protocol_tvl("pendle")` — verify if TVL matches the hype

2. **SOL/USDC depth**: Multiple whale signals detected
   → `backpack_get_depth("SOL_USDC")` — check exchange liquidity

3. **Verify CA**: New token CA mentioned 12 times (UNVERIFIED)
   → Check on Solscan: `https://solscan.io/token/<address>`

4. **Prediction market**: "Solana ETF" narrative gaining traction
   → `search_polymarket("solana ETF")` — check market odds
```

## Guidelines

- Only suggest tools that are actually available in the current session
- Prioritize suggestions that verify or challenge the CT findings (not just confirm bias)
- Always suggest verification for unverified CAs and new tokens
- Include the specific function name and parameters for easy execution
- Frame suggestions as "verify" not "confirm" — encourage skepticism
