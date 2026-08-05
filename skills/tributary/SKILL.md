---
name: tributary
creator: tributary-so
description: Complete Tributary Protocol SDK for building automated recurring payments on Solana. Supports subscriptions, milestone payments, and pay-as-you-go billing with non-custodial token delegation.
---

# Tributary Protocol SDK Development Guide

A comprehensive guide for building Solana applications with the Tributary Protocol SDK - automated recurring payments with Web2 UX and Web3 transparency.

## Overview

Tributary is a decentralized recurring payments system on Solana offering:

- **Subscriptions**: Fixed recurring payments with auto-renewal
- **Milestone Payments**: Project-based compensation with up to 4 milestones
- **Pay-as-you-go**: Usage-based billing with period limits
- **Referral System**: Multi-level referral rewards
- **Non-Custodial**: Token delegation without giving up custody

## Quick Start

### Installation

```bash
# Core SDK
npm install @tributary-so/sdk

# React components
npm install @tributary-so/sdk-react

# Simple payments integration with checkout link
npm install @tributary-so/payments

# CLI tool
npm install -g @tributary-so/cli
```

### Basic SDK Setup

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { Tributary } from "@tributary-so/sdk";

// 1. Setup connection and wallet
const connection = new Connection("https://api.mainnet-beta.solana.com");
const keypair = Keypair.fromSecretKey(/* your secret key */);
const wallet = new Wallet(keypair);

// 2. Initialize Tributary SDK
const tributary = new Tributary(connection, wallet);

// 3. Create a subscription
const instructions = await tributary.createSubscription(
  tokenMint, // USDC mint
  recipient, // Payment recipient
  gateway, // Payment gateway
  new BN(1_000), // 0.001 USDC
  true, // auto-renew
  12, // max renewals (12 months)
  { monthly: {} }, // payment frequency
  [1, 2, 3, 4] // memo bytes
);

// 4. Send transaction
const tx = new Transaction().add(...instructions);
await sendAndConfirmTransaction(connection, tx, [keypair]);
```

### React Component Setup

```tsx
import { SubscriptionButton, PaymentInterval } from "@tributary-so/sdk-react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

