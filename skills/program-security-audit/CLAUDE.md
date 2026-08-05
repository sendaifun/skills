# CLAUDE.md — program-security-audit

This file tells Claude Code how to work with this skill.

## Installation

```bash
# Via Claude Code plugin marketplace
/plugin install program-security-audit

# Via npx (any agent)
npx skills add sendaifun/skills --skill program-security-audit
```

## What This Skill Enables

Once installed, Claude Code can perform comprehensive security audits of Solana programs. Just describe what you want:

```
Audit this Anchor program for vulnerabilities.
Review my staking contract before mainnet deploy.
Threat model this lending protocol.
Check if my signer verification is correct.
Is my PDA derivation safe?
Find integer overflow risks in this program.
```

## How the Skill Is Structured

Claude loads `SKILL.md` first, then reads sub-documents only when relevant:

| File | Loaded When |
|---|---|
| `SKILL.md` | Always — entry point |
| `resources/vulnerability-patterns.md` | Full audit requested |
| `resources/solana-program-ids.md` | CPI target validation needed |
| `docs/signer-verification.md` | Signer/authority review |
| `docs/reentrancy-prevention.md` | CPI safety review |
| `docs/integer-overflow.md` | Math safety review |
| `docs/access-control.md` | Role/permission review |
| `docs/defi-specific.md` | DeFi protocol audit |
| `examples/escrow-worked-example.md` | Reference for report format |

## Output Format

The skill produces structured audit reports with:

- Executive summary table (findings by severity)
- Threat model (assets, entry points, threat actors)
- Per-finding detail: location, description, vulnerable code, impact, fix
- Prioritized remediation table

## Supported Program Types

- Anchor programs (`#[program]` macro)
- Native Solana programs (`entrypoint!` macro)
- Programs using SPL Token and Token-2022
- DeFi protocols (AMMs, lending, staking, farming)

## Tips for Best Results

Provide as much context as possible:
```
# Good prompt
"Audit this Anchor staking program. It accepts SOL deposits, 
issues receipt tokens, and distributes rewards based on time staked. 
Here's the source: [paste code]"

# Better prompt  
"Perform a full security audit of this lending protocol. 
Focus especially on oracle price manipulation and liquidation logic. 
Here's lib.rs: [paste] and state.rs: [paste]"
```

## Contributing

Found a missing vulnerability pattern or want to add a new sub-skill? See [CONTRIBUTING.md](https://github.com/sendaifun/skills/blob/main/CONTRIBUTING.md).
