---
name: piquesignal
description: Paper trade Solana memecoin signals from the Pique Signal Convergence Engine directly in Claude Code. Pull Flash Point alerts, execute simulated trades with risk management, and track P&L across sessions.
---

# Pique Signal - Solana Signal Intelligence + Paper Trading

Use the `piquesignal` MCP server to pull live Solana memecoin signals and paper trade them directly in Claude Code.

The Convergence Engine scores tokens across on-chain data, liquidity, holder behavior, and momentum. When enough independent signals converge, it fires a Flash Point alert. This skill lets you pull those alerts, simulate trades with a built-in risk engine, and track P&L over days or weeks without risking capital.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_signals` | Pull live Flash Point alerts with safety data, scores, and market metrics |
| `get_price` | Real-time token price in SOL via Jupiter, DexScreener fallback |
| `paper_buy` | Simulated buy with confidence-scaled sizing, liquidity checks, and exposure caps |
| `paper_sell` | Close a position at market price. Returns realized P&L and hold time |
| `get_positions` | Open positions with live prices and unrealized P&L. Auto-triggers SL/TP |
| `get_portfolio` | Balance, total P&L, win rate, completed trades, risk config |

## Setup

### 1. Get an API key

Send `/apikey` to [@piquesignalbot](https://t.me/piquesignalbot) on Telegram. The 72-hour free trial starts automatically.

### 2. Install

```bash
git clone https://github.com/piquesignal/piquesignal-mcp.git
cd piquesignal-mcp
npm install
```

### 3. Add to Claude Code

```bash
claude mcp add piquesignal -- node /path/to/piquesignal-mcp/src/index.js
```

Set `PIQUESIGNAL_API_KEY` to your API key when prompted.

## Examples

Talk naturally. Claude handles the tool calls.

### Check for signals

> "Any strong signals in the last hour?"

Uses `get_signals` to pull recent Flash Point alerts. You can filter by score or time window.

> "Show me signals above score 40 from the last 30 minutes"

### Trade a signal

> "That one looks good, buy it"

Uses `paper_buy` with the token's mint address. Position size scales with signal score. The risk engine checks liquidity, exposure limits, and duplicate positions before executing.

### Monitor positions

> "How are my positions doing?"

Uses `get_positions` to show open trades with live prices and unrealized P&L. Stop-loss and take-profit auto-execute when thresholds are hit.

### Review performance

> "Show my portfolio"

Uses `get_portfolio` for full summary: balance, total P&L, win rate, trade history, and current risk configuration.

## Configuration

All settings via environment variables in your Claude Code MCP config:

| Variable | Default | Description |
|----------|---------|-------------|
| `PIQUESIGNAL_API_KEY` | *required* | Your API key |
| `PAPER_BALANCE_SOL` | `10` | Starting paper balance |
| `MAX_POSITION_SOL` | `0.5` | Max SOL per trade |
| `MAX_EXPOSURE_SOL` | `5.0` | Max total open exposure |
| `STOP_LOSS_PCT` | `15` | Auto stop-loss percentage |
| `TAKE_PROFIT_PCT` | `50` | Auto take-profit percentage |
| `MIN_LIQUIDITY_USD` | `10000` | Min pool liquidity to trade |

## Guidelines

- Start with the 72-hour free trial to evaluate signal quality on paper before committing capital
- Use `get_signals` with `min_score` to filter for higher-conviction alerts
- Paper state persists to `~/.piquesignal/paper-state.json` across sessions
- All trades are simulated with real-time prices from Jupiter and DexScreener
- The risk engine enforces position limits, exposure caps, and liquidity floors automatically
- HTTPS enforced on all API communication. API keys are never logged or exposed in tool outputs

## Resources

- [Pique Signal](https://piquesignal.xyz)
- [MCP Server Repository](https://github.com/piquesignal/piquesignal-mcp)
- [Get API Key](https://t.me/piquesignalbot)
