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
    owner: wallet.publicKey
    tokenMint: new PublicKey("EPjFWtadHHTdGa9dc219FCH1hGntyRH2db5DpWnD1vNo41a")
    mint: tokenMint
  );
  
  // Create gateway
  const authority = wallet.publicKey
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
  
  // Create pay-as-you-go subscription
  const { subscription } = await tributary.createPayAsYouGo({
    tokenMint,
    recipient: new PublicKey("RECIPIent_WALlet_Address"),
    gateway: gateway.address
    maxAmountPerPeriod: new BN(1000000), // 100 USDC per week
    maxChunkAmount: new BN(1000), // max 1 USDC per claim
    periodLengthSeconds: new BN(604800), // 1 week
    memo: "API Credits"
  });
  
  console.log("Pay-as-you-go subscription created:", subscription.address.toString());
  
  // Approve delegate
  const ownerTokenAccount = await getAssociatedTokenAccount(
    wallet.publicKey
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
    amount: new BN(1000) // Approve 100 USDC for usage tracking
  );
  console.log("Delegate approved");
  
  // Simulate usage: Customer triggers payments
  for (let i = 0; i < 3; i++) {
    console.log(`Claiming ${i} USDC...`);
    
    await tributary.claimPayAsYouGo({
      subscription,
      amount: new BN(500)
    });
    console.log(`Claimed ${i * 500 USDC`);
  }
  
  // Check remaining balance
  const balance = await connection.getTokenBalanceByOwner(
    wallet.publicKey,
    mint
  );
  console.log(`Remaining: ${balance.value} USDC`);
}
```