function App() {
  const wallets = [new PhantomWalletAdapter()];

  return (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SubscriptionButton
            amount={new BN(1_000)}
            token={USDC_MINT}
            recipient={RECIPIENT}
            gateway={GATEWAY}
            interval={PaymentInterval.Monthly}
            maxRenewals={12}
            label="Subscribe"
            onSuccess={(result) => console.log("Success:", result)}
            onError={(error) => console.error("Error:", error)}
          />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

### CLI Setup

```bash
# Initialize program (admin only)
tributary-cli -c https://api.devnet.solana.com -k ~/.config/solana/id.json \
  initialize -a [ADMIN_PUBKEY]

# Create a payment gateway
tributary-cli create-gateway \
  -a [AUTHORITY_PUBKEY] \
  -f 500 \
  -r [FEE_RECIPIENT] \
  -n "My Gateway" \
  -u "https://mygateway.com"

# Create a subscription
tributary-cli create-subscription \
  -t [TOKEN_MINT] \
  -r [RECIPIENT] \
  -g [GATEWAY] \
  -a 1000000 \
  -f monthly
```

### Payments Package Setup

```typescript
import { PaymentsClient } from "@tributary-so/payments";
import { Connection } from "@solana/web3.js";
import { Tributary } from "@tributary-so/sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const tributary = new Tributary(connection, wallet);
const manager = new PaymentsClient(connection, tributary);

// Create checkout session
const session = await manager.checkout.sessions.create({
  payment_method_types: ["tributary"],
  line_items: [
    {
      description: "Monthly premium access",
      unitPrice: 20.0,
      quantity: 1,
    },
  ],
  paymentFrequency: "monthly",
  mode: "subscription",
  success_url: "https://yourapp.com/success",
  cancel_url: "https://yourapp.com/cancel",
  tributaryConfig: {
    gateway: "GATEWAY_PUBKEY",
    recipient: "RECIPIENT_PUBKEY",
    trackingId: "user_123_monthly_premium",
    autoRenew: true,
  },
});

// Redirect to checkout
window.location.href = session.url;

// Check subscription status
const status = await manager.subscriptions.checkStatus({
  trackingId: "user_123_monthly_premium",
  userPublicKey: "USER_PUBKEY",
  tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
});

if (status.status === "active") {
  console.log("Subscription active!", status.paymentCount);
}
```

## Core Concepts

### 1. Payment Types

**Subscription** (`PolicyType.subscription`):

- Fixed recurring payments at regular intervals
- Auto-renewal with optional maximum renewals
- Supports: daily, weekly, monthly, quarterly, semi-annually, annually

**Milestone** (`PolicyType.milestone`):

- Up to 4 project-based milestones
- Configurable release conditions (time-based, manual approval)
- Escrow-style payment locking

**Pay-as-you-go** (`PolicyType.payAsYouGo`):

- Usage-based billing with period limits
- Providers claim funds as services are consumed
- Periods reset automatically

### 2. Program Derived Addresses (PDAs)

| PDA                | Seeds                                         | Purpose                    |
| ------------------ | --------------------------------------------- | -------------------------- |
| `ProgramConfig`    | `["program_config"]`                          | Protocol-wide settings     |
| `PaymentGateway`   | `["payment_gateway", authority]`              | Gateway settings and fees  |
| `UserPayment`      | `["user_payment", owner, mint]`               | User's payment tracking    |
| `PaymentPolicy`    | `["payment_policy", user_payment, policy_id]` | Individual subscription    |
| `PaymentsDelegate` | `["payments_delegate"]`                       | Token delegation authority |
| `ReferralAccount`  | `["referral", gateway, code]`                 | Referral tracking          |

### 3. Payment Frequency

```typescript
type PaymentFrequency =
  | { daily: {} }
  | { weekly: {} }
  | { monthly: {} }
  | { quarterly: {} }
  | { semiAnnually: {} }
  | { annually: {} }
  | { custom: {0: 60*60*24*7} };  // every 7 days
```

### 4. Fees

- **Protocol Fee**: 100 bps (1%) - goes to protocol treasury
- **Gateway Fee**: Configurable (0-10,000 bps) - split between gateway and protocol
- **Referral Allocation**: Up to 2500 bps (25%) of gateway fee

## Payment Operations

### Creating Subscriptions

```typescript
// Full subscription setup (handles ATAs, user account, approvals)
const instructions = await tributary.createSubscription(
  tokenMint, // PublicKey - token to pay with
  recipient, // PublicKey - payment recipient
  gateway, // PublicKey - payment gateway
  new BN(1_000), // BN - amount per payment
  true, // boolean - auto-renew
  12, // number | null - max renewals
  { monthly: {} }, // PaymentFrequency
  [1, 2, 3, 4], // number[] - memo bytes
  new BN(Math.floor(Date.now() / 1000)), // BN | null - start time
  new BN(12_000), // BN - approval amount
  true, // boolean - execute immediately
  "ABC123" // string - referral code
);

// Low-level instruction only
const ix = await tributary.getCreateSubscriptionPolicyInstruction(
  tokenMint,
  recipient,
  gateway,
  new BN(1_000),
  true,
  12,
  { monthly: {} },
  [1, 2, 3, 4],
  startTime
);
```

### Creating Milestone Payments

```typescript
const now = Math.floor(Date.now() / 1000);

const instructions = await tributary.createMilestone(
  tokenMint,
  recipient,
  gateway,
  [
    new BN(25_000_000), // $25 milestone 1
    new BN(25_000_000), // $25 milestone 2
    new BN(25_000_000), // $25 milestone 3
    new BN(25_000_000), // $25 milestone 4
  ],
  [
    new BN(now + 7 * 24 * 60 * 60), // Week 1
    new BN(now + 14 * 24 * 60 * 60), // Week 2
    new BN(now + 21 * 24 * 60 * 60), // Week 3
    new BN(now + 28 * 24 * 60 * 60), // Week 4
  ],
  0, // releaseCondition: 0=time-based, 1=gateway signer, 2=owner signer, 4=recipient signer
  [1, 2, 3, 4],
  new BN(100_000_000),
  true
);
```

### Creating Pay-as-you-go

```typescript
const instructions = await tributary.createPayAsYouGo(
  tokenMint,
  recipient,
  gateway,
  new BN(100_000_000), // Max $100 per period
  new BN(10_000_000), // Max $10 per chunk
  new BN(30 * 24 * 60 * 60), // 30 days
  [1, 2, 3, 4],
  new BN(120_000_000) // 1 year approval
);
```

### Executing Payments

```typescript
// Execute payment (permissionless - can be called by anyone)
const instructions = await tributary.executePayment(
  paymentPolicyPda,
  undefined, // paymentAmount (optional for subscription/milestone)
  recipient,
  tokenMint,
  gateway,
  user
);
```

## Gateway Management

### Creating a Gateway

```typescript
const ix = await tributary.createPaymentGateway(
  authority,
  500, // 5% gateway fee in basis points
  feeRecipient,
  "My Gateway",
  "https://mygateway.com"
);
```

### Updating Gateway Settings

```typescript
// Update referral settings
const ix = await tributary.updateGatewayReferralSettings(
  gatewayAuthority,
  1, // featureFlags: bit 0 = referral enabled
  500, // referralAllocationBps: 5% of gateway fee
  [7000, 2000, 1000] // referralTiersBps: L1=70%, L2=20%, L3=10%
);
```

## Referral System

### Creating Referral Accounts

```typescript
// Create referral account with referrer
const ix = await tributary.createReferralAccount(
  gateway,
  "ABC123", // Your unique 6-char referral code
  referrerKey // Optional: who referred you
);
```

### Querying Referral Data

```typescript
// Get referral account by code
const referral = await tributary.getReferralAccountByCode(gateway, "ABC123");

// Get referral account by owner
const referral = await tributary.getReferralAccountByOwner(gateway, ownerKey);
```

## Account Queries

### User Payments

```typescript
// Get user payment account
const { address } = tributary.getUserPaymentPda(owner, tokenMint);
const userPayment = await tributary.program.account.userPayment.fetch(address);

console.log("Created policies:", userPayment.createdPoliciesCount);
```

### Payment Policies

```typescript
// Get all policies for a user
const policies = await tributary.getPaymentPoliciesByUserPayment(
  userPaymentPda
);

// Get policies by gateway
const policies = await tributary.getPaymentPoliciesByGateway(gateway);

// Get policies by owner
const policies = await tributary.getPaymentPoliciesByOwner(owner, tokenMint);
```

### Gateways

```typescript
// Get gateway
const gateway = await tributary.getPaymentGateway(gatewayPda);

console.log("Fee BPS:", gateway.feeBps);
console.log("Authority:", gateway.authority.toString());
```

## React Components

### SubscriptionButton

```tsx
<SubscriptionButton
  amount={new BN(1_000)}
  token={USDC_MINT}
  recipient={RECIPIENT}
  gateway={GATEWAY}
  interval={PaymentInterval.Monthly}
  maxRenewals={12}
  memo="Monthly subscription"
  approvalAmount={new BN(12_000)}
  executeImmediately={true}
  label="Subscribe Monthly"
  className="bg-blue-500 hover:bg-blue-600"
  onSuccess={(result) => console.log("Success:", result)}
  onError={(error) => console.error("Error:", error)}
/>
```

### MilestoneButton

```tsx
<MilestoneButton
  milestoneAmounts={[
    new BN(25_000_000),
    new BN(25_000_000),
    new BN(25_000_000),
    new BN(25_000_000),
  ]}
  milestoneTimestamps={[
    new BN(Date.now() / 1000 + 7 * 24 * 60 * 60),
    new BN(Date.now() / 1000 + 14 * 24 * 60 * 60),
    new BN(Date.now() / 1000 + 21 * 24 * 60 * 60),
    new BN(Date.now() / 1000 + 28 * 24 * 60 * 60),
  ]}
  releaseCondition={0}
  token={USDC_MINT}
  recipient={RECIPIENT}
  gateway={GATEWAY}
  memo="Project milestones"
  approvalAmount={new BN(100_000_000)}
  executeImmediately={true}
  label="Create Milestone Plan"
/>
```

### PayAsYouGoButton

```tsx
<PayAsYouGoButton
  maxAmountPerPeriod={new BN(100_000_000)}
  maxChunkAmount={new BN(10_000_000)}
  periodLengthSeconds={new BN(30 * 24 * 60 * 60)}
  token={USDC_MINT}
  recipient={RECIPIENT}
  gateway={GATEWAY}
  memo="Usage billing"
  approvalAmount={new BN(120_000_000)}
  label="Setup Usage Billing"
/>
```

### SubscriptionButtonWithCode (Wallet-less)

```tsx
<SubscriptionButtonWithCode
  amount={new BN(1_000)}
  token={USDC_MINT}
  gateway={GATEWAY}
  interval={PaymentInterval.Monthly}
  maxRenewals={12}
  memo="Action code subscription"
  approvalAmount={new BN(12_000)}
  executeImmediately={true}
  label="Generate Payment Code"
  onSuccess={(result) => {
    console.log("Action code:", result.actionCode);
  }}
/>
```

## CLI Commands

### Gateway Management

```bash
# Create gateway
tributary-cli create-gateway \
  -a AUTHORITY -f 500 -r FEE_RECIPIENT \
  -n "My Gateway" -u "https://mygateway.com"

# Update referral settings
tributary-cli update-gateway-referral-settings \
  -a AUTHORITY -f 1 -l 500 -t "7000,2000,1000"

# Delete gateway
tributary-cli delete-gateway -a AUTHORITY
```

### Subscription Management

```bash
# Create user payment account
tributary-cli create-user-payment -t TOKEN_MINT

# Create subscription
tributary-cli create-subscription \
  -t TOKEN_MINT -r RECIPIENT -g GATEWAY \
  -a 1000000 -f monthly --auto-renew --max-renewals 12

# Execute payment
tributary-cli execute-payment -u USER_PAYMENT_PDA
```

### Inspection

```bash
# List all gateways
tributary-cli list-gateways

# List policies by owner
tributary-cli list-policies-by-owner -o OWNER

# Get PDAs
tributary-cli get-gateway-pda -a AUTHORITY
tributary-cli get-user-payment-pda -u USER -t TOKEN_MINT
tributary-cli get-payment-policy-pda -u USER_PAYMENT -p 1
```

## Error Handling

```typescript
try {
  const instructions = await tributary.createSubscription(/* ... */);
  await sendAndConfirmTransaction(connection, tx, [keypair]);
} catch (error) {
  if (error.message.includes("InsufficientFunds")) {
    console.error("Not enough tokens for approval");
  } else if (error.message.includes("DelegateNotApproved")) {
    console.error("Token delegation not set up");
  } else if (error.message.includes("PaymentNotDue")) {
    console.error("Payment not due yet");
  } else if (error.message.includes("EmergencyPause")) {
    console.error("Protocol is paused");
  } else {
    throw error;
  }
}
```

## Architecture

```
User → Create UserPayment (owner/mint)
     → Create PaymentPolicy (user_payment/recipient/gateway)
     → Approve Delegate (token account delegation)

Gateway/Facilitator:
     → Create PaymentGateway (authority/signer)
     → Execute Payment (permissionless, by gateway signer)
       → Transfer to recipient + fees + referral rewards
```

The `UserPayment` is an additional layer between the user's authority and the
payment policy to group policies by mint.

## Skill Structure

```
tributary/
├── SKILL.md                          # This file
├── resources/
│   ├── sdk-api-reference.md          # Tributary class methods
│   ├── types-reference.md            # TypeScript types and enums
│   ├── cli-commands.md               # CLI command reference
│   ├── payments-api.md               # PaymentsClient API
│   └── react-hooks.md                # React hooks reference
├── examples/
│   ├── basic-setup/                  # SDK initialization
│   ├── subscriptions/                # Subscription examples
│   ├── milestones/                   # Milestone payment examples
│   ├── pay-as-you-go/                # Usage billing examples
│   ├── react-components/             # React component examples
│   └── cli-operations/               # CLI usage examples
└── templates/
    └── react-app-template.tsx        # Copy-paste React starter
```

## Resources

- [Tributary Documentation](https://docs.tributary.so)
- [Core SDK](../../../packages/sdk/README.md)
- [React SDK](../../../packages/sdk-react/README.md)
- [Payments Package](../../../packages/payments/README.md)
- [CLI Tool](../../../apps/cli/README.md)
- [GitHub Repository](https://github.com/tributary-so/tributary)

## Next Steps

- [SDK API Reference](./resources/sdk-api-reference.md) - Complete method documentation
- [React Components Guide](./resources/react-hooks.md) - Component and hook reference
- [CLI Commands](./resources/cli-commands.md) - Full CLI documentation
- [Example: React App](./templates/react-app-template.tsx) - Production-ready template

## Links

- **Website:** [tributary.so](https://tributary.so)
- **Docs:** [docs.tributary.so](https://docs.tributary.so)
- **SDK:** [sdk.tributary.so](https://sdk.tributary.so)
- **Checkout:** [checkout.tributary.so](https://checkout.tributary.so)
- **Lando:** [lando.tributary.so](https://lando.tributary.so)
- **GitHub:** [github.com/tributary-so](https://github.com/tributary-so)
- **Twitter:** [x.com/tributaryso](https://x.com/tributaryso)
- **Telegram:** [t.me/tributaryso](https://t.me/tributaryso)
- **Program:** `TRibg8W8zmPHQqWtyAD1rEBRXEdyU13Mu6qX1Sg42tJ`
