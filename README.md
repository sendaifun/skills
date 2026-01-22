# Solana Skills by SendAI

![Solana Skills](https://assets.sendai.fun/solanaskills/readme-img.png)

A collection of open-source skills for AI agents, specifically designed for **Solana development**. This project follows the [Agent Skills](https://agentskills.io) specification and adapts the structure from [Anthropic's Skills Repository](https://github.com/anthropics/skills).

Skills are folders of instructions, scripts, and resources that Claude (and compatible AI agents) load dynamically to improve performance on specialized tasks. This repository focuses on skills that make Solana development faster, safer, and more accessible.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Compatible-green.svg)](https://agentskills.io)

---

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [What is a Skill?](#what-is-a-skill)
- [Creating a New Skill](#creating-a-new-skill)
- [Solana Skills](#solana-skills)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Overview

The Solana ecosystem moves fast. New protocols, SDKs, and best practices emerge constantly. AI coding assistants are powerful, but they need specialized knowledge to be truly effective in the Solana ecosystem.

**Solana Skills by SendAI** aims to:

- Provide high-quality, community-maintained skills for Solana development
- Encode best practices from the Solana ecosystem into reusable instructions
- Reduce common mistakes when building on Solana
- Create a collaborative resource that grows with the ecosystem

---

## Project Structure

```
skills/
├── skills/                  # Skill implementations
│   └── example-skill/       # Example skill structure
│       ├── SKILL.md         # Main skill instructions (required)
│       ├── docs/            # Documentation
│       │   └── troubleshooting.md
│       ├── examples/        # Code examples
│       │   └── basic/
│       │       └── example.ts
│       ├── resources/       # API references and configs
│       │   └── api-reference.md
│       └── templates/       # Starter templates
│           └── setup.ts
├── spec/                    # Agent Skills specification
│   └── SPECIFICATION.md
├── template/                # Starter template for new skills
│   └── SKILL.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## What is a Skill?

A skill is a self-contained folder that provides AI agents with specialized instructions for specific tasks. Each skill requires at minimum one file: `SKILL.md`.

Skills can also include:
- **scripts/** - Supporting automation scripts
- **resources/** - Templates, configs, or reference files
- **examples/** - Sample code or usage demonstrations

### SKILL.md Format

```yaml
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---

# My Skill Name

Instructions for the AI agent to follow when this skill is active.

## Overview
What this skill helps accomplish.

## Instructions
1. Step-by-step guidance
2. That the agent follows
3. When executing tasks

## Examples
- Example usage pattern 1
- Example usage pattern 2

## Guidelines
- Constraints and best practices
- Edge cases to handle
```

### Required Frontmatter

| Field | Description |
|-------|-------------|
| `name` | Unique identifier (lowercase, hyphens for spaces) |
| `description` | What the skill does and when to use it |

---

## Creating a New Skill

1. **Copy the template**
   ```bash
   cp -r template/ skills/your-skill-name/
   ```

2. **Rename and edit**
   - Use lowercase with hyphens (e.g., `anchor-testing`, `token-2022`)
   - Edit `SKILL.md` with your skill's instructions

3. **Test your skill**
   - Try the skill in Claude Code or compatible agent
   - Verify it handles edge cases correctly

4. **Submit a PR**
   - See [Contributing](#contributing) guidelines below

---

## Solana Skills

### Integrated

Skills that are currently implemented and available in this repository.

| Skill | Description | Category |
|-------|-------------|----------|
| [coingecko](skills/coingecko/SKILL.md) | CoinGecko Solana API for token prices, DEX pool data, OHLCV charts, trades, and market analytics | Data & Analytics |
| [debridge](skills/debridge/SKILL.md) | deBridge Protocol SDK for cross-chain bridges, message passing, and token transfers between Solana and EVM chains | Cross-Chain |
| [dflow](skills/dflow/SKILL.md) | DFlow trading protocol for spot trading, prediction markets, Swap API, and WebSocket streaming | Trading |
| [drift](skills/drift/SKILL.md) | Drift Protocol SDK for perpetual futures, spot trading, cross-collateral, and vaults | DeFi |
| [example-skill](skills/example-skill/SKILL.md) | Template and guide for creating new skills with standard structure | General |
| [helius](skills/helius/SKILL.md) | Helius RPC infrastructure, DAS API, Enhanced Transactions, Priority Fees, Webhooks, and LaserStream gRPC | Infrastructure |
| [kamino](skills/kamino/SKILL.md) | Kamino Finance for lending, borrowing, liquidity management, leverage trading, and oracle aggregation | DeFi |
| [light-protocol](skills/light-protocol/SKILL.md) | Light Protocol for ZK Compression, rent-free compressed tokens, and high-performance token standard | Infrastructure |
| [lulo](skills/lulo/SKILL.md) | Lulo lending aggregator for automated yield optimization across Kamino, Drift, MarginFi, and Jupiter | DeFi |
| [magicblock](skills/magicblock/SKILL.md) | MagicBlock Ephemeral Rollups for sub-10ms latency, gasless transactions, and real-time applications | Infrastructure |
| [metaplex](skills/metaplex/SKILL.md) | Metaplex Protocol for NFTs, Core, Token Metadata, Bubblegum, Candy Machine, and Umi framework | NFT & Tokens |
| [meteora](skills/meteora/SKILL.md) | Meteora DeFi SDK for DLMM, DAMM pools, Dynamic Bonding Curves, Alpha Vaults, and token launches | DeFi |
| [orca](skills/orca/SKILL.md) | Orca Whirlpools SDK for concentrated liquidity AMM, swaps, liquidity provision, and position management | DeFi |
| [pinocchio-development](skills/pinocchio-development/SKILL.md) | Pinocchio zero-dependency, zero-copy framework for high-performance Solana programs (88-95% CU reduction) | Program Development |
| [pumpfun](skills/pumpfun/SKILL.md) | PumpFun Protocol for token launches, bonding curves, and PumpSwap AMM integration | Defi |
| [pyth](skills/pyth/SKILL.md) | Pyth Network oracle for real-time price feeds, confidence intervals, and EMA prices | Oracles |
| [ranger-finance](skills/ranger-finance/SKILL.md) | Ranger Finance perps aggregator for smart order routing across Drift, Flash, Adrena, and Jupiter | Trading |
| [raydium](skills/raydium/SKILL.md) | Raydium Protocol for AMM pools, CLMM, CPMM, LaunchLab token launches, and liquidity infrastructure | DeFi |
| [sanctum](skills/sanctum/SKILL.md) | Sanctum SDK for liquid staking, LST swaps, Infinity pool, and 1,361+ liquid staking tokens | DeFi |
| [solana-agent-kit](skills/solana-agent-kit/SKILL.md) | Build AI agents that execute 60+ Solana blockchain operations with LangChain, Vercel AI, and MCP support | AI Agents |
| [solana-kit](skills/solana-kit/SKILL.md) | Modern tree-shakeable JavaScript SDK from Anza with zero dependencies and full TypeScript support | Client Development |
| [solana-kit-migration](skills/solana-kit-migration/SKILL.md) | Migration guide between @solana/web3.js v1.x and @solana/kit with API mappings | Client Development |
| [squads](skills/squads/SKILL.md) | Squads Protocol for multisig wallets, smart accounts, account abstraction, and Grid stablecoin rails | Infrastructure |
| [surfpool](skills/surfpool/SKILL.md) | Surfpool development environment with mainnet forking, cheatcodes, and Infrastructure as Code | DevOps |
| [switchboard](skills/switchboard/SKILL.md) | Switchboard Oracle for price feeds, on-demand data, VRF randomness, and Surge streaming | Oracles |
| [vulnhunter](skills/vulnhunter/SKILL.md) | Security vulnerability detection, dangerous API hunting, and variant analysis for audits | Security |
| [code-recon](skills/zz-code-recon/SKILL.md) | Deep architectural context building for security audits and codebase reconnaissance | Security |

### Ideas

Community-requested and planned skills for Solana development. **Contributions welcome!**

| Skill | Description | Category |
|-------|-------------|----------|
| `anchor-scaffolding` | Generate Anchor program boilerplate with best practices | Program Development |
| `anchor-testing` | Write comprehensive tests for Anchor programs | Program Development |
| `program-security-audit` | Security checklist and common vulnerability patterns | Program Development |
| `cpi-patterns` | Cross-Program Invocation best practices | Program Development |
| `pda-derivation` | PDA design patterns and derivation strategies | Program Development |
| `account-validation` | Proper account validation and constraint patterns | Program Development |
| `token-2022` | Create and manage Token-2022 (Token Extensions) tokens | Token Development |
| `spl-token` | Classic SPL Token operations and management | Token Development |
| `nft-creation` | Metaplex NFT minting and collection management | Token Development |
| `compressed-nfts` | Bubblegum compressed NFT operations | Token Development |
| `token-metadata` | Token metadata standards and best practices | Token Development |
| `wallet-adapter` | Wallet integration with Solana Wallet Adapter | Client Development |
| `transaction-building` | Efficient transaction construction and optimization | Client Development |
| `priority-fees` | Compute unit estimation and priority fee strategies | Client Development |
| `rpc-optimization` | RPC best practices, caching, and rate limiting | Client Development |
| `jito-bundles` | MEV protection and Jito bundle transactions | Performance |
| `helius-integration` | Helius RPC, webhooks, and DAS API | Performance |
| `compute-optimization` | Reduce CU consumption in programs | Performance |
| `indexing-geyser` | Geyser plugins and data indexing | Performance |
| `signer-verification` | Proper signer and authority checks | Security |
| `reentrancy-prevention` | Prevent reentrancy attacks in Solana programs | Security |
| `integer-overflow` | Safe math and overflow protection | Security |
| `access-control` | Role-based access patterns | Security |
| `jupiter-swap` | Jupiter aggregator integration | DeFi |
| `raydium-pools` | Raydium AMM and CLMM integration | DeFi |
| `orca-whirlpools` | Orca Whirlpools SDK usage | DeFi |
| `marinade-staking` | Liquid staking with Marinade | DeFi |
| `flash-loans` | Flash loan patterns on Solana | DeFi |
| `solana-test-validator` | Local validator setup and configuration | DevOps |
| `program-deployment` | Mainnet deployment checklist and strategies | DevOps |
| `upgrade-patterns` | Program upgrade and migration patterns | DevOps |
| `monitoring-alerts` | On-chain monitoring and alerting setup | DevOps |
| `blinks-actions` | Solana Actions and Blinks development | Emerging |
| `mobile-wallet-adapter` | Mobile Wallet Adapter (MWA) integration | Emerging |

> **Have an idea?** Open an issue or PR to suggest new skills!

---

## Contributing

We welcome contributions from the Solana community! Here's how you can help:

### Ways to Contribute

- **Create new skills** - Pick from the Ideas table or propose your own
- **Fix bugs** - Improve existing skills with better instructions
- **Improve docs** - Help make skills clearer and more comprehensive
- **Suggest ideas** - Open issues for new skill proposals
- **Test skills** - Try skills and report issues or improvements

### Contribution Process

1. **Fork the repository**
   ```bash
   git clone https://github.com/sendaifun/skills.git
   cd skills
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feat/your-skill-name
   ```

3. **Create your skill**
   - Follow the template structure
   - Write clear, tested instructions
   - Include practical examples

4. **Test your skill**
   - Verify it works in Claude Code or compatible agent
   - Test edge cases and error scenarios

5. **Submit a Pull Request**
   - Fill out the PR template
   - Reference any related issues
   - Be responsive to feedback

### Skill Quality Guidelines

- **Focused scope** - One skill, one purpose
- **Clear instructions** - Unambiguous, step-by-step guidance
- **Practical examples** - Real-world usage patterns
- **Error handling** - Address common failure modes
- **Security-conscious** - Follow Solana security best practices
- **Well-documented** - Include context and references

### Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers get started
- Credit others' contributions

---

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

```
Copyright 2024 SendAI

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## Acknowledgments

This project is built upon and inspired by:

- **[Anthropic's Skills Repository](https://github.com/anthropics/skills)** - The original skills implementation for Claude
- **[Agent Skills Specification](https://agentskills.io)** - The open standard for agent skills
- **[Solana Foundation](https://solana.org)** - For building an incredible blockchain
- **The Solana Developer Community** - For continuous innovation and shared knowledge

Special thanks to all contributors who help make Solana development more accessible through AI-powered skills.

---

## Resources

- [Solana Documentation](https://solana.com/docs)
- [Anchor Framework](https://www.anchor-lang.com/)
- [Metaplex Documentation](https://developers.metaplex.com/)
- [Helius Documentation](https://docs.helius.dev/)
- [Jito Documentation](https://jito-labs.gitbook.io/)

---

<p align="center">
  Built & maintained by <a href="https://github.com/sendaifun">SendAI</a> for the Solana ecosystem
</p>
