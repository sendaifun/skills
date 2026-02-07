# Solana Skills

![Solana Skills](https://assets.sendai.fun/solanaskills/readme-img.png)

AI agent skills for Solana development — DeFi protocols, infrastructure, security, and more.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Compatible-green.svg)](https://agentskills.io)

## Installation

These skills work with any AI agent. We recommend [Claude Code](https://claude.ai/code) with Opus models for best results.

### Claude Code

Add the marketplace:

```
/plugin marketplace add sendaifun/skills
```

Install skills:

```
/plugin install drift
/plugin install helius
/plugin install meteora
```

### Cursor

1. Open Settings (**Cmd+Shift+J** / **Ctrl+Shift+J**)
2. Navigate to **Rules & Commands** → **Project Rules** → **Add Rule** → **Remote Rule (GitHub)**
3. Enter: `https://github.com/sendaifun/skills.git`

Skills are auto-discovered based on context. Ask about Drift perpetuals, Helius RPCs, or Metaplex NFTs and the agent uses the relevant skill automatically.

**Verify:** Ask *"How do I place a perp order on Drift?"* — if working, the agent will reference Drift SDK patterns.

### Any Agent

```
npx skills add sendaifun/skills
```

## Available Skills

### DeFi

| Skill | Description |
|-------|-------------|
| [drift](skills/drift/) | Perpetuals, spot trading, cross-collateral, and vaults |
| [kamino](skills/kamino/) | Lending, borrowing, liquidity management, leverage trading |
| [lulo](skills/lulo/) | Lending aggregator across Kamino, Drift, MarginFi, Jupiter |
| [marginfi](skills/marginfi/) | Lending, borrowing, leveraged positions (looping) and flash loans |
| [meteora](skills/meteora/) | DLMM, DAMM pools, bonding curves, Alpha Vaults |
| [orca](skills/orca/) | Whirlpools concentrated liquidity AMM, swaps, positions |
| [pumpfun](skills/pumpfun/) | Token launches, bonding curves, PumpSwap AMM |
| [raydium](skills/raydium/) | AMM pools, CLMM, CPMM, LaunchLab token launches |
| [sanctum](skills/sanctum/) | Liquid staking, LST swaps, Infinity pool |

### Infrastructure

| Skill | Description |
|-------|-------------|
| [helius](skills/helius/) | RPC, DAS API, webhooks, priority fees, LaserStream gRPC |
| [light-protocol](skills/light-protocol/) | ZK Compression, rent-free compressed tokens |
| [magicblock](skills/magicblock/) | Ephemeral Rollups, sub-10ms latency, gasless transactions |
| [squads](skills/squads/) | Multisig wallets, smart accounts, account abstraction |

### Trading

| Skill | Description |
|-------|-------------|
| [dflow](skills/dflow/) | Spot trading, prediction markets, Swap API, WebSocket streaming |
| [ranger-finance](skills/ranger-finance/) | Perps aggregator across Drift, Flash, Adrena, Jupiter |

### Oracles

| Skill | Description |
|-------|-------------|
| [pyth](skills/pyth/) | Real-time price feeds, confidence intervals, EMA prices |
| [switchboard](skills/switchboard/) | Price feeds, on-demand data, VRF randomness, Surge streaming |

### Data & Analytics

| Skill | Description |
|-------|-------------|
| [coingecko](skills/coingecko/) | Token prices, DEX pool data, OHLCV charts, trades |

### Cross-Chain

| Skill | Description |
|-------|-------------|
| [debridge](skills/debridge/) | Cross-chain bridges, message passing, Solana ↔ EVM transfers |

### NFT & Tokens

| Skill | Description |
|-------|-------------|
| [metaplex](skills/metaplex/) | Core, Token Metadata, Bubblegum, Candy Machine, Umi framework |

### Client Development

| Skill | Description |
|-------|-------------|
| [solana-kit](skills/solana-kit/) | Modern tree-shakeable SDK from Anza, zero dependencies |
| [solana-kit-migration](skills/solana-kit-migration/) | Migration guide from @solana/web3.js v1.x to @solana/kit |

### Program Development

| Skill | Description |
|-------|-------------|
| [pinocchio-development](skills/pinocchio-development/) | Zero-copy framework for high-performance programs (88-95% CU reduction) |

### AI Agents

| Skill | Description |
|-------|-------------|
| [solana-agent-kit](skills/solana-agent-kit/) | 60+ Solana operations with LangChain, Vercel AI, MCP support |

### Security

| Skill | Description |
|-------|-------------|
| [vulnhunter](skills/vulnhunter/) | Vulnerability detection, dangerous API hunting, variant analysis |
| [code-recon](skills/zz-code-recon/) | Deep architectural context building for security audits |

### DevOps

| Skill | Description |
|-------|-------------|
| [surfpool](skills/surfpool/) | Development environment with mainnet forking, cheatcodes |

## Ideas

Looking for skills to build? Check out [IDEAS.md](IDEAS.md) for community-requested skills.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on creating new skills.

## License

[Apache 2.0](LICENSE)

## Acknowledgments

Built on [Anthropic's Skills](https://github.com/anthropics/skills) and the [Agent Skills Specification](https://agentskills.io).

---

<p align="center">
  Built by <a href="https://github.com/sendaifun">SendAI</a> for the Solana ecosystem
</p>
