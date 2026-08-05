# Tributary SDK API Reference

# Tributary Class

Core methods for interacting with the Tributary recurring payments protocol.

## Constructor

```typescript
constructor(connection: Connection, wallet: Keypair | anchor.Wallet)
```

Creates a new Tributary SDK instance.

**Parameters:**

- `connection`: Solana RPC connection
- `wallet`: Keypair or Anchor Wallet for signing transactions

## Properties

| Property     | Type             | Description                 |
| ------------ | ---------------- | --------------------------- |
| `program`    | `anchor.Program` | Anchor program instance     |
| `programId`  | `PublicKey`      | Deployed program public key |
| `connection` | `Connection`     | Solana RPC connection       |
| `provider`   | `AnchorProvider` | Anchor provider with wallet |

## Methods

### Initialization

```typescript
initialize(admin: PublicKey): Promise<TransactionInstruction>
```

Initialize the Tributary protocol.

**Parameters:**

- `admin`: Admin public key

**Returns:** Transaction instruction

---

### User Payment Management

```typescript
createUserPayment(tokenMint: PublicKey): Promise<TransactionInstruction>
```

Create a user payment account for a specific token.

**Parameters:**

- `tokenMint`: Token mint public key

**returns:** Transaction instruction

```typescript
createReferralAccount(
  gateway: PublicKey,
  referralCode: string,
  referrer?: PublicKey
): Promise<TransactionInstruction>
```

Create referral account with optional referrer.

**Parameters:**

- `gateway`: Gateway public key
- `referralCode`: 6-character alphanumeric code
- `referrer`: Optional referrer public key (L1 referrer)

**returns:** Transaction instruction

---

### Payment Gateway Management

```typescript
createPaymentGateway(
  authority: PublicKey,
  gatewayFeeBps: number,
  gatewayFeeRecipient: PublicKey,
  name: string,
  url: string
): Promise<TransactionInstruction>
```

Create a payment gateway.

**Parameters:**

- `authority`: Gateway authority public key
- `gatewayFeeBps`: Fee in basis points (100 bps = 1%)
- `gatewayFeeRecipient`: Fee recipient public key
- `name`: Display name (max 32 chars)
- `url`: Website URL (max 64 chars)

**Returns:** Transaction instruction

```typescript
updateGatewayReferralSettings(
  gatewayAuthority: PublicKey,
  featureFlags: number,
  referralAllocationBps: number,
  referralTiersBps: [number, number, number]
): Promise<TransactionInstruction>
```

Update gateway referral settings.

**Parameters:**

- `gatewayAuthority`: Gateway authority public key
- `featureFlags`: Feature flags (bit 0 = referral enabled)
- `referralAllocationBps`: Referral allocation (0-2500 bps)
- `referralTiersBps`: Array of 3 values [L1, L2, L3] summing to 10000

**returns:** Transaction instruction

---

### Subscription Management

```typescript
createSubscription(
  tokenMint: PublicKey,
  recipient: PublicKey,
  gateway: PublicKey,
  amount: BN,
  autoRenew: boolean,
  maxRenewals: number | null,
  paymentFrequency: PaymentFrequency,
  memo: number[],
  startTime?: BN | null,
  approvalAmount?: BN,
  executeImmediately?: boolean,
  referralCode?: string
): Promise<TransactionInstruction[]>
```

Create a complete subscription with all setup.

**Parameters:**

- `tokenMint`: Token mint public key
- `recipient`: Payment recipient public key
- `gateway`: Payment gateway public key
- `amount`: Payment amount per interval
- `autoRenew`: Auto-renewal flag
- `maxRenewals`: Maximum renewals (null = unlimited)
- `paymentFrequency`: Payment frequency enum
- `memo`: Memo bytes (max 64)
- `startTime`: First payment time (default: now)
- `approvalAmount`: Token approval amount (auto-calculated if not provided)
- `executeImmediately`: Execute first payment immediately
- `referralCode`: Optional referral code

**Returns:** Array of transaction instructions

```typescript
getCreateSubscriptionPolicyInstruction(
  tokenMint: PublicKey,
  recipient: PublicKey,
  gateway: PublicKey,
  amount: BN,
  autoRenew: boolean,
  maxRenewals: number | null,
  paymentFrequency: PaymentFrequency,
  memo: number[],
  startTime?: BN | null
): Promise<TransactionInstruction>
```

Get subscription policy instruction only (low-level).

---

### Milestone Payments

```typescript
createMilestone(
  tokenMint: PublicKey,
  recipient: PublicKey,
  gateway: PublicKey,
  milestoneAmounts: BN[],
  milestoneTimestamps: BN[],
  releaseCondition: number,
  memo: number[],
  approvalAmount?: BN,
  executeImmediately?: boolean,
  referralCode?: string
): Promise<TransactionInstruction[]>
```

