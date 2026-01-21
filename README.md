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
├── skills/              # Skill implementations
│   └── example-skill/
│       └── SKILL.md
├── template/            # Starter template for new skills
│   └── SKILL.md
├── spec/                # Agent Skills specification
│   └── SPECIFICATION.md
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

### Claude Code

Skills can be loaded into Claude Code via the plugin marketplace:

```bash
# Register this repository as a marketplace
/plugin marketplace add sendai/solana-skills

# Install specific skill sets
/plugin install solana-skills@sendai-solana-skills
```

Or reference skills directly by mentioning them in your prompts when working on Solana projects.

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
