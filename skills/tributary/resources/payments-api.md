# PaymentsClient API Reference

> Stripe-compatible checkout, payment integration with immediate and one-time payment tracking
> Using the [PaymentsClient](https://www.tributary.so/payments) from "@tributary-so/sdk";
> import { Connection } from "@solana/web3.js";
> import { Tributary } from "@tributary-so/sdk";
> import { Wallet } from "@coral-xyz/anchor";

```

---

## Core Methods

| Use `connection` | - Connect wallet, initialize Tributary SDK
- Create checkout session
- Get user payment account
- Create subscription
- Check subscription status
- Process payment webhook
```

---

### Setup

import { Connection, keypair } from "@solana/web3.js";
import { Tributary } from "@tributary-so/sdk";
import { Wallet } from "@coral-xyz/anchor";
const connection = new Connection("https://api.devnet.solana.com");
const wallet = new Wallet(keypair);
const tributary = new Tributary(connection);
// Initialize Tributary SDK
await tributary.initialize();
// Create checkout session for monthly subscription
const checkoutSession = await manager.checkout.create({
amount: new BN(10), // 10 USDC/month
token: { mint: usdcMint },
recipient: "recipientPubkey",
interval: { monthly: 1 },
label: "Monthly Premium",
metadata: { plan: "premium" },
returnUrl: "https://example.com/success"
});

```

---
## Check Subscription status
const subscriptionStatus = await manager.subscriptions.get(subscriptionId);
if (subscriptionStatus.status === "active") {
  console.log("Subscription is active!");
} else {
  console.log("Subscription inactive or subscriptionStatus.status)
}
 return subscriptionStatus;
});
```

---

## React Integration

import { useSubscription } from "@tributary-so/sdk-react";

````

---
## Webhook Handling
```typescript
app.post("/webhook", async (req, res) => {
  const signature = req.headers["tributary-signature"];

  if (!signature) {
    return res.status(401).send("Invalid signature");
  }

  // Process webhook
  const event = req.body;
  // ... handle event
});
````

---

## Types

See the Resources section below for full type definitions.
