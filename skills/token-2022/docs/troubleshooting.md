# Token-2022 Troubleshooting

Common failures when creating and managing Token-2022 mints, and how to fix
them. Each entry lists the symptom, the cause, and the fix.

## Wrong program ID on ATA / transfer / mint-to

**Symptom:** `TokenInvalidAccountOwnerError`, `IncorrectProgramId`, an
"account is owned by the wrong program" error, or a derived ATA address that
doesn't match what the explorer shows.

**Cause:** A helper defaulted to the classic `TOKEN_PROGRAM_ID` because the
program ID argument was omitted, or `TOKEN_PROGRAM_ID` was passed explicitly to
an operation on a Token-2022 mint. The ATA derivation includes the token program
ID, so the address itself differs between programs.

**Fix:** Pass `TOKEN_2022_PROGRAM_ID` to every call touching the mint:

```typescript
const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
createAssociatedTokenAccountInstruction(payer, ata, owner, mint, TOKEN_2022_PROGRAM_ID);
createMintToInstruction(mint, ata, authority, amount, [], TOKEN_2022_PROGRAM_ID);
createTransferCheckedInstruction(src, mint, dst, owner, amount, decimals, [], TOKEN_2022_PROGRAM_ID);
```

## Insufficient mint account size

**Symptom:** `InvalidAccountData`, the extension init instruction fails, or the
transaction reverts during mint creation.

**Cause:** The account was allocated with the wrong size — either a fixed size,
or `getMintLen([])` without listing the extensions you initialize.

**Fix:** Size with the full extension list, and only the extensions you actually
initialize:

```typescript
const mintLen = getMintLen([
  ExtensionType.TransferFeeConfig,
  ExtensionType.MetadataPointer,
]);
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
```

## Extension initialized after the mint

**Symptom:** Extension init instruction fails even though the size is correct;
the mint appears initialized but extensions are missing.

**Cause:** `createInitializeMintInstruction` ran **before** an extension init.
Once the mint is initialized, extensions can no longer be added.

**Fix:** Order the instructions: `createAccount` → all extension inits →
`createInitializeMintInstruction` (last) → (variable-length metadata init, if
any). You cannot add an extension to an existing mint — recreate it.

## Metadata lamports / account not rent-exempt

**Symptom:** Metadata `createInitializeInstruction` fails, or
"insufficient funds for rent" during creation with on-chain metadata.

**Cause:** Rent was funded for `getMintLen([...])` only. On-chain Token Metadata
is variable-length and lives beyond the fixed mint size, so the account must hold
enough lamports to remain rent-exempt after the metadata reallocs it larger.

**Fix:** Fund rent for the mint plus the metadata blob, but still allocate only
`mintLen` of space in `createAccount`:

```typescript
import { TYPE_SIZE, LENGTH_SIZE, getMintLen, ExtensionType } from '@solana/spl-token';
import { pack, type TokenMetadata } from '@solana/spl-token-metadata';

const mintLen = getMintLen([ExtensionType.MetadataPointer]);
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

SystemProgram.createAccount({
  fromPubkey: payer.publicKey,
  newAccountPubkey: mint,
  space: mintLen,           // allocate fixed size only...
  lamports,                 // ...but fund rent for the larger final size
  programId: TOKEN_2022_PROGRAM_ID,
});
```

## Transfer to a non-existent ATA

**Symptom:** Transfer fails because the destination account doesn't exist.

**Cause:** The recipient's associated token account was never created. Unlike
some SDKs, a bare transfer instruction does not auto-create the destination.

**Fix:** Create the destination ATA first (in the same transaction is fine), or
use the convenience helper:

```typescript
const dest = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_2022_PROGRAM_ID);
tx.add(
  createAssociatedTokenAccountInstruction(payer.publicKey, dest, recipient, mint, TOKEN_2022_PROGRAM_ID),
);
// or, off-chain:
// await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
```

## Transfer of a non-transferable token rejected

**Symptom:** "Transfer is disabled for this mint" or a transfer instruction
reverts for a soulbound token.

**Cause:** The mint has the `NonTransferable` extension. This is by design.

**Fix:** Expected behavior. Non-transferable mints support mint and burn only.
If you need transfers, do not enable `NonTransferable`.

## Transfer fee mismatch

**Symptom:** `TransferFeeExceedsMaximum`, or the fee-bearing transfer reverts.

**Cause:** The fee passed to `createTransferCheckedWithFeeInstruction` doesn't
match what the program computes from the configured basis points and cap.

**Fix:** Compute the fee the same way the program does and respect the maximum:

```typescript
let fee = (amount * BigInt(feeBasisPoints)) / 10_000n;
if (fee > maxFee) fee = maxFee;
```

## Payer has no SOL (devnet)

**Symptom:** Every transaction fails with insufficient funds; a freshly
generated payer has a zero balance.

**Cause:** `Keypair.generate()` creates an unfunded account.

**Fix:** Airdrop on devnet, or load a funded keypair:

```typescript
const sig = await connection.requestAirdrop(payer.publicKey, 2_000_000_000); // 2 SOL

// Best-effort DEVNET convenience: poll the airdrop's own signature status until
// it confirms or a timeout elapses. Don't confirm an airdrop with a freshly
// fetched blockhash — the blockhash-strategy `confirmTransaction` needs the
// blockhash the tx was sent with, not a new one, so it races the wrong expiry.
const start = Date.now();
while (Date.now() - start < 30_000) {
  const { value } = await connection.getSignatureStatuses([sig]);
  const status = value[0];
  if (status?.err) throw new Error(`Airdrop failed: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break;
  await new Promise((r) => setTimeout(r, 1_000));
}
// Then gate on the actual balance with `connection.getBalance(payer.publicKey)`.
```

Airdrops are devnet/testnet only and are rate-limited. On mainnet, fund the
payer from a real wallet.
