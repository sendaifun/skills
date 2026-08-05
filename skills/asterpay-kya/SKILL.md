---
name: asterpay-kya
creator: AsterPay
description: AsterPay KYA (Know Your Agent) trust scoring and EUR settlement for AI agents. Score any wallet 0-100 with Chainalysis sanctions screening, verify ERC-8004 identities, and settle USDC/EURC to EUR via SEPA Instant. x402-native, MiCA-compliant. Use when checking agent trust, screening counterparties, verifying agent identity, settling stablecoins to EUR, or integrating agent compliance into Solana applications.
---

# AsterPay KYA — Agent Trust Score & EUR Settlement

AsterPay is the trust and settlement layer for AI agent commerce. It provides two core capabilities for agents operating across Solana and EVM chains:

1. **KYA Trust Score** — Score any wallet 0-100 based on 7 on-chain signals + Chainalysis sanctions screening + InsumerAPI attestations. Free API, no key needed.
2. **EUR Settlement** — Convert USDC/EURC/EURCV to EUR via SEPA Instant (<10 seconds). x402-native, MiCA-compliant.

AsterPay is listed on the [x402 Foundation ecosystem](https://x402.org/ecosystem), is a Circle Alliance member, and operates ERC-8004 Agent #16850.

## Quick Start

### Base URL

```
https://x402.asterpay.io
```

### Check Agent Trust Score (Free — No Auth)

```bash
curl https://x402.asterpay.io/v1/agent/trust-score/0x742d35Cc6634C0532925a3b844Bc454e4438f44e
```

Response:

```json
{
  "success": true,
  "data": {
    "address": "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    "score": 65,
    "tier": "trusted",
    "maxPerTx": 10000,
    "blocked": false,
    "components": {
      "walletAge": 12,
      "walletActivity": 10,
      "sanctionsClean": 20,
      "erc8004Identity": 15,
      "operatorKyb": 0,
      "transactionHistory": 5,
      "trustBond": 3
    },
    "sanctions": {
      "clean": true,
      "provider": "chainalysis",
      "checkedAt": "2026-03-13T12:00:00.000Z"
    },
    "identity": {
      "erc8004Registered": true,
      "agentId": "#16850",
      "registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    }
  }
}
```

### Get Settlement Estimate (Free)

```bash
curl "https://x402.asterpay.io/v1/settlement/estimate?amount=100.0&currency=USDC"
```

## API Endpoints

### Free Endpoints (No Payment Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agent/trust-score/:address` | GET | Full trust assessment (score, tier, sanctions, identity) |
| `/v1/agent/verify/:address` | GET | ERC-8004 identity verification only |
| `/v1/agent/tier/:address` | GET | Fast tier + transaction limits lookup |
| `/v1/agent/trust-score/batch` | POST | Batch trust scoring (up to 50 addresses) |
| `/v1/agent/framework` | GET | Full KYA framework specification |
| `/v1/settlement/estimate` | GET | EUR settlement estimate with fees and rate |

### Paid Endpoints (x402 — Agent Pays USDC)

| Endpoint | Cost | Description |
|----------|------|-------------|
| `/v1/agent/deep-analysis/:address` | $0.01 | Full behavioral intelligence report |
| `/v1/agent/deep-analysis/batch` | $0.05 | Batch deep analysis (up to 10 addresses) |
| `/v1/market/price/:symbol` | $0.005 | Real-time crypto price data |

### x402 Facilitator Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v2/x402/verify` | POST | Verify payment payload before settlement |
| `/v2/x402/settle` | POST | Submit verified payment for on-chain settlement + EUR off-ramp |
| `/v2/x402/supported` | GET | Supported payment schemes, networks, assets |

## Trust Score Components

| Component | Max Points | What It Measures |
|-----------|-----------|------------------|
| walletAge | 15 | Days since first transaction |
| walletActivity | 15 | Transaction count and activity patterns |
| sanctionsClean | 20 | Chainalysis OFAC/EU/UN screening (binary) |
| erc8004Identity | 20 | ERC-8004 agent registry verification |
| operatorKyb | 20 | Operator KYB (Know Your Business) status |
| transactionHistory | 5 | Payment history with AsterPay |
| trustBond | 5 | USDC staked as trust bond |

## Trust Tiers

| Tier | Score Range | Max Per TX | Max Daily | Requirements |
|------|-------------|-----------|-----------|--------------|
| Open | 0–19 | $1 | $10 | Wallet + sanctions pass |
| Verified | 20–49 | $1,000 | $5,000 | ERC-8004 identity + wallet history |
| Trusted | 50–79 | $10,000 | $50,000 | Operator KYB + Travel Rule |
| Enterprise | 80–100 | Unlimited | Unlimited | Full KYB + trust bond + SLA |

## EAS On-Chain Attestation (Base Mainnet)

KYA Trust Scores are attested on-chain via Ethereum Attestation Service (EAS) on Base:

- **Schema UID**: `0x34d8d84158b4d965687d5a4585b2e437f381371fa935c225e8a128ca57c675ca`
- **12 fields**, gas-optimized (all `uint8`/`bool`/`uint256`, no strings)
- **Cost**: <$0.01 per attestation
- Any smart contract can read an agent's trust profile directly from the chain

[View on EASScan →](https://base.easscan.org/schema/view/0x34d8d84158b4d965687d5a4585b2e437f381371fa935c225e8a128ca57c675ca)

## Implementation Patterns

### Pattern 1: Pre-Transaction Trust Gate

```typescript
const BASE = "https://x402.asterpay.io";

async function canTransact(address: string, amountUsd: number): Promise<boolean> {
  const res = await fetch(`${BASE}/v1/agent/tier/${address}`);
  const { data } = await res.json();

  if (data.blocked) return false;
  if (amountUsd > data.maxPerTx) return false;

  return true;
}
```

### Pattern 2: Counterparty Screening

```typescript
async function screenCounterparty(address: string) {
  const res = await fetch(`${BASE}/v1/agent/trust-score/${address}`);
  const { data } = await res.json();

  return {
    safe: !data.blocked && data.sanctions.clean,
    tier: data.tier,
    score: data.score,
    hasIdentity: data.identity.erc8004Registered,
    recommendation: data.score >= 50
      ? "proceed"
      : data.score >= 20
      ? "proceed with limits"
      : "require additional verification",
  };
}
```

### Pattern 3: Check Trust → Estimate → Settle

```typescript
const BASE = "https://x402.asterpay.io";

// 1. Check trust
const { data: trust } = await fetch(`${BASE}/v1/agent/trust-score/${agentAddress}`).then(r => r.json());
if (trust.blocked) throw new Error("Agent blocked: sanctions or compliance issue");

// 2. Estimate EUR settlement
const { data: estimate } = await fetch(`${BASE}/v1/settlement/estimate?amount=${usdcAmount}`).then(r => r.json());
console.log(`${usdcAmount} USDC → ${estimate.netEurAmount} EUR (fee: ${estimate.asterpayFeeEur} EUR)`);

// 3. Settle via x402 facilitator (agent pays USDC automatically via HTTP 402)
```

### Pattern 4: Batch Screening for Multi-Agent Systems

```typescript
async function screenAgentPool(addresses: string[]) {
  const res = await fetch(`${BASE}/v1/agent/trust-score/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses: addresses.slice(0, 50) }),
  });
  const { data } = await res.json();

  const blocked = data.filter((a: any) => a.blocked);
  const trusted = data.filter((a: any) => a.score >= 50);

  return { total: data.length, blocked: blocked.length, trusted: trusted.length, results: data };
}
```

### Pattern 5: x402 Payment Flow

```typescript
import { createX402Fetch } from "x402-fetch";

