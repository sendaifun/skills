# Tributary TypeScript Types Reference

## Core Enums

### PaymentFrequency

```typescript
enum PaymentFrequency {
  daily = {};
  weekly = {};
  monthly = {};
  quarterly = {};
  semiAnnually = {};
  annually = {};
}
```

### PolicyType

```typescript
type PolicyType =
  | { subscription: SubscriptionPolicy }
  | { payAsYouGo: PayAsYouGoPolicy }
  | { milestone: MilestonePolicy };
```

### SubscriptionPolicy

```typescript
interface SubscriptionPolicy {
  amount: BN; // Payment amount per interval
  autoRenew: boolean; // Auto-renewal flag
  maxRenewals: number | null; // Maximum renewals (null = unlimited)
  paymentFrequency: PaymentFrequency;
  nextPaymentDue: BN; // Next payment timestamp
  padding: number[];
}
```

### PayAsYouGoPolicy

```typescript
interface PayAsYouGoPolicy {
  maxAmountPerPeriod: BN; // Max amount per period
  maxChunkAmount: BN; // Max amount per claim
  periodLengthSeconds: BN; // Period duration
  currentPeriodStart: BN; // Current period start
  currentPeriodTotal: BN; // Current period usage
  padding: number[];
}
```

### MilestonePolicy

```typescript
interface MilestonePolicy {
  milestoneAmounts: BN[]; // [4] amounts
  milestoneTimestamps: BN[]; // [4] timestamps
  currentMilestone: number; // Current milestone index
  releaseCondition: number; // Release bitmap
  totalMilestones: number; // Total milestones
  escrowAmount: BN; // Total escrowed
  padding: number[];
}
```

### ReleaseCondition Bitmap

| Bit | Meaning                   |
| --- | ------------------------- |
| 0   | Check due date            |
| 1   | Gateway signer required   |
| 2   | Owner signer required     |
| 3   | Recipient signer required |

Note: Bits 1-3 are are mutually exclusive.

## State Accounts

### ProgramConfig

```typescript
interface ProgramConfig {
  admin: PublicKey;
  protocolFeeBps: number;
  feeRecipient: PublicKey;
  authorityBump: number;
  emergencyPause: boolean;
  padding: number[];
}
```

### PaymentGateway

```typescript
interface PaymentGateway {
  authority: PublicKey;
  signer: PublicKey;
  feeRecipient: PublicKey;
  feeBps: number;
  customProtocolFeeBps: number | null;
  useCustomProtocolFee: boolean;
  name: number[]; // [32]
  url: number[]; // [64]
  featureFlags: number;
  referralAllocationBps: number;
  referralTiersBps: number[];
  bump: number;
}
```

### UserPayment

```typescript
interface UserPayment {
  owner: PublicKey;
  tokenMint: PublicKey;
  createdPoliciesCount: number;
  bump: number;
}
```

### PaymentPolicy

```typescript
interface PaymentPolicy {
  userPayment: PublicKey;
  recipient: PublicKey;
  tokenMint: PublicKey;
  gateway: PublicKey;
  policyType: PolicyType;
  memo: number[];
  paymentCount: number;
  bump: number;
}
```

### ReferralAccount

```typescript
interface ReferralAccount {
  owner: PublicKey;
  gateway: PublicKey;
  referralCode: number[];
  l1Referrer: PublicKey | null;
  l2Referrer: PublicKey | null;
  l3Referrer: PublicKey | null;
  bump: number;
}
```

## Result Types

```typescript
interface PdaResult {
  address: PublicKey;
  bump: number;
}
```

## Feature Flags

| Bit | Flag             | Description            |
| --- | ---------------- | ---------------------- |
| 0   | referral_enabled | Enable referral system |

## Common Constants

```typescript
// Program ID
PROGRAM_ID: PublicKey;

// Default protocol fee (basis points)
PROTOCOL_FEE_BPS = 100; // 1%

// Maximum gateway fee
MAX_GATEWAY_FEE_BPS = 10000; // 100%

// Maximum referral allocation
MAX_REFERRAL_ALLOCATION_BPS = 2500; // 25%

// Memo max length
MAX_MEMO_LENGTH = 64;

// Referral code length
REFERRAL_CODE_LENGTH = 6;

// Max milestones
MAX_MILESTONES = 4;
```

## Utility Types

### PaymentInterval (React SDK)

```typescript
enum PaymentInterval {
  Daily = "daily",
  Weekly = "weekly",
  Monthly = "monthly",
  Quarterly = "quarterly",
  SemiAnnually = "semiAnnually",
  Annually = "annually",
  Custom = "custom",
}
```

### CreateSubscriptionParams

```typescript
interface CreateSubscriptionParams {
  amount: BN;
  token: PublicKey;
  recipient: PublicKey;
  gateway: PublicKey;
  interval: PaymentInterval;
  customInterval?: number;
  maxRenewals?: number;
  memo?: string;
  startTime?: Date;
  approvalAmount?: BN;
  executeImmediately?: boolean;
}
```

### CreateMilestoneParams

```typescript
interface CreateMilestoneParams {
  milestoneAmounts: BN[];
  milestoneTimestamps: BN[];
  releaseCondition: number;
  token: PublicKey;
  recipient: PublicKey;
  gateway: PublicKey;
  memo?: string;
  approvalAmount?: BN;
  executeImmediately?: boolean;
}
```

### CreatePayAsYouGoParams

```typescript
interface CreatePayAsYouGoParams {
  maxAmountPerPeriod: BN;
  maxChunkAmount: BN;
  periodLengthSeconds: BN;
  token: PublicKey;
  recipient: PublicKey;
  gateway: PublicKey;
  memo?: string;
  approvalAmount?: BN;
}
```
