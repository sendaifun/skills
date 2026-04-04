# MCP Setup — Krexa Tools for AI Coding Assistants

Krexa exposes its full functionality as MCP (Model Context Protocol) tools, letting AI coding assistants like Claude Code and Cursor interact with the protocol directly.

## Claude Code

```bash
claude mcp add krexa --scope user -- npx -y @krexa/cli mcp
```

After adding, you can ask Claude:
- "Register me as a service agent on Krexa and borrow 100 USDC"
- "Check my Krexit Score and tell me what I need to reach L2"
- "Swap 50 USDC for SOL using Jupiter"
- "Show my portfolio and yield opportunities"

## Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "krexa": {
      "command": "npx",
      "args": ["-y", "@krexa/cli", "mcp"]
    }
  }
}
```

## Generic MCP Client

The MCP server runs via stdio transport:

```bash
npx -y @krexa/cli mcp
```

Connect any MCP-compatible client to the stdio stream.

## Exposed MCP Tools

| Tool | Description |
|------|-------------|
| `krexa_register_agent` | Register a new agent (trader/service/hybrid) with PDA wallet and score |
| `krexa_check_balance` | Check USDC and SOL balance in agent PDA wallet |
| `krexa_get_score` | Get Krexit Score with component breakdown |
| `krexa_draw_credit` | Borrow USDC from the Credit Vault |
| `krexa_repay` | Repay outstanding credit (full or partial) |
| `krexa_pay` | Send USDC payment to a whitelisted address |
| `krexa_trade` | Execute a trade on a whitelisted DEX |
| `krexa_swap` | Swap tokens via Jupiter aggregator |
| `krexa_quote` | Get a swap quote without executing |
| `krexa_portfolio` | View all token balances and positions |
| `krexa_yield_scan` | Scan available yield opportunities on Solana |

## Tool Details

### krexa_register_agent
```
Input: { type: "trader" | "service" | "hybrid", name: string }
Output: { agentAddress, walletPda, type, creditLevel, score }
```

### krexa_check_balance
```
Input: {} (uses configured agent)
Output: { usdc: number, sol: number, walletPda: string }
```

### krexa_get_score
```
Input: { agent?: string } (defaults to configured agent)
Output: { score, components, creditLevel, maxCredit, apr }
```

### krexa_draw_credit
```
Input: { amount: number }
Output: { txSignature, amount, outstandingDebt, dailyInterest }
```

### krexa_repay
```
Input: { amount: number | "max" }
Output: { txSignature, amountRepaid, remainingDebt }
```

### krexa_pay
```
Input: { recipient: string, amount: number, currency: "USDC" }
Output: { txSignature, amount, fee }
```

### krexa_trade
```
Input: { venue: string, pair: string, side: "buy" | "sell", amount: number }
Output: { txSignature, filled, price, venue }
```

### krexa_swap
```
Input: { from: string, to: string, amount: number, slippage?: number }
Output: { txSignature, amountIn, amountOut, route }
```

### krexa_quote
```
Input: { from: string, to: string, amount: number }
Output: { amountOut, route, priceImpact, fee }
```

### krexa_portfolio
```
Input: {}
Output: { tokens: [{ symbol, balance, valueUsd }], totalValueUsd }
```

### krexa_yield_scan
```
Input: { minApr?: number }
Output: { opportunities: [{ protocol, pool, apr, tvl, risk }] }
```

## Environment Variables

Set these before running the MCP server:

| Variable | Required | Description |
|----------|----------|-------------|
| `KREXA_API_KEY` | Yes | API key from krexa.xyz/dashboard |
| `KREXA_AGENT_ADDRESS` | Yes | Your agent's Solana public key |
| `KREXA_NETWORK` | No | `devnet` (default) or `mainnet` |
| `KREXA_RPC_URL` | No | Custom Solana RPC endpoint |

```bash
export KREXA_API_KEY="your-api-key"
export KREXA_AGENT_ADDRESS="your-agent-pubkey"
claude mcp add krexa --scope user -- npx -y @krexa/cli mcp
```
