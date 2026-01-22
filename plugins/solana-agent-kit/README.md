# Solana Agent Kit Plugin

Build AI agents that autonomously execute Solana blockchain operations with market intelligence.

## What's Included

### Skills
- **solana-agent-kit** - 60+ Solana blockchain actions (tokens, NFTs, DeFi, staking)
- **coingecko** - Real-time market data, OHLCV charts, pool analytics

### Commands
- `/setup-agent` - Initialize a new Solana agent project
- `/check-price` - Quick token price lookup

### Agents
- **trading-agent** - Autonomous trading agent with market analysis

### MCP Server
- **solana-mcp** - Claude Desktop integration for blockchain operations

## Quick Start

```bash
# Install the plugin
npx sendai-skills plugin install solana-agent-kit

# Or add directly to Claude Code
npx sendai-skills init --plugin solana-agent-kit
```

## Environment Setup

Create a `.env` file with:

```bash
RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_private_key
OPENAI_API_KEY=your_openai_key
COINGECKO_API_KEY=your_coingecko_key  # Optional
```

## Usage

After installation, Claude will automatically:
1. Apply solana-agent-kit knowledge when building Solana agents
2. Use CoinGecko APIs for market data queries
3. Have access to the `/setup-agent` and `/check-price` commands

### Example Prompts

```
"Create a trading bot that swaps SOL to USDC when the price drops 5%"
"Get the current price of JUP token"
"Set up a Solana agent with LangChain integration"
"Build an autonomous agent that monitors my portfolio"
```

## Included Skills Detail

### solana-agent-kit
- Token operations (deploy, transfer, stake)
- NFT minting and management
- DeFi integrations (Jupiter, Raydium, Orca)
- LangChain & Vercel AI SDK support
- MCP server for Claude Desktop

### coingecko
- Token price feeds by contract address
- DEX pool data and liquidity info
- OHLCV candlestick charts
- Trade history and volume analytics
- Trending pools and megafilter

## License

Apache-2.0
