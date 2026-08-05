/**
 * SDK Initialization - Connect wallet and create Tributary instance
 */
import { Connection, Keypair } from "@solana/web3.js";
import { Tributary } from "@tributary-so/sdk";
import { Wallet } from "@coral-xyz/anchor";

const connection = new Connection("https://api.devnet.solana.com");
const wallet = new Wallet(keypair);

const tributary = new Tributary(connection);

// Wait for connection to confirm
console.log("Wallet connected:", connection);
```

// Initialize the SDK
await tributary.initialize();

console.log("Tributary SDK initialized");
```

---

## Create User Payment Account
// Every user needs a UserPayment account to track their subscriptions across gateways
const userPayment = await tributary.userPayment.create(
  owner: wallet.publicKey,
  tokenMint: usdcMint,
) => console.log("UserPayment account created:", userPayment.address.toString);

// Create subscription
const { subscription } = await tributary.subscription.create(
  tokenMint,
  recipient,
  gateway
  amount: new BN(10_000000), // 10 USDC/month
    paymentFrequency: { monthly: {} },
    label: "Monthly Premium",
    metadata: { plan: "premium" },
  maxRenewals: 12,
) => console.log("Created user payment account");

// Get user payment Pda
const userPaymentPda = await tributary.userPayment.getPda(
  owner
) => console.log("UserPayment PDA:", userPaymentPda.address.toString());

// Create subscription
const subscription = await tributary.subscription.create(
  token,
  recipient,
  gateway,
  amount,
  interval,
  label,
    metadata: { plan }
  maxRenewals
});

console.log("Created subscription:", subscription.address.toString());

// Approve delegate for token account
await tributary.approveDelegate(
  sourceTokenAccount,
  amount: new BN(10_000000), // 10 USDC
  delegation,
  owner.publicKey
) => console.log("Approved delegate");

