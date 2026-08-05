# Launch Readiness Scoring Rubric

Use this rubric after collecting evidence. Scores are not a substitute for judgment; they make the final recommendation consistent.

## Category Scores

Score each category from 0 to 3.

| Score | Meaning |
| --- | --- |
| 0 | Not present or cannot be verified |
| 1 | Present but risky, incomplete, stale, or unclear |
| 2 | Mostly ready with minor gaps |
| 3 | Launch-ready and evidence-backed |

## Categories

| Category | What To Check |
| --- | --- |
| Wallet UX | connect, network mismatch, rejected signatures, pending/failed/confirmed states |
| Network/RPC | target cluster, RPC config, fallbacks, timeouts, rate limits, secret handling |
| Addresses/Metadata | program IDs, mints, token metadata, explorer links, authority disclosures |
| Transaction Reliability | simulation, preflight, ordering, retries, idempotency, confirmation, recovery |
| Docs/DX | README, env examples, setup, launch addresses, troubleshooting, known limits |
| Observability/Ops | logs, analytics, transaction failure triage, support channel, incident runbook |
| Release Control | CI, deploy commands, release tag, rollback/pause path, owner assignments |

## Recommendation Mapping

Use the lowest category scores and blockers to choose:

- `GO`: no blockers, no category below 2, and launch owners assigned.
- `GO WITH WARNINGS`: no blockers, at most two categories score 1, and the remaining risks have owners.
- `NO-GO UNTIL FIXED`: any blocker exists, any fund/user-trust critical flow is unverified, secrets are exposed, network config is contradictory, public addresses cannot be verified for the claimed network, or three or more categories score 1 or lower.

## Severity Escalation

Escalate to `blocker` when a finding can plausibly cause:

- users to sign on the wrong network
- loss of funds or unrecoverable transaction state
- public launch with wrong program/mint addresses
- mainnet or public beta launch without verified program/mint chain-state evidence
- token/NFT launch without relevant mint, freeze, upgrade, or governance authority disclosure
- exposed private keys, seed phrases, RPC keys, or privileged credentials
- a core user flow that cannot recover from normal wallet/RPC failure
- no way for the team to triage failed transactions during launch

Keep as `warning` when there is a workaround and no immediate fund/user-trust risk.

Keep as `nice-to-have` when the issue improves quality but should not affect launch safety or reliability.
