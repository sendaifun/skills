---
name: sealguard
description: Check a Solana transaction with SealGuard before signing it, and check Solana wallets for risky token approvals, phishing airdrops and SOL locked in empty accounts. Use before an agent signs any transaction, or when a user asks whether a wallet is safe.
---

# SealGuard: check before signing

SealGuard is a read-only Solana wallet check-up with a remote MCP server at `https://guard.2cstudio.app/mcp` (Streamable HTTP, JSON-RPC). It never signs or sends anything.

## Overview

Most Solana thefts are one signature on a bad transaction. `check_transaction` simulates a transaction on mainnet before it's signed and compares the signer's accounts before and after. It reports:

- the wallet account handed to another program (the wallet is lost)
- a token account given a new owner, a standing approval (delegate) left on tokens, a new close authority
- stake or nonce authorities moved to another address
- SOL and token amounts leaving and arriving, and a warning when things leave and nothing comes back
- a durable nonce (a signed transaction that stays valid long after signing) and programs SealGuard doesn't know

The answer starts with a verdict: `do_not_sign`, `review` or `no_red_flags`.

Free tools, no key: `scan_wallet` (0-100 safety score and findings), `list_token_approvals`, `list_empty_token_accounts`. `check_transaction` needs an API key: US$0.01 a check, bought at https://guard.2cstudio.app/mcp-key (wallets with the SealGuard guard get 1,000 a month included). A check is charged only when SealGuard returns an answer.

## Instructions

1. Build the transaction as usual, but don't sign it yet.
2. Serialize it to base64. Unsigned is fine.
   - `VersionedTransaction`: `Buffer.from(tx.serialize()).toString("base64")`
   - legacy `Transaction`: `tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")`
3. Call `check_transaction` with `transaction` (and `signer` if the signing wallet isn't the fee payer).
4. Act on the verdict:
   - `do_not_sign`: don't sign. Tell the user what it would hand over (`risks[0]`).
   - `review`: show the user the risks and `balance_changes`, and sign only if they confirm this is what they meant.
   - `no_red_flags`: go ahead; mention the balance changes if useful.
5. Sign and send promptly: the check reflects the chain at that moment.

## Examples

### MCP client config (Cursor, VS Code, Claude Code)

```json
{ "mcpServers": { "sealguard": { "url": "https://guard.2cstudio.app/mcp", "headers": { "Authorization": "Bearer sgk_..." } } } }
```

### Direct HTTP call (no MCP client)

```bash
curl -s https://guard.2cstudio.app/mcp \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $SEALGUARD_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_transaction","arguments":{"transaction":"<base64>"}}}'
```

The result is in `result.structuredContent`:

```json
{
  "verdict": "do_not_sign",
  "summary": "Don't sign this: it would give someone else control of this wallet's assets.",
  "risks": [{ "severity": "critical", "title": "Leaves an approval on your USDC", "detail": "..." }],
  "balance_changes": { "sol": -0.000005, "tokens": [] },
  "programs": [{ "id": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "name": "SPL Token" }],
  "simulated": true,
  "billing": { "charged_checks": 1, "from": "prepaid checks", "checks_left": 499 }
}
```

### When the user asks "is my wallet safe?"

Call `scan_wallet` with the address (free, no key) and explain the findings in plain words. Fixes happen on the link in the result, where the owner signs each one.

## Guidelines

- **DO** check every transaction from a site, bot or prompt you didn't build yourself.
- **DO** treat `do_not_sign` as final unless a human explicitly overrides it.
- **DON'T** paste seed phrases or private keys anywhere; SealGuard never asks for them.
- **DON'T** read `no_red_flags` as a price check: SealGuard looks at what the transaction does to the signer's accounts, not whether a swap rate is fair.

## Common Errors

### Error: "check_transaction needs a SealGuard API key"
**Cause**: no `Authorization: Bearer sgk_...` header.
**Solution**: get a key at https://guard.2cstudio.app/mcp-key and send it with every request.

### Error: "This key has no checks left"
**Solution**: top up at https://guard.2cstudio.app/mcp-key.

### Error: "couldn't simulate this transaction"
**Cause**: RPC trouble or an expired blockhash. No check is charged.
**Solution**: rebuild with a fresh blockhash and try again.