Create milestone payment with full setup.

**Parameters:**

- `tokenMint`: Token mint public key
- `recipient`: Payment recipient public key
- `gateway`: Payment gateway public key
- `milestoneAmounts`: Array of amounts (1-4 milestones)
- `milestoneTimestamps`: Array of timestamps
- `releaseCondition`: Bitmap (bit0=date, bits1-3=signer type)
- `memo`: Memo bytes
- `approvalAmount`: Token approval amount
- `executeImmediately`: Execute first milestone if due
- `referralCode`: Optional referral code

**Returns:** Array of transaction instructions

---

### Pay-as-you-go

```typescript
createPayAsYouGo(
  tokenMint: PublicKey,
  recipient: PublicKey,
  gateway: PublicKey,
  maxAmountPerPeriod: BN,
  maxChunkAmount: BN,
  periodLengthSeconds: BN,
  memo: number[],
  approvalAmount?: BN,
  referralCode?: string
): Promise<TransactionInstruction[]>
```

Create pay-as-you-go billing with full setup.

**Parameters:**

- `tokenMint`: Token mint public key
- `recipient`: Payment recipient public key
- `gateway`: Payment gateway public key
- `maxAmountPerPeriod`: Maximum amount per period
- `maxChunkAmount`: Maximum per single claim
- `periodLengthSeconds`: Period length
- `memo`: Memo bytes
- `approvalAmount`: Token approval amount
- `referralCode`: Optional referral code

**Returns:** Array of transaction instructions

---

### Payment Execution

```typescript
executePayment(
  paymentPolicyPda: PublicKey,
  paymentAmount?: BN,
  recipient?: PublicKey,
  tokenMint?: PublicKey,
  gateway?: PublicKey,
  user?: PublicKey
): Promise<TransactionInstruction[]>
```

Execute a payment.

**Parameters:**

- `paymentPolicyPda`: Payment policy public key
- `paymentAmount`: Amount (optional for subscription/milestone)
- `recipient`: Payment recipient (optional if in policy)
- `tokenMint`: Token mint (optional if in policy)
- `gateway`: Gateway (optional if in policy)
- `user`: User public key (optional if in policy)

**Returns:** Array of transaction instructions

---

### PDA Utilities

```typescript
getConfigPda(): PdaResult
```

Get program config PDA.

```typescript
getGatewayPda(gatewayAuthority: PublicKey): PdaResult
```

Get gateway PDA.

```typescript
getUserPaymentPda(user: PublicKey, tokenMint: PublicKey): PdaResult
```

Get user payment PDA.

```typescript
getPaymentPolicyPda(userPayment: PublicKey, policyId: number): PdaResult
```

Get payment policy PDA.

```typescript
getPaymentsDelegatePda(): PdaResult
```

Get payments delegate PDA.

```typescript
getReferralPda(gateway: PublicKey, referralCode: Buffer): PdaResult
```

Get referral account PDA.

---

### Fetch Methods

```typescript
getPaymentGateway(gatewayPda: PublicKey): Promise<PaymentGateway | null>
```

Fetch payment gateway account.

```typescript
getUserPayment(userPaymentPda: PublicKey): Promise<UserPayment | null>
```

Fetch user payment account.

```typescript
getPaymentPolicy(policyPda: PublicKey): Promise<PaymentPolicy | null>
```

Fetch payment policy account.

```typescript
getReferralAccount(referralPda: PublicKey): Promise<ReferralAccount | null>
```

Fetch referral account.

```typescript
getPaymentPoliciesByUserPayment(userPaymentPda: PublicKey): Promise<Array<{ pubkey: PublicKey, account: PaymentPolicy }>>
```

Fetch all policies for a user payment.

```typescript
getReferralAccountByCode(gateway: PublicKey, code: string): Promise<ReferralAccount | null>
```

Fetch referral account by code.

```typescript
getReferralAccountByOwner(gateway: PublicKey, owner: PublicKey): Promise<ReferralAccount | null>
```

Fetch referral account by owner.

---

### Wallet Management

```typescript
updateWallet(wallet: Keypair | anchor.Wallet): Promise<void>
```

Update the wallet used by SDK.

---

### Validation

```typescript
validateReferralCode(code: string): boolean
```

Validate referral code format (6 alphanumeric characters).

---

## Next Steps

- [TypeScript Types](./types-reference.md) - Complete type definitions
- [React Components](./react-hooks.md) - UI component reference
- [CLI Commands](./cli-commands.md) - CLI documentation
- [Example: React App](../templates/react-app-template.tsx) - Production template
