---
name: insight-pre-trade-safety
description: Assess whether the price inputs of a proposed Solana or EVM onchain action are trustworthy before signing. Use Insight for oracle-manipulation-aware pre-trade checks, cross-source agreement, freshness, and a PASS/WARN/BLOCK verdict when a user asks to check a quoted price, inspect oracle integrity, or assess a proposed swap, borrow, lend, liquidation, or repayment.
---

# Insight Pre-Trade Safety

Use Insight before an Agent proposes an onchain action that relies on a price.
It returns decision-input risk evidence; it does not custody funds, sign,
submit transactions, choose a trade, or provide investment advice.

## Connect

Connect the remote MCP endpoint:

```json
{
  "mcpServers": {
    "insight": {
      "url": "https://www.oracleinsight.xyz/api/mcp"
    }
  }
}
```

First call only `initialize`, `notifications/initialized`, and `tools/list` to
confirm discovery. These calls are free and do not request a wallet signature,
payment, or transaction.

## Assess an action

1. Collect the proposed action's asset, chain, action type, token address when
   applicable, and USD notional. Do not ask the user for a private key or seed
   phrase.
2. Call Insight's pre-trade safety tool with those exact inputs.
3. Present the verdict, source agreement, freshness, max deviation, and reasons
   in the answer.
4. If the result is `BLOCK` or `DANGER`, stop. Do not refresh inputs, change
   the route, or invoke another tool to bypass the result.
5. If the result is `PASS` or `WARN`, state clearly that it is risk evidence,
   not authorization. The user must still review and approve any wallet action.

## Payments and privacy

Discovery is free. A metered assessment uses the Agent host's normal API-key or
x402 configuration; a payment for Insight never grants permission to execute
the assessed action. Keep credentials and wallet keys in the host's secret
manager, never in a prompt, repository, or Skill file.

For an exact Base Aave V3 direct-call decision and separate bounded
authorization/execution evidence, use the companion Insight and PriorSeal
integration. Do not claim that a generic swap, batch, smart account, or
UserOperation is covered by that narrow profile.
