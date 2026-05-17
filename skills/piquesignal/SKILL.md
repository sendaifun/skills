---
name: piquesignal
description: Access live scored Solana memecoin signals, on-chain safety profiles, AI analysis reports, and historical track record metrics from Pique Signal. Use when building trading agents, research dashboards, or any tool that needs real-time token intelligence on Solana.
---

# Pique Signal

Real-time memecoin signal intelligence for Solana. Provides scored token signals, safety data, AI reports, and track record metrics via a simple REST API.

## Overview

Pique Signal monitors Solana memecoins and surfaces actionable signals with safety scoring and AI analysis. Use this skill when you need to:

- Get live scored token signals with entry timing
- Check on-chain safety profiles for any Solana token
- Generate AI analysis reports on flagged tokens
- Review historical performance and hit rate metrics
- Build trading agents or research tools on Solana

## Instructions

### Setup

1. Install the Solana Agent Kit plugin:
   ```bash
   npm install piquesignal-solana-agent-plugin solana-agent-kit
   ```

2. Set the API key environment variable:
   ```bash
   export PIQUESIGNAL_API_KEY=YOUR_API_KEY
   ```
   Get a key from the [Pique Signal Telegram bot](https://t.me/piquesignalbot) via `/apikey`. 72-hour free trial with full access.

3. Register the plugin with your agent:
   ```typescript
   import { SolanaAgentKit, createVercelAITools } from "solana-agent-kit";
   import PiqueSignalPlugin from "piquesignal-solana-agent-plugin";

   const agent = new SolanaAgentKit(wallet, rpcUrl, config)
     .use(PiqueSignalPlugin);

   const tools = createVercelAITools(agent, agent.actions);
   ```

### Available Actions

- **getSignals** - Fetch live scored memecoin signals. Returns token address, score, market cap, and timing data.
- **getTokenSafety** - On-chain safety profile for any Solana token mint. Returns liquidity lock status, holder distribution, deployer history.
- **getSignalReport** - AI-generated analysis report for a specific token. Explains why it was flagged and risk factors.
- **getTrackRecord** - Historical performance metrics: hit rate, average return, tokens surfaced.
- **getHealth** - API health check and system status.

## Examples

### Get Live Signals

When user asks: "What memecoin signals are active right now?"

```typescript
const signals = await agent.methods.getSignals();
// Returns array of scored tokens with entry data
```

### Check Token Safety

When user asks: "Is this token safe to trade?" with a mint address:

```typescript
const safety = await agent.methods.getTokenSafety({
  mint: "TOKEN_MINT_ADDRESS"
});
// Returns safety profile with risk indicators
```

### Get AI Report

When user asks: "Give me a detailed report on this token":

```typescript
const report = await agent.methods.getSignalReport({
  mint: "TOKEN_MINT_ADDRESS"
});
// Returns AI-generated analysis
```

### Check Track Record

When user asks: "How accurate are these signals?":

```typescript
const record = await agent.methods.getTrackRecord();
// Returns hit rate, returns, and historical metrics
```

## Guidelines

- **DO**: Check token safety before recommending any trade
- **DO**: Use getTrackRecord to contextualize signal quality for users
- **DO**: Combine signals with safety data for complete analysis
- **DON'T**: Execute trades based on signals alone without safety checks
- **DON'T**: Cache signal data for extended periods (signals are time-sensitive)
- **DON'T**: Expose raw API internals or signal source names to end users

## Common Errors

### Error: Invalid API Key
**Cause**: Missing or expired PIQUESIGNAL_API_KEY
**Solution**: Get a new key from @piquesignalbot on Telegram via /apikey

### Error: Rate Limited
**Cause**: Too many requests per minute
**Solution**: Add delays between calls. Free tier allows 30 requests/minute.

### Error: Token Not Found
**Cause**: Mint address not in the signal database
**Solution**: Only tokens that have been scored will return data. Use getSignals to see currently tracked tokens.

## References

- [Pique Signal](https://piquesignal.xyz)
- [API Documentation](https://piquesignal.xyz/api-docs)
- [SAK Plugin on npm](https://www.npmjs.com/package/piquesignal-solana-agent-plugin)
- [SAK Plugin on GitHub](https://github.com/piquesignal/piquesignal-solana-agent-plugin)
- [MCP Server](https://github.com/piquesignal/piquesignal-mcp)
