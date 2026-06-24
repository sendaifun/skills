---
name: solana-launch-readiness
description: Review Solana applications before launch and produce an evidence-backed go/no-go report. Use when Codex or another AI coding agent needs a Solana-specific release gate for a dApp, wallet flow, token launch, program integration, demo URL, or repository before mainnet/public release, especially for wallet UX, RPC/network configuration, token metadata, transaction safety, Solana Agent Kit write-action gates, monitoring, support, incident response, and launch ownership.
---

# Solana Launch Gate

Use this skill as an evidence-backed launch gate for a Solana app or AI-agent workflow before public or mainnet launch. Focus on blockers and concrete next actions, not broad advice.

## Compatibility Contract

- Use progressive loading: start from this file, then load only the references needed for the review.
- Keep the review Solana-specific; do not turn it into a generic launch or startup checklist.
- Treat scripts as optional evidence helpers. The final severity still requires manual verification.
- Avoid live write actions by default. Do not sign, submit, simulate with private keys, mutate accounts, deploy, or run destructive commands unless the user explicitly authorizes that separate action.
- Produce a stable launch-owner report with `GO`, `GO WITH WARNINGS`, or `NO-GO UNTIL FIXED`.

## Workflow

1. Identify launch scope:
   - app or repo name
   - target network: devnet, testnet, mainnet-beta, localnet, or unknown
   - launch type: private beta, public beta, mainnet launch, token launch, campaign, or migration
   - expected users, wallets, tokens, programs, and critical flows
2. Inspect available artifacts:
   - repository files, docs, README, env examples, tests, CI, deployment config
   - frontend wallet flow, transaction creation, signing, confirmation, error states
   - API/RPC clients, rate limits, retries, fallbacks, and network selection
   - token metadata, mint/program IDs, explorer links, and verified addresses
   - monitoring, analytics, support, runbooks, changelogs, and status pages
3. Load references as needed:
   - Read `references/checklist.md` before scoring readiness.
   - Read `references/evidence.md` when collecting proof from a repo or live app.
   - Read `references/scoring-rubric.md` before assigning recommendation severity.
   - Read `references/use-cases.md` when classifying launch context or writing owner-facing summaries.
   - Read `references/solana-agent-kit.md` when the project uses Solana Agent Kit, MCP, LangChain/Vercel AI tools, autonomous Solana agents, or AI-controlled write actions.
   - Read `references/report-template.md` before writing the final report.
4. If this skill's scripts are available, run the lightweight scanner for first-pass evidence. In an installed skill, scripts live at `scripts/` beside this `SKILL.md`; in the source package, scripts live at the repository root `scripts/`.

   ```bash
   python3 scripts/scan_repo.py <repo-path> --pretty
   ```

   Treat scanner results as signals, not final findings. Verify impact manually. The scanner applies best-effort redaction and skips private `.env*` files unless explicitly asked with `--include-private-env`; avoid scanning private env files unless necessary.
5. For transaction-heavy apps, run the offline transaction pattern scanner:

   ```bash
   python3 scripts/tx_pattern_scan.py <repo-path> --pretty
   ```

   Use missing or risky transaction patterns to guide manual review of blockhash expiry, retries, priority fees, compute budget, versioned transactions, ALTs, preflight, and confirmation behavior.
6. When the team provides public launch addresses and explicitly allows network access, optionally run the read-only RPC probe:

   ```bash
   node scripts/rpc_readiness_probe.mjs launch-config.json --timeout-ms 8000
   ```

   This only calls JSON-RPC read methods such as `getSlot`, `getLatestBlockhash`, and `getAccountInfo`; it does not sign or submit transactions.
7. Produce a report that separates:
   - launch blockers
   - warnings
   - nice-to-haves
   - validated strengths
   - unknowns requiring owner confirmation
8. Recommend one of:
   - `GO`
   - `GO WITH WARNINGS`
   - `NO-GO UNTIL FIXED`

## Review Rules

- Prefer concrete file paths, commands, screenshots, logs, URLs, or code references over generic observations.
- Do not claim a smart contract is secure unless a real audit or formal analysis was performed.
- Do not perform live transactions, wallet signatures, mainnet testing, or destructive actions unless the user explicitly authorizes them.
- Treat private keys, seed phrases, RPC keys, wallet addresses tied to private identity, KYC data, and payment details as sensitive.
- Never print secret values from environment files, CI logs, launch configs, or scanner output. Redact values and cite only variable names, file paths, and line numbers.
- If source code is unavailable, say so and produce an external-readiness review from visible docs and UI only.
- If the app uses a non-Solana chain in addition to Solana, keep the Solana findings separate.
- If a launch area cannot be verified, list it under unknowns instead of guessing.
- If using `scripts/scan_repo.py`, include a short scanner summary and note which signals were manually verified.
- If using `scripts/tx_pattern_scan.py` or `scripts/rpc_readiness_probe.mjs`, include the generated evidence under scanner/tooling summary and keep unverifiable chain authority or metadata questions under unknowns.

## Output Standard

Every final report must include:

- scope and evidence sources
- scanner summary when applicable
- category scorecard
- one-line launch recommendation
- launch blockers table
- warnings table
- verified strengths
- critical unknowns
- prioritized next actions
- owner-facing summary

Use concise, engineering-friendly language. Include enough detail for the team to fix issues without re-running the whole review.
