# Solana Skills by SendAI

![Solana Skills](https://assets.sendai.fun/solanaskills/readme-img.png)

A collection of open-source skills for AI agents, specifically designed for **Solana development**. This project follows the [Agent Skills](https://agentskills.io) specification and adapts the structure from [Anthropic's Skills Repository](https://github.com/anthropics/skills).

Skills are folders of instructions, scripts, and resources that Claude (and compatible AI agents) load dynamically to improve performance on specialized tasks. This repository focuses on skills that make Solana development faster, safer, and more accessible.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Compatible-green.svg)](https://agentskills.io)

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Plugin Marketplace](#plugin-marketplace)
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

## Quick Start

Get started with SendAI Skills in seconds:

```bash
# Option 1: Install a complete plugin (recommended)
npx sendai-skills plugin install solana-agent-kit

# Option 2: Add MCP server to Claude Code
npx sendai-skills init

# Option 3: Install individual skills
npx sendai-skills install kamino raydium helius
```

---

## Plugin Marketplace

Plugins bundle related skills, commands, and agents into cohesive packages for specific use cases.

### Available Plugins

| Plugin | Description | Includes |
|--------|-------------|----------|
| **solana-agent-kit** | Build AI agents for Solana blockchain operations | solana-agent-kit, coingecko skills + trading-agent + commands |

### Plugin Commands

```bash
# List available plugins
npx sendai-skills plugin list

# Install a plugin
npx sendai-skills plugin install solana-agent-kit

# Get plugin info
npx sendai-skills plugin info solana-agent-kit

# Remove a plugin
npx sendai-skills plugin remove solana-agent-kit
```

### What Plugins Include

- **Skills**: Domain knowledge Claude applies automatically
- **Commands**: Custom slash commands (e.g., `/setup-agent`, `/check-price`)
- **Agents**: Specialized subagents for specific tasks
- **MCP Server**: Pre-configured Claude Code integration

---

## Project Structure

```
skills/
├── packages/            # npm packages
│   ├── cli/             # sendai-skills CLI tool
│   │   └── src/
│   │       ├── commands/
│   │       │   ├── plugin.ts    # Plugin marketplace commands
│   │       │   ├── init.ts      # MCP setup command
│   │       │   ├── search.ts    # Search skills
│   │       │   ├── info.ts      # Skill details
│   │       │   ├── list.ts      # List skills
│   │       │   ├── install.ts   # Install skills
│   │       │   ├── remove.ts    # Remove skills
│   │       │   └── update.ts    # Update skills
│   │       └── utils/
│   └── mcp-server/      # sendai-skills-mcp MCP server
│       └── src/
│           ├── index.ts         # MCP server
│           └── skills.ts        # Skill loading
├── plugins/             # Plugin packages
│   └── solana-agent-kit/
│       ├── PLUGIN.json          # Plugin manifest
│       ├── README.md
│       ├── commands/            # Slash commands
│       └── agents/              # Subagents
├── skills/              # Skill implementations (28+ skills)
│   ├── kamino/
│   ├── raydium/
│   ├── helius/
│   ├── solana-agent-kit/
│   ├── coingecko/
│   └── ...
├── template/            # Starter template for new skills
│   └── SKILL.md
├── spec/                # Agent Skills specification
│   └── SPECIFICATION.md
├── .github/workflows/   # CI/CD pipelines
├── .gitignore
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
| [example-skill](skills/example-skill/SKILL.md) | An example skill demonstrating the basic structure and format | General |
| [pinocchio-development](skills/pinocchio-development/SKILL.md) | Build high-performance Solana programs with Pinocchio - zero-dependency, zero-copy framework with 88-95% compute unit reduction | Program Development |
| [solana-agent-kit](skills/solana-agent-kit/SKILL.md) | Build AI agents that execute 60+ Solana blockchain operations using SendAI's toolkit with LangChain, Vercel AI, and MCP support | AI Agents |
| [solana-kit](skills/solana-kit/SKILL.md) | Modern, tree-shakeable JavaScript SDK for Solana - formerly web3.js 2.0 with functional design and full TypeScript support | Client Development |
| [solana-kit-migration](skills/solana-kit-migration/SKILL.md) | Migration guide between @solana/web3.js v1.x and @solana/kit with API mappings and edge case handling | Client Development |

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

## Usage

There are two ways to use SendAI Skills with Claude Code:

### Option 1: Plugin Marketplace (Recommended)

Add SendAI Skills as a Claude Code plugin with a single command:

```bash
# Install and configure the plugin
npx sendai-skills init
```

This automatically configures the MCP server so Claude can access all skills dynamically.

**What you can do after setup:**
- Ask Claude: "List all available SendAI skills"
- Ask Claude: "Get the kamino skill for DeFi development"
- Ask Claude: "Help me build a Solana swap using Raydium"

**Plugin CLI Commands:**

```bash
# Add plugin to Claude Code
npx sendai-skills init

# Add with specific skills only
npx sendai-skills init --skills kamino,raydium,helius

# Remove plugin from Claude Code
npx sendai-skills init --remove

# Search for skills
npx sendai-skills search defi
npx sendai-skills search "token swap"

# Get detailed skill information
npx sendai-skills info kamino
```

### Option 2: Local Installation

Install skills directly to your Claude Code skills directory:

```bash
# List all available skills
npx sendai-skills list

# Install specific skills
npx sendai-skills install kamino raydium helius

# Install all skills
npx sendai-skills install --all

# Update installed skills
npx sendai-skills update

# Remove skills
npx sendai-skills remove kamino
```

Skills are installed to `~/.claude/skills/sendai-<skill-name>/`

### MCP Server (Advanced)

For advanced use cases, you can run the MCP server directly:

```bash
# Add MCP server to Claude Code manually
claude mcp add sendai-skills -- npx sendai-skills-mcp

# With specific skills only
claude mcp add sendai-skills -- npx sendai-skills-mcp --skills kamino,helius

# Verify configuration
claude mcp list
```

### Other Compatible Agents

Any AI agent that supports the [Agent Skills](https://agentskills.io) specification can use these skills by loading the `SKILL.md` files.

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
   git clone https://github.com/SendAI/solana-skills.git
   cd solana-skills
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
