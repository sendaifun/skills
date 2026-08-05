---
name: program-security-audit
description: Security audit skill for Solana programs. Use when reviewing Anchor or native Solana programs for vulnerabilities, performing threat modeling, checking signer verification, detecting reentrancy risks, validating safe math usage, auditing access control patterns, or generating a structured security report. Triggers on: "audit this program", "review for security issues", "check for vulnerabilities", "is this safe to deploy", "threat model", "security review".
---

# Solana Program Security Audit

A comprehensive security audit skill for Anchor and native Solana programs. Covers the full audit lifecycle: threat modeling → vulnerability detection → findings report.

## Overview

Solana programs have a unique security model distinct from EVM. Common EVM patterns (reentrancy guards, msg.sender checks) do not map 1:1. This skill teaches the AI agent the Solana-specific attack surface so it can audit programs accurately.

**When to load sub-skills:**
- Signer and authority checks → read `docs/signer-verification.md`
- Reentrancy and CPI risks → read `docs/reentrancy-prevention.md`
- Integer math safety → read `docs/integer-overflow.md`
- Role-based access patterns → read `docs/access-control.md`
- Common vulnerability reference → read `resources/vulnerability-patterns.md`
- Validating CPI target program IDs → read `resources/solana-program-ids.md`
- DeFi protocols (oracles, slippage, flash loans, lending) → read `docs/defi-specific.md`
- See a complete end-to-end audit → read `examples/escrow-worked-example.md`

## Instructions

When the user asks for a security review, audit, or vulnerability check:

1. **Identify the program type** — Anchor (has `#[program]` macro and `Context<>` structs) or native (uses `entrypoint!`, raw `AccountInfo`). The audit approach differs.

2. **Run the full checklist** from `resources/vulnerability-patterns.md` systematically. Do not skip categories even if the program looks simple.

3. **For each finding**, assign:
   - **Severity**: Critical / High / Medium / Low / Informational
   - **Location**: file name + line number or instruction name
   - **Impact**: what an attacker can do
   - **Recommendation**: specific fix with code snippet

4. **Output a structured report** using the template in `examples/audit-report-sample.md`.

5. **Never assume safety** — if an account constraint is missing, flag it even if exploitation seems unlikely in context.

## Quick Audit Checklist

Run these checks on every program, in order:

### 1. Account Validation
- [ ] Every writable account has ownership check (`account.owner == program_id`)
- [ ] PDA accounts validated with correct seeds and bump
- [ ] No accounts accepted without type constraints (Anchor: use `Account<>` not `AccountInfo` unless intentional)
- [ ] Sysvar accounts use `Sysvar::get()` or hardcoded pubkeys, not user-supplied

### 2. Signer Verification
- [ ] All privileged operations require a signer
- [ ] Signer is checked against an expected authority (not just "is someone signing")
- [ ] No instruction accepts `is_signer = false` for admin operations
- [ ] See `docs/signer-verification.md` for patterns

### 3. Cross-Program Invocations (CPI)
- [ ] CPI target program ID is validated (not user-supplied)
- [ ] Accounts passed to CPI are the expected accounts
- [ ] After CPI, re-load account data if it may have changed
- [ ] See `docs/reentrancy-prevention.md` for patterns

### 4. Integer Arithmetic
- [ ] All arithmetic uses `checked_add`, `checked_sub`, `checked_mul`, or `saturating_*`
- [ ] No raw `+`, `-`, `*` on u64/i64 in release builds without overflow check
- [ ] Division by zero is guarded
- [ ] See `docs/integer-overflow.md` for patterns

### 5. Access Control
- [ ] Admin/authority pubkeys stored in program state, not hardcoded
- [ ] Authority transfer follows a two-step (propose + accept) pattern for critical roles
- [ ] No function is callable by arbitrary signers
- [ ] See `docs/access-control.md` for patterns

### 6. State Management
- [ ] Accounts are initialized exactly once (use `init` not `init_if_needed` unless intentional)
- [ ] Closed accounts use the `close` constraint or zero out discriminator
- [ ] No stale account data used after a CPI that could have mutated it

### 7. Program Logic
- [ ] Business logic edge cases: zero amounts, max values, empty arrays
- [ ] Slippage and price manipulation risks in DeFi instructions
- [ ] Deadline/expiry checks present where applicable
- [ ] Events emitted for all state-changing instructions (aids monitoring)

## Examples

### Basic Usage

**User says:** "Review this staking program for security issues"

**Agent should:**
1. Read the provided code
2. Load `resources/vulnerability-patterns.md`
3. Run the full checklist above
4. For each failed check, create a finding
5. Output the structured report from `examples/audit-report-sample.md`

### Targeted Review

**User says:** "Check if my PDA derivation is safe"

**Agent should:**
1. Load `docs/signer-verification.md` for PDA patterns
2. Check seeds, bump storage, and canonical bump usage
3. Report specific issues with line references

### Threat Model Request

**User says:** "Threat model my lending protocol before audit"

**Agent should:**
1. Identify all entry points (instructions)
2. Identify all assets at risk (SOL, SPL tokens, PDAs)
3. For each entry point: who can call it, what can go wrong, what's the impact
4. Output a threat matrix (see `examples/audit-report-sample.md` for format)

## Guidelines

- **DO**: Flag missing constraints even if they seem low-risk — the developer decides risk tolerance, not the auditor
- **DO**: Provide a code fix for every finding, not just a description
- **DO**: Distinguish between Anchor-enforced safety (e.g., discriminator checks) and manually required checks
- **DON'T**: Assume `#[derive(Accounts)]` constraints are sufficient without reading them carefully
- **DON'T**: Skip the logic review — most critical bugs are in business logic, not low-level Solana patterns
- **DON'T**: Report findings without severity — every finding needs a severity rating

## Common Errors

### Error: "Missing signer check"
**Cause**: Instruction modifies state but any account can be passed as authority
**Solution**: Add `#[account(signer)]` constraint or `require!(authority.is_signer, ErrorCode::Unauthorized)`

### Error: "Unchecked arithmetic"
**Cause**: Direct `+` or `-` on numeric types without overflow protection
**Solution**: Replace with `.checked_add(n).ok_or(ErrorCode::Overflow)?`

### Error: "CPI with unvalidated program"
**Cause**: Program ID for CPI target comes from user-supplied account
**Solution**: Hardcode or validate: `require!(target_program.key() == EXPECTED_PROGRAM_ID, ErrorCode::InvalidProgram)`

## References

- [Anchor Security Best Practices](https://www.anchor-lang.com/docs/security)
- [Solana Program Security — Neodyme](https://blog.neodyme.io/posts/solana_common_pitfalls/)
- [sec3 Vulnerability Database](https://www.sec3.dev/blog)
- [Coral Anchor Source](https://github.com/coral-xyz/anchor)
- [Solana Cookbook — Security](https://solanacookbook.com/references/programs.html)
