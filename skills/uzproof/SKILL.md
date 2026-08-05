---
name: uzproof
description: Verify real on-chain usage on Solana — swaps, staking, token holds, liquidity, NFTs across 15 protocols (Jupiter, Marinade, Sanctum, Orca, Raydium, Drift, Drift Vaults, Kamino, MarginFi, Meteora, Jito, Tensor, Magic Eden, Metaplex, SPL Token). Anti-fraud scoring and on-chain SAS attestation. Use when verifying wallet activity, building proof-of-use features, gating access by on-chain behavior, distributing rewards based on verified actions, or detecting wash trading and sybil attacks.
license: MIT
metadata:
  author: uzproof
  version: "2.0.0"
---

# UZPROOF — Proof-of-Use Verification for Solana

You are building with UZPROOF, the first Proof-of-Use verification layer on Solana. UZPROOF verifies that a wallet **actually performed** an on-chain action — not just that a transaction exists, but that the intent behind it is real and verifiable.

## Use / Do Not Use

**Use when:**

- Verifying a wallet performed a specific on-chain action (swap, stake, hold, mint)
- Building reward distribution that requires proof of real usage
- Gating access to features based on on-chain behavior
- Detecting wash trading, sybil attacks, or fake activity
- Creating on-chain attestations for verified usage (SAS)
- Auto-detecting which protocol a Solana program belongs to
- Fetching token metadata and live prices

**Do not use when:**

- Executing transactions (use Jupiter, Drift, etc. for that)
- Reading raw transaction data (use Helius for that)
- Building wallets or signing transactions

**Triggers:** `verify`, `proof`, `proof-of-use`, `attestation`, `anti-fraud`, `sybil`, `wash trading`, `gating`, `eligibility`, `completed action`, `did wallet`, `has wallet`, `check if swapped`, `check if staked`, `check if holds`, `on-chain verification`, `reward distribution`, `airdrop eligibility`

## Quick Start

```bash
npm install @uzproof/verify
```

```typescript
import { UzproofClient } from '@uzproof/verify';

const client = new UzproofClient();

// Read-only endpoints — no auth required
const token = await client.getTokenInfo('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN');
const attestation = await client.getAttestation('7H4RVLxfe4MYQGV3XxwJo5GrcFdNUBQEziSJYAfwqoiP');
const protocol = await client.detectContract('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
```

## Authentication

UZPROOF has two authentication paths:

| Path | Who | How |
|---|---|---|
| **Self** | End users on uzproof.com | Sign in with wallet — session cookie. Handled by the dashboard, not via SDK. |
| **x402** | B2B backends, AI agents | Pay $0.05 USDC per `verify()` call on Solana mainnet. Pass the tx signature as `xPayment`. Live since 2026-04-16. |

Read-only endpoints (`getTokenInfo`, `getAttestation`, `detectContract`) are **free** and need no authentication.

> API keys are reserved for a future Phase 2 release. Today, programmatic `verify()` calls from backends or AI agents must pay via x402 — see [references/x402.md](references/x402.md).

## Core API

### `verify(request, options?)` — Verify On-Chain Action

The primary method. Checks if a wallet actually performed a specific action. Requires x402 payment when called from a backend/AI agent.

```typescript
const result = await client.verify(
  {
    wallet: string,        // Solana wallet address
    action: ActionType,    // What to verify (see Action Types below)
    config?: {             // Action-specific parameters
      program_id?: string,       // Solana program ID
      token_mint?: string,       // SPL token mint
      min_amount_usd?: number,   // Minimum USD amount
      min_amount?: number,       // Minimum token amount
      min_amount_sol?: number,   // Minimum SOL amount
      collection_address?: string, // NFT collection
      nft_mint?: string,         // Specific NFT mint
      min_volume_usd?: number,   // Minimum trading volume
    },
  },
  { xPayment: paymentTxSignature },  // USDC tx sig from x402 flow
);

// Returns:
{
  verified: boolean,
  taskType: string,
  result: {
    matchingTxCount?: number,
    matchingSignatures?: string[],
    totalVolumeEstimate?: number,
    balance?: number,
    stakedSol?: number,
    nftCount?: number,
    signature?: string,
    error?: string
  }
}
```

### `detectContract(programId)` — Auto-Detect Protocol

Free endpoint. Identifies a Solana program and suggests verification types.

