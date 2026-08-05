# program-security-audit

> AI agent skill for comprehensive security audits of Solana programs (Anchor and native).

Part of the [Solana Skills Marketplace](https://github.com/sendaifun/skills).

## What This Skill Does

Gives any AI agent the knowledge to perform structured security audits of Solana programs, covering:

- **Threat modeling** — entry points, assets at risk, threat actors
- **Vulnerability detection** — 12 documented Solana-specific attack patterns
- **Signer verification** — authority checks, PDA signers, multisig patterns
- **Reentrancy prevention** — CPI safety, checks-effects-interactions
- **Integer safety** — overflow/underflow detection, safe math patterns
- **Access control** — role patterns, two-step transfers, PDA authorities
- **DeFi security** — oracle manipulation, slippage, flash loans, lending risks
- **Structured report output** — severity-rated findings with code fixes

## Usage

### Claude Code
```
/plugin install program-security-audit
```

Then just ask:
```
Audit this staking program for security issues.
Review my Anchor program for reentrancy vulnerabilities.
Threat model this lending protocol.
Is my signer verification correct?
Check my DeFi protocol for oracle manipulation risks.
```

### Any Agent
```bash
npx skills add sendaifun/skills --skill program-security-audit
```

## Skill Structure

```
program-security-audit/
├── SKILL.md                           # Entry point — agent loads this first
├── CLAUDE.md                          # Claude Code integration guide
├── resources/
│   ├── vulnerability-patterns.md     # 12 documented Solana vulnerabilities
│   └── solana-program-ids.md         # 30+ known program addresses for CPI validation
├── docs/
│   ├── signer-verification.md        # Authority check patterns
│   ├── reentrancy-prevention.md      # CPI safety and CEI pattern
│   ├── integer-overflow.md           # Safe math for Solana programs
│   ├── access-control.md             # Role-based access patterns
│   └── defi-specific.md              # Oracle, slippage, flash loan, lending patterns
└── examples/
    ├── audit-report-sample.md        # Sample structured audit report
    └── escrow-worked-example.md      # Full audit of a real escrow program (9 findings)
```

## Example Output

The skill produces structured audit reports with:
- Executive summary (finding counts by severity)
- Threat model (assets, entry points, threat actors)
- Per-finding detail: description, vulnerable code, impact, fix with code
- Prioritized remediation table

See [`examples/escrow-worked-example.md`](examples/escrow-worked-example.md) for a complete worked audit with 9 real findings including 2 critical vulnerabilities (fund theft vectors).

## Coverage

| Category | Patterns Covered |
|---|---|
| Account Validation | Ownership checks, type confusion, discriminators |
| Signer Verification | is_signer checks, has_one constraints, PDA signers |
| CPI Safety | Arbitrary CPI, stale data, reentrancy, CEI pattern |
| Integer Safety | Overflow, underflow, precision loss, u128 intermediates |
| Access Control | Single authority, two-step transfer, roles, emergency pause |
| State Management | Reinitialization, account revival, stale reads |
| DeFi / Oracles | Pyth/Switchboard integration, TWAP, slippage, flash loans |
| Lending | Health factor, liquidation incentives, LP token pricing |
| Staking / Farming | Flash staking prevention, TWAB, reward timing attacks |
| Program IDs | 30+ known program addresses for CPI target validation |

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](https://github.com/sendaifun/skills/blob/main/CONTRIBUTING.md).

## License

Apache 2.0
