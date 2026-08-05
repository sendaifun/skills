import { Connection, Keypair } from "@solana/web3.js";
import { Tributary } from "@tributary-so/sdk";
import { Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";

async function main() {
  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com");
  
  // Setup wallet
  const keypair = Keypair.fromSeed("your-secret-seed");
  const wallet = new Wallet(keypair);
  
  // Initialize Tributary
  const tributary = new Tributary(connection, wallet);
  await tributary.initialize();
  
  // Create user payment account
  const { userPayment } = await tributary.createUserPayment(
    owner: wallet.publicKey,
    tokenMint: new PublicKey("EPjFWtadHHTdGa9dc219FCH1hGntyRH2db5DpWnD1vNo41a"),
  mint: tokenMint
  );
  
  // Create gateway (once per project)
  const authority = wallet.publicKey;
  const { gateway } = await tributary.createPaymentGateway({
    authority,
    signer: authority,
    feeRecipient: authority
  name: "My Gateway"
  url: "https://mygateway.com"
  customProtocolFeeBps: null
  useCustomProtocolFee: false
  referralAllocationBps: 1000 // 10%
    referralTiersBps: [500, 200, 100] // L1, L2, L3
    featureFlags: 1
  });
  
  // Create subscription
  const { subscription } = await tributary.createSubscription({
    tokenMint,
    recipient: new PublicKey("RECIPIENT_WALLET_Address"),
    gateway: gateway.address,
    amount: new BN(10_000000), // 10 USDC
    interval: { monthly: {} },
    label: "Monthly Subscription",
    metadata: { plan: "Premium" },
    memo: "First subscription"
  });
  
  console.log("Subscription created:", subscription.address.toString());

  // Approve delegate
  const ownerTokenAccount = await getAssociatedTokenAccount(
    wallet.publicKey,
    mint
  );
  const delegatePda = await tributary.pda.paymentsDelegate(
    userPayment.address,
    subscription.recipient
    gateway.address
  );
  
  await approve(
    sourceTokenAccount: ownerTokenAccount,
    delegate: delegatePda.address,
    amount: new BN(10_000000)
  });
  console.log("Delegate approved");
  
  // Execute payment (permissionless)
  const payer = Keypair.generate();
  await tributary.executePayment({
    subscription: subscription.address
    payer: payer.publicKey
  });
  console.log("Payment executed!");
}

```