```typescript
const info = await client.detectContract('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
// info.program.name = "Jupiter Aggregator v6"
// info.program.category = "dex"
// info.program.supportedActions = ["defi_swap", "defi_swap_buy", ...]
```

See [references/contract-detect.md](references/contract-detect.md) for all 15 protocols.

### `getTokenInfo(mint)` — Token Metadata & Price

Free endpoint.

```typescript
const token = await client.getTokenInfo('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN');
// token.symbol = "JUP", token.priceUsd = 0.85
```

### `getAttestation(wallet)` — On-Chain SAS Attestation

Free endpoint. Checks if a wallet has an on-chain Proof-of-Use attestation on the Solana Attestation Service — the data lives on-chain and anyone can read it directly via RPC, so our convenience wrapper is free too.

```typescript
const status = await client.getAttestation('7H4RVL...');
// status.hasAttestation = true
// status.attestation = "2chgBf..." (PDA address)
// status.explorer = "https://explorer.solana.com/address/..."
```

See [references/attestation.md](references/attestation.md) for SAS integration details.

## Intent Router

| User Intent | Method | Action Type | Config |
|---|---|---|---|
| "Did wallet swap on Jupiter?" | `verify()` | `defi_swap` | `program_id` |
| "Does wallet hold 100 USDC?" | `verify()` | `defi_hold_token` | `token_mint`, `min_amount` |
| "Has wallet staked SOL?" | `verify()` | `defi_stake_sol` | `min_amount_sol` |
| "Did wallet add liquidity?" | `verify()` | `defi_add_liquidity` | `program_id` |
| "Does wallet own an NFT from collection X?" | `verify()` | `nft_hold` | `collection_address` |
| "What protocol is this program?" | `detectContract()` | — | `programId` |
| "Check on-chain attestation" | `getAttestation()` | — | `wallet` |
| "Get token price and info" | `getTokenInfo()` | — | `mint` |

## Action Types

### DeFi Actions

| Type | Verifies |
|---|---|
| `defi_swap` | Any swap on a supported DEX |
| `defi_swap_buy` | Buy-side swap for specific token |
| `defi_swap_sell` | Sell-side swap for specific token |
| `defi_swap_volume` | Cumulative trading volume |
| `defi_hold_token` | Current token balance |
| `defi_hold_stablecoin` | Stablecoin balance (USDC, USDT) |
| `defi_hold_staked` | Staked token balance |
| `defi_hold_token_duration` | Token held for minimum duration |
| `defi_hold_lp` | LP token balance |
| `defi_stake_sol` | SOL staking (native or LST) |
| `defi_add_liquidity` | Liquidity provision |
| `defi_bridge` | Cross-chain bridge transaction |
| `defi_lend` | Lending deposit |
| `defi_borrow` | Borrowing position |
| `defi_vote` | Governance vote |
| `defi_repay` | Loan repayment |
| `defi_claim` | Reward claim |
| `defi_create_lst` | LST creation |
| `defi_perp_trade` | Perpetual futures trade |
| `defi_perp_volume` | Perpetual futures volume |

### NFT Actions

| Type | Verifies |
|---|---|
| `nft_hold` | Owns NFT from collection |
| `nft_mint` | Minted an NFT |
| `nft_check` | General NFT ownership check |

### Utility Actions

| Type | Verifies |
|---|---|
| `token_balance` | Raw token balance |
| `tx_verify` | Specific transaction existence |
| `gaming_play` | Gaming interaction |

See [references/verification.md](references/verification.md) for detailed examples of each action type.

## Common Patterns

### Airdrop Eligibility Check (x402)

```typescript
import { UzproofClient, PaymentRequiredError } from '@uzproof/verify';

async function checkEligibility(
  wallet: string,
  payForCall: (amountUsdc: string, payTo: string) => Promise<string>,
): Promise<boolean> {
  const client = new UzproofClient();

  // First attempt — will 402 with payment schema
  try {
    const swapped = await client.verify({
      wallet,
      action: 'defi_swap',
      config: { program_id: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', min_amount_usd: 10 },
    });
    return swapped.verified;
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      // Pay the 402 schema, retry with xPayment
      const scheme = err.details.schemes[0];
      const sig = await payForCall(scheme.maxAmountRequired, scheme.payTo);
      const swapped = await client.verify(
        { wallet, action: 'defi_swap', config: { program_id: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', min_amount_usd: 10 } },
        { xPayment: sig },
      );
      return swapped.verified;
    }
    throw err;
  }
}
```

