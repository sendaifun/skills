# Solana Agent Kit Review Notes

Load this reference when the repository uses Solana Agent Kit, autonomous agents, MCP tools, LangChain tools, Vercel AI SDK tools, or any AI-controlled Solana action.

## Agent Initialization

- Identify where `SolanaAgentKit`, wallet adapters, RPC connections, tool registries, or MCP servers are initialized.
- Confirm target cluster is explicit and cannot silently fall back to devnet/mainnet in production.
- Check whether read-only tools and write tools are separated.
- Check whether public demo mode disables write actions by default.

## Wallet And Key Custody

- Private keys, seed phrases, and keypair JSON must not be committed, printed, or exposed to browser code.
- Server-side wallets must be loaded from secret storage, not `.env.example`, docs, frontend env vars, or sample configs.
- Custodial or delegated signing must be described in user-facing docs when relevant.
- Agent wallets should have scoped balances and recoverable rotation procedures before launch.

## Tool Allowlist And Human Gates

- List every enabled Solana action/tool and classify it as read-only, simulated, or write-capable.
- Write-capable actions should require explicit human confirmation before mainnet use.
- Dangerous actions such as transfers, swaps, staking, minting, burning, closing accounts, authority changes, and program upgrades should have separate gates.
- Autonomous loops must have spending, retry, rate, and timeout limits.
- Tool prompts should not let untrusted user text bypass write confirmation.

## Transaction And Runtime Safety

- Agent-created transactions should surface simulation logs and final instruction summaries before signing.
- Agents should use explicit compute budget, priority fee, retry, and blockhash expiry strategies for launch-critical flows.
- Failed actions should be logged with action name, signature if available, wallet prefix, cluster, sanitized error code, and timestamp.
- Write actions should be idempotent or have duplicate-submission protection.

## Launch Report Additions

When Solana Agent Kit is present, add a dedicated section to the report:

```markdown
## Solana Agent Kit Readiness

| Area | Status | Evidence | Fix |
| --- | --- | --- | --- |
| Tool allowlist |  |  |  |
| Mainnet write gates |  |  |  |
| Wallet/key custody |  |  |  |
| Autonomous limits |  |  |  |
| Action logging |  |  |  |
```
