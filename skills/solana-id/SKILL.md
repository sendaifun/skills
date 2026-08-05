---
name: solana-id
description: |
  Integrate the Solana ID SOLID Score API to look up wallet reputation scores, badges, and tiers on Solana.
  Use when building: wallet analytics, user segmentation, targeted marketing, perk/reward systems,
  airdrop eligibility, or any feature that needs to assess wallet quality and on-chain activity.
  Covers: SOLID Score lookup, tier classification, badge system, and Perk Frame (SDN widget) integration.
---

# Solana ID — Wallet Reputation & Targeting on Solana

Solana ID is a blockchain-based marketing platform. It scores wallets based on on-chain activity (the SOLID Score), assigns badges and tiers, and lets businesses target qualified wallet holders with perks.

**What the API gives you:** For any Solana wallet address, get a reputation score (0–1000), tier (1–4), badges (14 possible), and detailed data points across 6 activity categories.

## Quick Start

### 1. Get an API Key

Sign up at [portal.solana.id](https://portal.solana.id), go to **API Management**, and generate a key. Free tier: 5,000 requests.

### 2. Environment Setup

```bash
export SOLANA_ID_API_KEY="your-api-key-here"
```

### 3. First Request

```bash
curl "https://backend.app.solana.id/api/solid-score/address/{walletAddress}" \
  -H "x-api-key: $SOLANA_ID_API_KEY"
```

### 4. Response

```json
{
  "solidUser": {
    "solidScore": 750,
    "badges": ["WHALE", "DEFI_MAXI", "NFT_COLLECTOR"],
    "tierGroup": "tier_1",
    "dataPoints": {
      "totalScore": 750,
      "solBalanceScore": 85,
      "splTokenScore": 72,
      "nftScore": 60,
      "defiScore": 90,
      "governanceScore": 45,
      "stakingScore": 68
    },
    "isSolanaIdUser": true
  },
  "status": "up_to_date"
}
```

If `solidUser` is `null` and `status` is `"calculating"`, the score is being computed — retry after 30 seconds.

---

## API Reference

### Base URL

```
https://backend.app.solana.id/api
```

### Authentication

All requests require the `x-api-key` header:

```typescript
const headers = {
  'x-api-key': process.env.SOLANA_ID_API_KEY,
};
```

### GET /solid-score/address/{solanaAddress}

Look up the SOLID Score for any Solana wallet.

**Parameters:**

| Parameter | Type | Location | Description |
|-----------|------|----------|-------------|
| `solanaAddress` | string | path | Valid Solana wallet address (base58) |

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `solidUser.solidScore` | number | Overall score (0–1000) |
| `solidUser.tierGroup` | string | `tier_1`, `tier_2`, `tier_3`, or `tier_4` |
| `solidUser.badges` | string[] | Array of earned badge names (uppercase) |
| `solidUser.dataPoints` | object | Per-category score breakdown |
| `solidUser.isSolanaIdUser` | boolean | Whether the wallet has minted a Solana ID |
| `status` | string | `up_to_date`, `outdated`, or `calculating` |

**Status values:**
- `up_to_date` — score is current
- `outdated` — score exists but data is stale, refresh in progress
- `calculating` — score is being computed for the first time, `solidUser` will be `null`

### TypeScript Example

```typescript
interface SolidScoreResponse {
  solidUser: {
    solidScore: number;
    badges: string[];
    tierGroup: 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';
    dataPoints: Record<string, number>;
    isSolanaIdUser: boolean;
  } | null;
  status: 'up_to_date' | 'outdated' | 'calculating';
}

async function getSolidScore(walletAddress: string): Promise<SolidScoreResponse> {
  const response = await fetch(
    `https://backend.app.solana.id/api/solid-score/address/${walletAddress}`,
    {
      headers: { 'x-api-key': process.env.SOLANA_ID_API_KEY! },
    }
  );

  if (response.status === 401) throw new Error('Invalid or missing API key');
  if (response.status === 429) throw new Error('Rate limit exceeded');
  if (!response.ok) throw new Error(`API error: ${response.status}`);

  return response.json();
}
```

### Batch Lookups

The API does not have a native batch endpoint. For multiple wallets, make sequential requests with a small delay to respect rate limits:

```typescript
async function batchGetScores(
  wallets: string[],
  delayMs: number = 100
): Promise<Map<string, SolidScoreResponse>> {
  const results = new Map<string, SolidScoreResponse>();

  for (const wallet of wallets) {
    const score = await getSolidScore(wallet);
    results.set(wallet, score);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return results;
}
```

---

## SOLID Score System

### Tier Thresholds

| Tier | Score Range | Description |
|------|-------------|-------------|
| **Tier 1** | 450 – 1000 | Power users — highly active across DeFi, NFTs, governance |
| **Tier 2** | 300 – 449 | Active users — regular on-chain activity |
| **Tier 3** | 200 – 299 | Moderate users — some on-chain history |
| **Tier 4** | 1 – 199 | New or low-activity wallets |

### Scoring Categories

The score is computed from 32 metrics across 6 categories:

| Category | What It Measures |
|----------|-----------------|
| **SOL Balance** | Native SOL holdings |
| **SPL Tokens** | Token diversity and holdings |
| **NFTs** | NFT collection and activity |
| **DeFi** | DEX swaps, lending, liquidity provision |
| **Governance** | DAO participation, voting |
| **Staking** | SOL staking activity |

Scoring uses logarithmic scaling — early activity has outsized impact, diminishing returns at higher levels.

### Badges

14 possible badges awarded based on on-chain behavior. Badges are returned as uppercase strings (e.g., `"WHALE"`, `"DEFI_MAXI"`, `"NFT_COLLECTOR"`). Each badge corresponds to specific on-chain activity patterns.

---

## Perk Frame Integration (SDN Widget)

The Solana ID Display Network (SDN) lets sites show targeted perks to wallet-connected users.

### Embed Code

```html
<div class="solana-id-YOUR-AGENT-ID-HERE perk-frame-container"></div>
<script src="https://perk.solana.id/solanaid-perkframe.bundle.js"></script>
```

Replace `YOUR-AGENT-ID-HERE` with the agent ID provided during partner onboarding. The widget auto-detects the connected wallet and displays eligible perks.

### Requirements

- Site must have wallet login (e.g., Phantom, Solflare adapter)
- Agent ID from Solana ID partner onboarding
- The script loads asynchronously and renders into the container div

---

## Rate Limits

| Plan | Lifetime Requests | Rate |
|------|-------------------|------|
| **Free** | 5,000 | 150 req/sec max |
| **Custom** | Negotiable | Contact team |

The free tier provides 5,000 total API calls (lifetime, not per-day). For higher limits, contact the Solana ID team via [portal.solana.id](https://portal.solana.id).

### Rate Limit Handling

```typescript
async function getSolidScoreWithRetry(
  wallet: string,
  maxRetries: number = 3
): Promise<SolidScoreResponse> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(
      `https://backend.app.solana.id/api/solid-score/address/${wallet}`,
      { headers: { 'x-api-key': process.env.SOLANA_ID_API_KEY! } }
    );

    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      continue;
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  throw new Error('Rate limit exceeded after retries');
}
```

---

## Use Cases

### Airdrop Eligibility
```typescript
const { solidUser } = await getSolidScore(wallet);
if (solidUser && solidUser.tierGroup === 'tier_1') {
  // Qualify for premium airdrop
}
```

### User Segmentation
```typescript
const { solidUser } = await getSolidScore(wallet);
if (solidUser?.badges.includes('DEFI_MAXI')) {
  // Show DeFi-specific content
}
```

### Gated Access
```typescript
const { solidUser } = await getSolidScore(wallet);
if (solidUser && solidUser.solidScore >= 300) {
  // Grant access to feature
}
```

---

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Process response |
| 401 | Invalid or missing API key | Check `x-api-key` header |
| 429 | Rate limit or usage cap exceeded | Retry with backoff, or upgrade plan |
| 400 | Invalid wallet address | Validate base58 format |

---

## Guidelines

- **DO**: Cache scores locally — data refreshes every ~48 hours, no need to re-fetch frequently
- **DO**: Handle the `calculating` status gracefully — show a loading state, retry after 30s
- **DO**: Use environment variables for the API key, never hardcode
- **DON'T**: Hammer the API in tight loops — add delays between sequential requests
- **DON'T**: Assume `solidUser` is always present — it's `null` when `status` is `calculating`
- **DON'T**: Treat the score as a real-time signal — it's a ~48-hour snapshot of on-chain activity

## Resources

- [Solana ID Hub](https://app.solana.id) — User-facing app
- [Solana ID Portal](https://portal.solana.id) — API key management & campaign dashboard
- [Solana ID Docs](https://solana-id.gitbook.io/solana-id-docs)