### Task Verification

```typescript
async function verifyTask(
  wallet: string,
  task: { type: string; config: object },
  paymentSignature: string,
) {
  const client = new UzproofClient();
  const result = await client.verify(
    { wallet, action: task.type as ActionType, config: task.config },
    { xPayment: paymentSignature },
  );
  return {
    completed: result.verified,
    evidence: result.result.matchingSignatures || [],
    volume: result.result.totalVolumeEstimate,
  };
}
```

### Protocol Auto-Detection (free)

```typescript
const info = await client.detectContract(userProgramId);
if (info.detected) {
  console.log(`Detected: ${info.program.name} (${info.program.category})`);
  console.log(`Supported verifications: ${info.program.supportedActions.join(', ')}`);
  const template = info.verificationTemplate;
}
```

## x402 Pay-Per-Verify — LIVE on mainnet

UZPROOF's `/api/verify` is **live** behind x402 since 2026-04-16. Price: **$0.05 USDC per call** on Solana mainnet. No API key. No signup.

Flow (4 steps):

1. Call `verify()` without `xPayment` — SDK throws `PaymentRequiredError` carrying the x402 schema (`payTo`, `maxAmountRequired`, USDC mint)
2. Sign and broadcast a USDC transfer for at least `maxAmountRequired` to `payTo`
3. Grab the tx signature once confirmed (5-minute window)
4. Retry `verify()` with `{ xPayment: txSignature }` — get the verification result

One signature = one verify call. Replays are rejected server-side. See [references/x402.md](references/x402.md) for full walkthrough, pricing table, and SDK examples.

## Error Handling

```typescript
import { PaymentRequiredError } from '@uzproof/verify';

try {
  const result = await client.verify(
    { wallet, action: 'defi_swap', config: {} },
    { xPayment: paymentSig },
  );
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    // 402 — payment required or invalid signature; error.details has the x402 schema
  } else if (error.message.includes('401')) {
    // AUTH_REQUIRED — called without xPayment (B2B) or session cookie (self)
  } else if (error.message.includes('400')) {
    // Invalid request — malformed wallet, unsupported action, or taskId in x402 mode
  } else if (error.message.includes('429')) {
    // Rate limited — x402 tier is 60/min per IP; self tier is 20/min
  }
}
```

## Constants

```typescript
import { SAS_PROGRAM_ID, UZPROOF_CREDENTIAL, POU_SCHEMA, ACTION_TYPES, SUPPORTED_PROTOCOLS } from '@uzproof/verify';

SAS_PROGRAM_ID     // "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG"
UZPROOF_CREDENTIAL // "2chgBfvkwhnHQVVAyXKDK6CBjbCRMQ8aLWrysL5UQyyF"
POU_SCHEMA         // "8yW2BboQuhp2MMmrQLFz35V6VSqC48MF7wZ5bmzcTeTF"
ACTION_TYPES       // All 26 supported action types
SUPPORTED_PROTOCOLS // 15 protocol names
```

## Companion Skills

UZPROOF verifies actions — it does not execute them. For executing on-chain actions, pair with these skills:

| Skill | Install | Use for |
|-------|---------|---------|
| **Jupiter** | `npx skills add jup-ag/agent-skills --skill integrating-jupiter` | Swap execution, quotes, DCA, limit orders |
| **Jupiter Lend** | `npx skills add jup-ag/agent-skills --skill jupiter-lend` | Lending, borrowing, vaults |
| **Solana Dev** | `npx skills add solana-foundation/solana-dev-skill` | Anchor programs, wallet connection, testing |

**Typical workflow:** Jupiter skill executes a swap → UZPROOF skill verifies it happened (x402) → SAS attestation records proof on-chain.

## Links

- **npm:** [@uzproof/verify](https://www.npmjs.com/package/@uzproof/verify)
- **Website:** [uzproof.com](https://uzproof.com)
- **API Health:** [uzproof.com/api/health](https://uzproof.com/api/health)
- **x402 Pricing:** [uzproof.com/api/x402/pricing](https://uzproof.com/api/x402/pricing)
- **Skill repo:** [github.com/uzproof/uzproof-agent-skill](https://github.com/uzproof/uzproof-agent-skill)
