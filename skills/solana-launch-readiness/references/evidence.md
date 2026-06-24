# Evidence Collection Guide

Collect evidence before assigning severity. Prefer reproducible proof.

## Repository Evidence

Use fast local search first:

```bash
rg -n "mainnet|devnet|testnet|localnet|cluster|RPC|HELIUS|QUICKNODE|TRITON|ANCHOR|PROGRAM_ID|MINT|wallet|signTransaction|sendTransaction|confirmTransaction|skipPreflight|commitment|slippage|retry|timeout|webhook|status" .
rg --files | rg 'README|CHANGELOG|docs|\\.env|env.example|package.json|Anchor.toml|Cargo.toml|next.config|vite.config|vercel|docker|ci|workflow'
```

Use bundled offline scripts when available:

```bash
python3 scripts/scan_repo.py <repo-path> --pretty
python3 scripts/tx_pattern_scan.py <repo-path> --pretty
```

Look for:

- committed secrets or production RPC keys
- missing env examples
- hard-coded devnet/mainnet values
- stale program IDs or mint addresses
- disabled preflight or unclear commitment settings
- missing transaction confirmation handling
- absent tests for critical launch flows
- missing latest blockhash, lastValidBlockHeight, priority fee, compute budget, retry, and preflight intent
- missing ATA/rent UX for token flows
- Solana Agent Kit, MCP, LangChain, Vercel AI SDK, or autonomous tool registrations that can perform write actions

## Read-Only Chain And RPC Evidence

Only run network probes when the user provides public addresses and allows network access. Use read-only RPC calls:

```bash
node scripts/rpc_readiness_probe.mjs launch-config.json --timeout-ms 8000
```

Check:

- RPC endpoint health, latency, latest slot, and latest blockhash
- program account existence, executable flag, owner, and lamports
- mint account existence and owner
- explorer links match the target cluster and public docs
- authority status is documented: upgrade, freeze, mint, governance, or multisig

Keep authority and metadata questions under unknowns if the probe cannot verify them.

## Solana Agent Kit Evidence

If Solana Agent Kit or AI-controlled tools are present, also search:

```bash
rg -n "SolanaAgentKit|createSolanaTools|Keypair|fromSecretKey|MCP|tool\\(|generateText|streamText|LangChain|transfer|swap|stake|mint|burn|closeAccount|setAuthority" .
```

Check:

- wallet/private-key custody and whether keys can reach browser code
- read-only vs write-capable tool separation
- explicit human confirmation gates for mainnet write actions
- autonomous spending, retry, timeout, and rate limits
- action logs for signature, cluster, wallet prefix, tool name, sanitized error code, and timestamp

## Live App Evidence

If browser access is safe and allowed:

- capture URL, timestamp, network, wallet state, and browser console errors
- inspect visible network labels and explorer links
- test read-only navigation before any wallet action
- do not sign, connect a real wallet, or submit transactions without explicit approval
- record exact user-facing error text

## Documentation Evidence

Check:

- setup instructions
- target network and env variables
- launch addresses and explorer links
- support path and incident contact
- troubleshooting and known limitations
- warnings for financial, trading, or token-risk behavior
- launch config or runbook with owners, target cluster, release commit, RPC providers, pause/rollback commands, support channel, program IDs, and mint IDs

## Severity Guide

`blocker`:

- likely causes failed launch, user fund risk, broken onboarding, wrong network use, exposed secrets, or unrecoverable critical flow failure

`warning`:

- materially hurts reliability, support load, trust, or conversion but has a workaround

`nice-to-have`:

- improves quality or polish but should not block launch

`unknown`:

- cannot be verified from available artifacts and needs owner confirmation
