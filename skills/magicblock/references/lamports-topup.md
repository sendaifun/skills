# Topping Up a Delegated Account with Lamports

To add lamports to a delegated account, submit a base-layer transaction through the Ephemeral SPL
Token program. The program funds and delegates a sponsored, single-use lamports PDA, allowing the ER
to credit the destination. This supports delegated fee payers described in
[delegation.md](delegation.md).

## When to use

- A delegated PDA (e.g. a fee payer for sponsored commits) is running low on lamports on the ER side.
- You need to top up the lamport balance of a delegated account that already exists on base layer and has a delegation record.
- The payer must fund a single-use top-up without destination participation.

## SDK helper

The SDK exposes `lamportsDelegatedTransferIx` (instruction discriminator `20`) which:

1. Creates a one-shot lamports PDA derived from `[b"lamports", payer, destination, salt]` under the Ephemeral SPL Token program.
2. Funds it with `amount` lamports from the payer.
3. Delegates the lamports PDA so the ER can consume it and credit the destination's delegated balance.

```typescript
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  lamportsDelegatedTransferIx,
  deriveLamportsPda,
} from "@magicblock-labs/ephemeral-rollups-sdk";

export function lamportsDelegatedTransferIx(
  payer: PublicKey,
  destination: PublicKey,  // delegated destination on base layer
  amount: bigint,          // lamports
  salt: Uint8Array,        // exactly 32 bytes, one per logical request
): TransactionInstruction
```

That is the synchronous `@solana/web3.js` flavor. The SDK's Kit flavor instead accepts `Address` and
returns `Promise<Instruction>`; do not mix the two type surfaces in one example.

## Full example

Generate and persist the 32-byte salt when creating the logical request, before submission. Pass the
same salt back into the operation only after reconciling an unknown result and proving the original
transaction did not land.

```typescript
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  lamportsDelegatedTransferIx,
  deriveLamportsPda,
} from "@magicblock-labs/ephemeral-rollups-sdk";

async function topUpDelegatedAccount(
  connection: Connection,        // base-layer connection
  payer: Keypair,
  destination: PublicKey,        // delegated account to top up
  amountLamports: bigint,
  salt: Uint8Array,              // persisted with the logical request
) {
  if (amountLamports <= 0n) {
    throw new Error("amountLamports must be positive");
  }
  if (salt.length !== 32) {
    throw new Error("salt must be exactly 32 bytes");
  }

  const [lamportsPda] = deriveLamportsPda(payer.publicKey, destination, salt);

  const ix = lamportsDelegatedTransferIx(
    payer.publicKey,
    destination,
    amountLamports,
    salt,
  );

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;

  // Submit to the base layer.
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });

  return { sig, lamportsPda };
}
```

## Working reference

A full working integration is in `magicblock-engine-examples/spl-tokens/anchor/app/src/App.tsx` — search for `handleLamportsTransfer`. It demonstrates:

- Generating the salt with `crypto.getRandomValues(new Uint8Array(32))`
- Deriving the lamports PDA with `deriveLamportsPda` for logging/debugging
- Submitting the single-instruction transaction to the base-layer connection
- Verifying the payer has enough lamports before submitting

Production callers should additionally persist the logical request, salt, derived PDA, and signature
before treating a transport failure as safe to retry.

## Common errors

### Submit to the base-layer RPC, not the ER

The instruction creates accounts and triggers delegation on base layer. Sending it to the ER fails.
Use the same `Connection` used for delegation.

### Salt must be exactly 32 bytes

`lamportsDelegatedTransferIx` throws if `salt.length !== 32`. Always generate with `crypto.getRandomValues(new Uint8Array(32))`.

### Use one salt per logical top-up

The lamports PDA is derived from `[b"lamports", payer, destination, salt]`. Reusing a
`(payer, destination, salt)` triple while its prior PDA is active or cleanup is still in flight resolves
to the same address and fails. Generate a fresh salt for each new logical top-up, then persist the salt,
derived PDA, amount, and submitted signature for that request. If submission status is unknown, reconcile
the original signature, PDA lifecycle, and destination balance before retrying. Rebuild with the same
salt only after proving the original transaction did not land; do not create a newly salted top-up for
an unresolved request.

### Destination must already be delegated

The instruction reads the destination's delegation record to select the ER. It fails if the destination
is not delegated. Delegate first, then top up.

### Payer pays gas + amount + fixed setup charge

The payer pays the base-layer transaction fee, the `amount` being shuttled, and the current fixed
`300_000`-lamport sponsored-transfer setup charge. Verify current program constants before production
use and require a balance comfortably above that total.

### Reject zero-value top-ups

The program rejects `amount == 0` before making the fixed `300_000`-lamport setup transfer. A failed
submitted transaction can still charge the ordinary network transaction fee, but it does not pay that
setup charge. Keep the application wrapper's stricter `amount > 0` check so invalid requests never need
to be submitted.

### `amount` is in lamports, not SOL

1 SOL = 1,000,000,000 lamports. Keep this in mind when sourcing the value from a UI.

## Implementation checklist

### Required

- Generate and persist one fresh 32-byte salt per logical top-up via `crypto.getRandomValues`
- Submit the transaction to the base-layer connection
- Verify the destination is delegated before topping up
- Pre-flight a balance check on the payer that includes amount, setup charge, and transaction fee
- Reconcile an unknown submission outcome before retrying the same logical request

### Avoid

- Reusing one salt across distinct logical top-ups
- Generating a new salt while an earlier submission outcome remains unknown
- Submitting the transaction to the ER connection
- Using this helper for non-delegated destinations; use `SystemProgram.transfer`
- Using this helper for SPL token top-ups; use the SDK's SPL transfer flows
