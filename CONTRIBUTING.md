# Contributing to Solana Skills

Thank you for your interest in contributing to Solana Skills by SendAI! This document provides guidelines and information for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Types of Contributions](#types-of-contributions)
- [Creating a New Skill](#creating-a-new-skill)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)
- [Code of Conduct](#code-of-conduct)
- [Questions and Support](#questions-and-support)

---

## Getting Started

### Prerequisites

- Familiarity with Solana development concepts
- Experience with Git and GitHub
- Access to Claude Code or compatible AI agent for testing

### Setting Up

1. **Fork the repository**

   Click the "Fork" button on GitHub to create your own copy.

2. **Clone your fork**

   ```bash
   git clone https://github.com/YOUR_USERNAME/solana-skills.git
   cd solana-skills
   ```

3. **Add upstream remote**

   ```bash
   git remote add upstream https://github.com/SendAI/solana-skills.git
   ```

4. **Keep your fork updated**

   ```bash
   git fetch upstream
   git merge upstream/main
   ```

---

## Types of Contributions

### New Skills

Create skills for Solana development tasks. Check the [Ideas](README.md#ideas) for ideas or propose your own.

### Bug Fixes

Improve existing skills that have incorrect or outdated instructions.

### Documentation

- Improve skill clarity and examples
- Fix typos or grammatical errors
- Add missing context or edge cases

### Proposals

Open an issue to propose new skills or improvements before starting work.

### Testing

Test existing skills and report issues or suggest improvements.

---

## Creating a New Skill

### Step 1: Choose Your Skill

- Check the [Ideas](README.md#ideas) for planned skills
- Open an issue to discuss new skill ideas
- Ensure the skill doesn't duplicate existing functionality

### Step 2: Create the Skill Directory

```bash
# Copy the template
cp -r template/ skills/your-skill-name/

# Skill names must be:
# - Lowercase
# - Use hyphens for spaces
# - Descriptive but concise
```

### Step 3: Write the SKILL.md

Follow this structure:

```yaml
---
name: your-skill-name
description: A comprehensive description of what this skill does and when an AI agent should use it
---
```

> **Tips for Writing Effective Frontmatter:**
>
> - **Include protocol/project names** in the description (e.g., "Jupiter", "Raydium", "Metaplex"). Agents use the description to determine when to load the skill, so explicit mentions help with recognition.
> - **Use action-oriented language** - Start with verbs like "Build", "Create", "Integrate", "Deploy" to clarify the skill's purpose.
> - **Mention key technologies** - Include SDK names, frameworks, or standards (e.g., "Anchor", "Token-2022", "SPL") that developers might reference.
> - **Keep it scannable** - The description should convey the skill's value in one or two sentences. Agents and users should understand at a glance when to use it.

```markdown
# Your Skill Name

Brief introduction to what this skill accomplishes.

## Overview

Explain the problem this skill solves and its value to developers.

## Instructions

Step-by-step instructions for the AI agent:

1. First, understand the user's specific requirements
2. Then, apply these specific patterns...
3. Finally, verify the output meets these criteria...

## Examples

### Example 1: Basic Usage

When a user asks: "Help me [specific task]"

The agent should:
1. Do this first
2. Then this
3. Produce this output

### Example 2: Advanced Usage

[More complex scenario with detailed response]

## Guidelines

- **DO**: Specific positive behaviors
- **DO**: Another best practice
- **DON'T**: Common mistake to avoid
- **DON'T**: Another anti-pattern

## Common Errors

### Error: [Specific Error Name]

**Cause**: Why this happens
**Solution**: How to fix it

## References

- [Relevant Documentation](https://example.com)
- [Related Resources](https://example.com)

## Notes

Any additional context, limitations, or edge cases.
```

### Step 4: Add Supporting Files (Optional)

```
your-skill-name/
├── SKILL.md          # Required
├── scripts/          # Optional: Helper scripts
│   └── helper.sh
├── resources/        # Optional: Templates, configs
│   └── template.json
└── examples/         # Optional: Example code
    └── example.ts
```

### Step 5: Test Your Skill

1. Load the skill in Claude Code
2. Test with various prompts
3. Verify edge cases are handled
4. Check that outputs are correct and secure

---

## Pull Request Process

### Before Submitting

- [ ] Skill follows the template structure
- [ ] Instructions are clear and unambiguous
- [ ] Examples cover common use cases
- [ ] Security best practices are followed
- [ ] Tested with Claude Code or compatible agent
- [ ] No duplicate functionality with existing skills

### Submitting Your PR

1. **Create a feature branch**

   ```bash
   git checkout -b feat/your-skill-name
   ```

2. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add your-skill-name skill"
   ```

   Use conventional commit messages:
   - `feat:` for new skills
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for restructuring

3. **Push to your fork**

   ```bash
   git push origin feat/your-skill-name
   ```

4. **Open a Pull Request**

   - Use a descriptive title
   - Fill out the PR template
   - Reference related issues
   - Add screenshots/examples if helpful

### Review Process

1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, your PR will be merged

---

## Style Guidelines

### SKILL.md Formatting

- Use clear, imperative language ("Do X" not "You should do X")
- Include practical, copy-paste ready examples
- Keep instructions specific and actionable
- Avoid ambiguity—AI agents need precise guidance

### Solana-Specific Guidelines

- Always recommend current best practices
- Include security considerations
- Reference official documentation
- Account for different Solana clusters (devnet/mainnet)

### Markdown Style

- Use ATX-style headers (`#`, `##`, `###`)
- Use fenced code blocks with language identifiers
- Keep lines under 100 characters when possible
- Use tables for structured data

---

## Code of Conduct

### Our Standards

- **Be respectful**: Treat all contributors with respect
- **Be inclusive**: Welcome developers of all skill levels
- **Be constructive**: Provide helpful, actionable feedback
- **Be patient**: Remember everyone is learning

### Unacceptable Behavior

- Harassment or discriminatory language
- Personal attacks or trolling
- Publishing private information
- Dismissive or unhelpful responses

### Enforcement

Violations may result in:
1. Warning from maintainers
2. Temporary ban from contributing
3. Permanent ban for repeated violations

---

## Questions and Support

### Getting Help

- **Issues**: Open a GitHub issue for bugs or proposals
- **Discussions**: Use GitHub Discussions for questions
- **Discord**: Join the SendAI community (if available)

### Useful Resources

- [Agent Skills Specification](https://agentskills.io)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Solana Documentation](https://solana.com/docs)
- [Anchor Documentation](https://www.anchor-lang.com/)

---

## Recognition

Contributors are recognized in:
- The README acknowledgments section
- Release notes for significant contributions
- GitHub contributors list

Thank you for helping make Solana development more accessible through AI-powered skills! 🚀