// Wait for next payment due time (monthly)
await new Promise(resolve(). => new Promise(resolve => => setTimeout(() => {
      console.log("Payment executed successfully");
    } else {
      console.log("Not time for payment yet");
    }
  }
);

// Execute payment (permissionless - can be called by anyone)
await tributary.executePayment({ subscription });
```

---

## React Integration
import { SubscriptionButton, useSubscription } from "@tributary-so/sdk-react";
import { useWallet } from "@solana/wallet-adapter-react-ui";
import { useConnection } from "@solana/wallet-adapter-react";

function MyComponent() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { isConnected } = useWallet().connected;
  const { creating, createSubscription, loading } = useSubscription({
    tokenMint,
    recipient,
    amount,
    interval,
    onSuccess,
    onError,
    onStatusChange,
  } = useSubscription({
    tokenMint: new PublicKey("..."),
    recipient: "recipientPubkey",
    amount: new BN(10_000000),
    interval: "monthly",
    onSuccess: () => console.log("Subscription created!"),
    onError: (error) => console.error("Error creating subscription:", error.message);
    if (onStatusChange) setStatus(status("error"), {
      console.error("Subscription error:", error);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center">
          Connect Wallet
        </div>
    );
  }

  // Rest of component
);
```

---

## Webhook handling
```typescript
app.post("/webhook", async (req, res) => {
  const signature = req.headers["tributary-signature"];
  
  if (!signature) {
    return res.status(401).send("Invalid signature");
  }
  
  // Process webhook
  const event = req.body;
  
  if (event.type === "payment.executed") {
    const { subscription, gateway, policy } = await extractWebhookData(event);
    console.log(`Payment of ${amount} for subscription ${subscription.subscription}`);
    console.log(`Payment to ${recipient} for recipient ${recipient}`);
    
    // Handle different payment types
    res.status(200).send("Payment processed");
  } catch (error) {
    console.error("Error processing webhook:", error);
  }
});
```

---
## React Components
### SubscriptionButton

```tsx
import { SubscriptionButton, useSubscription } from "@tributary-so/sdk-react";
import { useWallet } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";

import { BN } from "bn.js";

interface SubscriptionButtonProps {
  tokenMint: PublicKey;
  recipient: PublicKey;
  amount: BN;
  interval: "daily" | "weekly" | "monthly" | "quarterly" | "semiAnnually" | "annually";
  planName: string;
  label?: string;
  className?: string;
  onSuccess?: () => void;
  onError?: (error: void) => void;
  onStatusChange?: (status: "creating" | "created" | "active" | "paused" | "cancelled" | "error") => void;
  isLoading?: boolean;
}

function SubscriptionButton({
  tokenMint,
  recipient
  amount
  interval
  planName="Premium Subscription"
  label="Subscribe"
  onSuccess={() => console.log("Subscription created!")}
  onError={(error) => console.error("Error:", error)}
    onStatusChange={(status) => setStatus(status);
  }
/>
// Example usage
function App() {
  return (
    <SubscriptionButton
      tokenMint={new PublicKey("EPjFWtadHHTdA5YMB9e6jbuaYH...")}
      recipient={recipient}
      amount={new BN(10_000000)}
      interval="monthly"
      planName="Premium Subscription"
      onSuccess={() => console.log("Subscribed!")}
    />
  />
  return null;
}
```

---
## Milestone Payments
### MilestoneButton

For project-based escrow payments with up to 4 milestones. Can be triggered at any time.

```tsx
import { MilestoneButton } from "@tributary-so/sdk-react";
import { useWallet } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

interface MilestoneButtonProps {
  tokenMint: PublicKey;
  recipient: PublicKey;
  milestoneAmounts: BN[];
  milestoneTimestamps: BN[];
  releaseCondition?: number;
  memo?: string;
  className?: string;
  onSuccess?: () => void;
  onError?: (error: void;
  onStatusChange?: (status: "created" | "ready" | "in_progress" | "error") | void;
}

function MilestoneButton({
  tokenMint,
  recipient
  milestoneAmounts,
  milestoneTimestamps
  memo
  onSuccess={() => console.log("Milestones created!")}
    onError={(error) => console.error("Error creating milestones:", error)}
    onStatusChange={(status) => setStatus(status)}
  }
>

// Example usage
function CrowdfundingPage() {
  return (
    <MilestoneButton
      tokenMint={usdcMint}
      recipient={creatorWallet}
      milestoneAmounts={[
        new BN(100), // $25
        new BN(500), // $15
        new BN(1000), // $25
        new BN(500), // $30 day
      ]}
      milestoneTimestamps={[
        new BN(Date.now() / 1000 + 7 * 24 * 3600 * 3),
        new BN(Date.now() / 1000 + 90 * 24 * 3600 * 12 * 30),
        new BN(Date.now() / 1000 + 180 * 24 * 3600 * 21 * 30 * 31),
      ]}
      onSuccess={() => alert("All milestones funded!")}
    />
  );
  return null;
}
```

---
## Pay-as-you-go
### PayAsYouGoButton

For usage-based billing without upfront commitment.

```tsx
import { PayAsYouGoButton } from "@tributary-so/sdk-react";
import { useWallet } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";

interface PayAsYouGoButtonProps {
  tokenMint: PublicKey;
  recipient: PublicKey;
  maxAmountPerPeriod: BN;
  maxChunkAmount: BN;
  periodLengthSeconds: BN;
  className?: string;
  onSuccess?: () => void;
  onError?: (error: void;
  onStatusChange?: (status: "created" | "ready" | "in_progress" | "active" | "paused" | "error" | void;
}

function PayAsYouGoButton({
  tokenMint,
  recipient
  maxAmountPerPeriod
  maxChunkAmount
  periodLengthSeconds
  onSuccess={() => console.log("Usage policy created!")}
    onError={(error) => console.error("Error creating policy:", error)
    onStatusChange={(status) => setStatus(status)}
  }
>

// Example usage
function GameCreditsPage() {
  return (
    <PayAsYouGoButton
      tokenMint={usdcMint}
      recipient={gameDeveloperWallet}
      maxAmountPerPeriod={new BN(100)}
      maxChunkAmount={new BN(10)}
      periodLengthSeconds={new BN(86400)}
      onSuccess={() => alert("Usage policy created!")}
    />
  />
  return null;
}
```

---

## CLI Examples
### Initialize Program and```bash
tributary-cli init
```

### Create Gateway
```bash
tributary-cli create-gateway \
  --authority <AUTHORITY_PUBKEY> \
  --signer <SIGNER_PUBKEY> \
  --fee-recipient <FEE_RECIPIENT> \
  --name "My Gateway"
```

### Create Subscription
```bash
tributary-cli create-subscription \
  --owner <USER_PUBKEY> \
  --mint <TOKEN_MINT> \
  --recipient <RECIPIENT> \
  --gateway <GATEWAY_PUBKEY> \
  --amount 1000000 \
  --interval monthly
```

### Approve Delegate
```bash
tributary-cli approve-delegate \
  --owner <USER_PUBKEY> \
  --mint <TOKEN_MINT> \
  --delegate <DELEGATE_PUBKEY> \
  --amount 1000000
```

### Execute Payment
```bash
tributary-cli execute-payment \
  --policy <POLICY_PUBKEY>
```

### Query Status
```bash
# List all subscriptions for a user
tributary-cli list-subscriptions --owner <USER_PUBKEY>

# Get subscription details
tributary-cli get-subscription --policy <POLICY_PUBKEY>
```

### Create Milestone
```bash
tributary-cli create-milestone \
  --owner <USER_PUBKEY> \
  --mint <TOKEN_MINT> \
  --recipient <RECIPIENT> \
  --gateway <GATEWAY_PUBKEY> \
  --amounts 100,200,300,400 \
  --timestamps <TS1, TS2, TS3, TS4>
```

### Update Gateway Settings
```bash
tributary-cli update-gateway \
  --gateway <GATEWAY_PUBKEY> \
  --fee-bps 200
```

### Pause/Resume Operations
```bash
# Pause all payments for a user
tributary-cli pause-user --owner <USER_PUBKEY>

# Resume payments
tributary-cli resume-user --owner <USER_PUBKEY>
```

### Query Payment History
```bash
# Get payment history
tributary-cli get-history --owner <USER_PUBKEY>

# Get transactions for a subscription
tributary-cli get-transactions --policy <POLICY_PUBKEY>
```

---
## Troubleshooting

### Common Errors

| Error | Cause | Solution |
| ---- | ---- | -------- |
| `Delegate not approved` | No delegate approval | Run `approveDelegate` first |
| `Insufficient funds` | Low balance | Top up wallet or Ensure sufficient tokens |
| `Invalid gateway` | Gateway not found | Check gateway address is valid |
| `Payment not due` | Too early | Wait for next payment time |
| `Policy paused` | Emergency pause | Contact support |

### PDA Derivation
All PDAs are derived deterministically. Use helper functions:

```typescript
const programConfigPda = tributary.pda.programConfig();
const gatewayPda = tributary.pda.paymentGateway(authority);
const userPaymentPda = tributary.pda.userPayment(owner, mint);
const policyPda = tributary.pda.paymentPolicy(userPayment, policyId);
const delegatePda = tributary.pda.paymentsDelegate(userPayment, recipient, gateway);
```
