# Contributing

Thanks for your interest in contributing to Solana Skills. This guide covers everything you need to create and submit a new skill.

## Creating a New Skill

Fork the repo and clone it, then copy the template:

```bash
cp -r template/ skills/your-skill-name/
```

Skill names: lowercase, hyphens for spaces (e.g., `anchor-testing`, `token-2022`).

### Write SKILL.md

Every skill needs a `SKILL.md` file with frontmatter and instructions:

```yaml
---
name: your-skill-name
description: What this skill does and when an AI agent should use it
---
```

**Frontmatter tips:**
- Include protocol/project names (e.g., "Jupiter", "Metaplex") — agents use this to decide when to load the skill
- Use action verbs: "Build", "Create", "Integrate", "Deploy"
- Mention key technologies: SDK names, frameworks, standards

**SKILL.md structure:**

```markdown
# Your Skill Name

Brief introduction.

## Overview

What problem this solves and why it matters.

## Instructions

Step-by-step guidance for the AI agent:
1. First, understand the user's requirements
2. Apply these patterns...
3. Verify the output meets these criteria...

## Examples

### Basic Usage

When user asks: "Help me [task]"

The agent should:
1. Do this
2. Then this
3. Output this

## Guidelines

- **DO**: Best practice
- **DON'T**: Anti-pattern to avoid

## Common Errors

### Error: [Name]
**Cause**: Why it happens
**Solution**: How to fix

## References

- [Official Docs](https://example.com)
```

### Test Your Skill

1. Load the skill in Claude Code or compatible agent
2. Test with various prompts
3. Verify edge cases are handled
4. Check outputs are correct and secure

### Add to Marketplace

Add your skill to `.claude-plugin/marketplace.json`:

```json
{
  "name": "your-skill-name",
  "source": "./skills/your-skill-name",
  "description": "Brief description matching your SKILL.md frontmatter",
  "category": "DeFi | Infrastructure | Trading | Oracles | Security | DevOps"
}
```

Add the entry to the `plugins` array in alphabetical order.

## Skill Structure

```
your-skill-name/
├── SKILL.md          # Required: Main instructions for the AI agent
├── docs/             # Optional: Deep-dive documentation
│   └── troubleshooting.md
├── resources/        # Optional: API references, addresses, configs
│   └── api-reference.md
├── examples/         # Optional: Copy-paste code samples
│   └── basic/
│       └── example.ts
└── templates/        # Optional: Starter boilerplate
    └── setup.ts
```

| Directory | Purpose | When to Use |
|-----------|---------|-------------|
| `docs/` | Troubleshooting, advanced patterns, migration guides | When SKILL.md gets too long |
| `resources/` | API references, program IDs, token addresses, error codes | Static data the agent looks up frequently |
| `examples/` | Working code samples organized by use case | Complete, runnable implementations |
| `templates/` | Starter code users copy | Common boilerplate to scaffold |

## Submitting Your PR

### Checklist

- [ ] Skill follows the template structure
- [ ] Instructions are clear and unambiguous
- [ ] Examples cover common use cases
- [ ] Security best practices followed
- [ ] Tested with Claude Code or compatible agent
- [ ] Added entry to `.claude-plugin/marketplace.json`

### Submit

```bash
git checkout -b feat/your-skill-name
git add .
git commit -m "feat: add your-skill-name skill"
git push origin feat/your-skill-name
```

Open a PR with a descriptive title. Maintainers will review and provide feedback.

**Commit prefixes:** `feat:` (new skills), `fix:` (bug fixes), `docs:` (documentation)

## Style Guidelines

- Use imperative language ("Do X" not "You should do X")
- Include copy-paste ready examples
- Be specific — AI agents need precise guidance
- Include security considerations
- Reference official documentation
- Account for devnet vs mainnet differences

## Other Contributions

- **Bug fixes**: Improve existing skills with incorrect or outdated instructions
- **Documentation**: Fix typos, add clarity, improve examples
- **Ideas**: Check [IDEAS.md](IDEAS.md) or open an issue to propose new skills

## Code of Conduct

Be respectful, inclusive, and constructive. Harassment, personal attacks, or dismissive behavior will result in warnings or bans.

## Help

- **Issues**: [GitHub Issues](https://github.com/sendaifun/skills/issues) for bugs or proposals
- **Resources**: [Agent Skills Spec](https://agentskills.io) · [Solana Docs](https://solana.com/docs)
