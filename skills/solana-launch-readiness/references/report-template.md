# Launch Readiness Report Template

Use this structure for the final report.

```markdown
# Solana Launch Readiness Report

## Scope

- App / repo:
- Launch type:
- Target network:
- Review date:
- Evidence sources:

## Scanner Summary

Include only when `scripts/scan_repo.py` or another automated pass was used. Summarize files scanned, finding counts, manually verified signals, and false positives.

## Category Scorecard

| Category | Score 0-3 | Rationale |
| --- | ---: | --- |
| Wallet UX |  |  |
| Network/RPC |  |  |
| Addresses/Metadata |  |  |
| Transaction Reliability |  |  |
| Docs/DX |  |  |
| Observability/Ops |  |  |
| Release Control |  |  |

## Recommendation

`GO`, `GO WITH WARNINGS`, or `NO-GO UNTIL FIXED`

One-sentence reason:

## Launch Blockers

| ID | Area | Finding | Evidence | Impact | Fix |
| --- | --- | --- | --- | --- | --- |
| B1 |  |  |  |  |  |

## Warnings

| ID | Area | Finding | Evidence | Impact | Fix |
| --- | --- | --- | --- | --- | --- |
| W1 |  |  |  |  |  |

## Nice-To-Haves

| ID | Area | Improvement | Why It Helps |
| --- | --- | --- | --- |
| N1 |  |  |  |

## Verified Strengths

- 

## Solana Agent Kit Readiness

Include only when the project uses Solana Agent Kit, MCP, LangChain/Vercel AI tools, or autonomous write actions.

| Area | Status | Evidence | Fix |
| --- | --- | --- | --- |
| Tool allowlist |  |  |  |
| Mainnet write gates |  |  |  |
| Wallet/key custody |  |  |  |
| Autonomous limits |  |  |  |
| Action logging |  |  |  |

## Critical Unknowns

- 

## Prioritized Next Actions

1. 
2. 
3. 

## Owner-Facing Summary

Write 3-6 concise sentences that a founder or launch owner can act on immediately.
```