const x402Fetch = createX402Fetch(walletPrivateKey);

// Paid endpoints automatically handle 402 payment
const res = await x402Fetch("https://x402.asterpay.io/v1/agent/deep-analysis/0x...");
const data = await res.json();
```

## Supported Chains and Assets

| Chain | Chain ID | USDC Contract |
|-------|----------|---------------|
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Polygon | 137 | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| Ethereum | 1 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad request | Check parameters |
| 402 | Payment required | Sign and attach x402 payment |
| 429 | Rate limited | Back off and retry |
| 500 | Server error | Retry with exponential backoff |

### Common Errors

- **`blocked: true`** — Sanctioned wallet. Do NOT transact. This is a compliance block.
- **`simulated: true`** — Expected for settlement estimates. Actual settlement via facilitator.
- **Invalid Ethereum address** — Must be valid checksummed or lowercased 0x-prefixed address.

## Security Rules

- NEVER trust a wallet with `blocked: true`
- NEVER skip sanctions screening before transacting with unknown agents
- ALWAYS validate address format before API calls
- NEVER hardcode wallet private keys — use environment variables
- NEVER auto-settle to EUR without explicit confirmation of amount and destination
- ALWAYS verify exchange rate in settlement estimate before proceeding

## Best Practices

- Cache trust scores for 5 minutes
- Default to Base network (chain ID 8453) for lowest fees
- Use `/v1/agent/tier/:address` for fast lookups when you only need tier and limits
- Use batch endpoints when screening 3+ addresses
- For high-value interactions (>$1,000), invest in deep analysis ($0.01 via x402)
- Register an ERC-8004 agent identity to unlock higher trust tiers

## Reference Links

- [AsterPay Website](https://asterpay.io)
- [AsterPay API](https://x402.asterpay.io)
- [AsterPay Skills](https://github.com/AsterPay/asterpay-skills)
- [x402 Protocol](https://www.x402.org)
- [ERC-8004 Agent Identity](https://eips.ethereum.org/EIPS/eip-8004)
- [EAS Schema on Base](https://base.easscan.org/schema/view/0x34d8d84158b4d965687d5a4585b2e437f381371fa935c225e8a128ca57c675ca)
- [Google A2A Protocol](https://github.com/a2aproject/A2A)
