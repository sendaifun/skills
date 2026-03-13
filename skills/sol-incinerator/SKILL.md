---
name: sol-incinerator
description: SOL Incinerator SDK for burning tokens, NFTs, and closing accounts
---

# Sol-Incinerator Burn + Close API v2 Guide

A practical integration guide for Sol-Incinerator's HTTP API. The main user-facing outcomes are burning tokens, burning NFTs, and closing token accounts, while still supporting advanced batch cleanup and relay workflows.

Live API base URL: `https://v2.api.sol-incinerator.com`

## Overview

Sol-Incinerator API v2 provides:
- Autonomous API key provisioning via `POST /api-keys/generate`
- Burn/close transaction building for SPL Token, Token-2022, and NFT account patterns
- Instruction-only endpoints when you want full client-side transaction assembly
- Preview/summary endpoints to estimate reclaimed rent and fees before execution
- Transaction relay endpoints to broadcast already-signed payloads
- Partner/referral monetization inputs with built-in validation

## Core Endpoint Groups

| Group | Endpoints |
|------|-----------|
| Public discovery | `GET /`, `/openapi.json`, `/.well-known/api-catalog`, `/llms*`, `/DOCS.md` |
| Public auth bootstrap | `POST /api-keys/generate` |
| Burn + close (API key required) | `/burn`, `/burn-instructions`, `/close`, `/close-instructions`, `/batch/close-all*` |
| Relay + confirmation (API key required) | `/transactions/send`, `/transactions/send-batch`, `/transactions/status` |

## Quick Start

### 1) Generate API key (no user input)

```typescript
const baseUrl = 'https://v2.api.sol-incinerator.com';

const keyResp = await fetch(`${baseUrl}/api-keys/generate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ label: 'autonomous-agent' }),
});

if (!keyResp.ok) {
  throw new Error(`API key generation failed: ${keyResp.status}`);
}

const { apiKey } = await keyResp.json() as { apiKey: string };
```

### 2) Run preview-first flow

```typescript
const headers = {
  'content-type': 'application/json',
  'x-api-key': apiKey,
};

const previewResp = await fetch(`${baseUrl}/burn/preview`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    userPublicKey,
    assetId,
    burnAmount: '1',
  }),
});
```

### 3) Build, sign, submit

1. Call `/burn`, `/close`, or `/batch/close-all`.
2. Decode base58 serialized transaction(s) and sign locally with the wallet keypair.
3. Submit through your wallet/RPC flow, or use `/transactions/send` and `/transactions/send-batch`.
4. Poll `/transactions/status` if needed.

## Core Integration Rules

### Auth

- Send API key in either:
  - `x-api-key: ak_xxx.yyy` (recommended for server agents)
  - `Authorization: Bearer ak_xxx.yyy`
- Core routes return `401` when key is missing or invalid.

### Required body fields

- Single-asset routes (`/burn`, `/close`, previews, instructions):
  - `userPublicKey`
  - `assetId`
- Batch routes (`/batch/close-all*`):
  - `userPublicKey`

### Optional body fields used often

- `feePayer` (public key)
- `asLegacyTransaction` (boolean)
- `priorityFeeMicroLamports` (integer)
- `autoCloseTokenAccounts` (boolean, burn flows)
- `burnAmount` (positive integer in atomic units; use string for large values)
- `offset`, `limit` (batch pagination/windowing)

### Partner + referral validation

- `partnerFeeAccount` and `partnerFeeBps` are all-or-nothing.
- `partnerFeeBps` must be integer `0..9800`.
- `referralCode` must be `2-20` lowercase alphanumeric.
- `referralCode` cannot be combined with partner fee fields.

## Endpoint Selection

- Use `/burn/preview` or `/close/preview` before execution when:
  - the user needs fee visibility
  - assets may be frozen/invalid/non-empty
- Use `/burn` and `/close` when:
  - you want ready-to-sign transaction payloads
- Use `/burn-instructions` and `/close-instructions` when:
  - your app assembles transactions client-side
- Use `/batch/close-all/preview` first for wallet cleanup UX
- Use `/batch/close-all/summary` for lightweight dashboard counts
- Use `/transactions/send-batch` for multi-tx close-all pipelines

## Example Workflow (Agent)

1. Generate an API key with `POST /api-keys/generate`.
2. Run preview endpoint for target operation.
3. If preview is acceptable, request executable transaction payload.
4. Sign transaction locally.
5. Submit signed payload.
6. Confirm completion via `/transactions/status`.
7. Store operation metadata (signature, fees, lamports reclaimed).

## Guidelines

- DO run preview before destructive operations.
- DO pass `burnAmount` as a string for large atomic values.
- DO validate user/asset pubkeys before submitting.
- DO keep private keys local; only send signed transactions to relay endpoints.
- DON'T combine `referralCode` with partner fee fields.
- DON'T send unsigned payloads to relay routes.
- DON'T assume base64 encoding for relay payloads unless explicitly set `encoding: "base64"` (default is base58).

## Resources

- [Canonical docs (v2)](https://api.dashboard.sol-incinerator.com/docs/v2)
- [OpenAPI spec (`/openapi.json`)](https://v2.api.sol-incinerator.com/openapi.json)
- [LLM index (`/llms.txt`)](https://v2.api.sol-incinerator.com/llms.txt)
- [Example flows (close account, burn token, burn NFT)](./examples/basic/http-flow.ts)

## Skill Structure

```
sol-incinerator/
├── SKILL.md                          # This file
├── resources/
│   └── api-reference.md              # Endpoint matrix and request notes
├── examples/
│   └── basic/
│       └── http-flow.ts              # Close-account + token/NFT burn examples
├── templates/
│   └── sol-incinerator-client.ts     # Ready-to-use TypeScript client
└── docs/
    └── troubleshooting.md            # Common errors and fixes
```
