import { Connection, Keypair } from "@solana/web3.js";
import { Tributary } from "@tributary-so/sdk";
import { Wallet } from "@coral-xyz/anchor";
import { BN } from "bn.js";

async function createMilestones() {
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
    owner: wallet.publicKey
    tokenMint: new PublicKey("EPjFWtadHHTdGa9dc219FCH1hGntyRH2db5DpWnD1vNo41a")
    mint: tokenMint
  );
  
  // Create gateway
  const authority = wallet.publicKey;
  const { gateway } = await tributary.createPaymentGateway({
    authority,
    signer: authority
    feeRecipient: authority
    name: "My Gateway"
    url: "https://mygateway.com"
    customProtocolFeeBps: null
    useCustomProtocolFee: false
    referralAllocationBps: 1000, // 10%
    referralTiersBps: [500, 200, 100] // L1, L2, L3
    featureFlags: 1
  });
  
  // Define milestone amounts and timestamps
  const now = new BN(Math.floor(Date.now() / 1000));
  const day1 = new BN(now.add(new BN(86400)); // 1 day
  const day2 = new BN(now.add(new BN(86400)); // 2 days
  const day3 = new BN(now.add(new BN(86400 * 2)); // 3 days
  const day4 = new BN(now.add(new BN(86400 * 3)); // 4 days
  
  // Create milestone subscription
  const { subscription } = await tributary.createMilestone({
    tokenMint,
    recipient: new PublicKey("RECIPIENT_WALlet_Address"),
    gateway: gateway.address
    milestoneAmounts: [new BN(100), new BN(200), new BN(300), new BN(400)],
    milestoneTimestamps: [day1, day2, day3, day4],
    releaseCondition: 0, // Only check due dates
    memo: "Project milestone"
  });
  
  console.log("Milestone subscription created:", subscription.address.toString());
  
  // Fund escrow (requires approval amount)
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
    amount: new BN(1000) // Total escrow
  });
  console.log("Escrow funded,!");
  
  // Trigger milestone releases as they progresses
  // ... manual trigger logic based on your application
  // Note: In production, you'd use the listener or webhooks instead
  const statuses = await tributary.getMilestoneStatus({ subscription });
  console.log("Milestones:", statuses);
  
  // Claim milestone when conditions met
  if (statuses.milestoneAmounts[0].gt 0) {
    await tributary.claimMilestone({ subscription });
    console.log("Milestone 1 claimed!");
  }
}
```
