# Instruction Reference

High-level helpers and instruction builders from `@solana/spl-token` for the **classic Token program** (`TOKEN_PROGRAM_ID`). Each entry shows the signature and a one-line purpose. Prefer `*Checked` variants where available — they assert decimals on-chain.

## High-Level Helpers (send + confirm in one call)

### createMint

```typescript
createMint(
  connection: Connection,
  payer: Signer,
  mintAuthority: PublicKey | null,
  freezeAuthority: PublicKey | null,
  decimals: number,
  mintKeypair?: Keypair,
  confirmOptions?: ConfirmOptions,
  programId?: PublicKey = TOKEN_PROGRAM_ID,
): Promise<PublicKey>
```

Creates a new mint account, initializes it, and returns the mint `PublicKey`.

---

### getOrCreateAssociatedTokenAccount

```typescript
getOrCreateAssociatedTokenAccount(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve?: boolean,
  commitment?: Commitment,
  confirmOptions?: ConfirmOptions,
  programId?: PublicKey = TOKEN_PROGRAM_ID,
  associatedTokenProgramId?: PublicKey = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<Account>
```

Derives the ATA for `mint` + `owner`. If it doesn't exist, creates it and returns the full `Account` object.

---

### getAssociatedTokenAddressSync

```typescript
getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve?: boolean,
  programId?: PublicKey = TOKEN_PROGRAM_ID,
  associatedTokenProgramId?: PublicKey = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey
```

Derives the ATA address without sending a transaction (synchronous).

---

### getAssociatedTokenAddress

```typescript
getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve?: boolean,
  programId?: PublicKey = TOKEN_PROGRAM_ID,
  associatedTokenProgramId?: PublicKey = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<PublicKey>
```

Async version of `getAssociatedTokenAddressSync` (resolves off-curve lookups).

---

### mintTo / mintToChecked

```typescript
// Unchecked — no decimals assertion:
mintTo(
  connection, payer, mint, destination, mintAuthority, amount,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>

// Checked — asserts decimals on-chain (PREFERRED):
mintToChecked(
  connection, payer, mint, destination, mintAuthority, amount, decimals,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

Mints `amount` (bigint, base units) to `destination`. `mintAuthority` must sign.

---

### transfer / transferChecked

```typescript
// Unchecked — no decimals assertion:
transfer(
  connection, payer, source, destination, owner, amount,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>

// Checked — asserts decimals on-chain (PREFERRED):
transferChecked(
  connection, payer, source, mint, destination, owner, amount, decimals,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

Transfers `amount` (bigint, base units) from `source` to `destination`. `owner` of `source` must sign. `transferChecked` takes the mint as a parameter and asserts decimals.

---

### burn / burnChecked

```typescript
// Unchecked — no decimals assertion:
burn(
  connection, payer, account, mint, owner, amount,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>

// Checked — asserts decimals on-chain (PREFERRED):
burnChecked(
  connection, payer, account, mint, owner, amount, decimals,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

Burns `amount` (bigint, base units) from `account`. `owner` must sign.

---

### approve / revoke

```typescript
approve(
  connection, payer, account, delegate, owner, amount,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>

revoke(
  connection, payer, account, owner,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

`approve` grants `delegate` the power to transfer/burn up to `amount` from `account`. `revoke` removes any existing delegate.

---

### setAuthority

```typescript
setAuthority(
  connection, payer, account, currentAuthority, authorityType, newAuthority,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

Changes the `authorityType` (`AuthorityType.MintTokens` or `AuthorityType.FreezeAccount`) to `newAuthority`. Pass `null` to **disable** the authority **irreversibly**.

---

### freezeAccount / thawAccount

```typescript
freezeAccount(
  connection, payer, account, mint, freezeAuthority,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>

thawAccount(
  connection, payer, account, mint, freezeAuthority,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

Freezes or thaws `account`. `freezeAuthority` (the mint's freeze authority) must sign.

---

### closeAccount

```typescript
closeAccount(
  connection, payer, account, destination, owner,
  multiSigners?, confirmOptions?, programId?
): Promise<TransactionSignature>
```

Closes `account` and transfers its lamports to `destination`. The account must have zero token balance (except WSOL). `owner` must sign.

---

### syncNative

```typescript
syncNative(
  connection, payer, account,
  confirmOptions?, programId?
): Promise<TransactionSignature>
```

Updates the WSOL account's recorded balance to match the actual lamports. Must be called after every `SystemProgram.transfer` that adds lamports to the WSOL ATA.

---

### createAssociatedTokenAccountIdempotent

```typescript
createAssociatedTokenAccountIdempotent(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  owner: PublicKey,
  confirmOptions?: ConfirmOptions,
  programId?: PublicKey = TOKEN_PROGRAM_ID,
  associatedTokenProgramId?: PublicKey = ASSOCIATED_TOKEN_PROGRAM_ID,
  allowOwnerOffCurve?: boolean,
): Promise<PublicKey>
```

Send-and-confirm helper that creates the ATA if missing and returns its address. Succeeds whether or not the ATA already exists (idempotent). For composing into your own transaction, use `createAssociatedTokenAccountIdempotentInstruction` (see below) instead.

---

### getMint / getAccount

```typescript
getMint(
  connection, mint, commitment?, programId?
): Promise<Mint>

getAccount(
  connection, address, commitment?, programId?
): Promise<Account>
```

Deserializes on-chain mint/account state. `getMint().decimals` is the source of truth for decimals.

## Instruction Builders (for composing into transactions)

These return `TransactionInstruction` objects — add them to a `Transaction` and sign/send yourself.

### createInitializeMintInstruction

```typescript
createInitializeMintInstruction(
  mint: PublicKey,
  decimals: number,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  programId?: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction
```

Initializes a mint account. Must be called after `SystemProgram.createAccount`.

### createMintToInstruction / createMintToCheckedInstruction

```typescript
createMintToInstruction(
  mint, destination, mintAuthority, amount, multiSigners?, programId?
): TransactionInstruction

createMintToCheckedInstruction(
  mint, destination, mintAuthority, amount, decimals, multiSigners?, programId?
): TransactionInstruction
```

### createTransferInstruction / createTransferCheckedInstruction

```typescript
createTransferInstruction(
  source, destination, owner, amount, multiSigners?, programId?
): TransactionInstruction

createTransferCheckedInstruction(
  source, mint, destination, owner, amount, decimals, multiSigners?, programId?
): TransactionInstruction
```

### createBurnInstruction / createBurnCheckedInstruction

```typescript
createBurnInstruction(
  account, mint, owner, amount, multiSigners?, programId?
): TransactionInstruction

createBurnCheckedInstruction(
  account, mint, owner, amount, decimals, multiSigners?, programId?
): TransactionInstruction
```

### createApproveInstruction / createRevokeInstruction

```typescript
createApproveInstruction(
  account, delegate, owner, amount, multiSigners?, programId?
): TransactionInstruction

createRevokeInstruction(
  account, owner, multiSigners?, programId?
): TransactionInstruction
```

### createSetAuthorityInstruction

```typescript
createSetAuthorityInstruction(
  account, currentAuthority, authorityType, newAuthority, multiSigners?, programId?
): TransactionInstruction
```

### createFreezeAccountInstruction / createThawAccountInstruction

```typescript
createFreezeAccountInstruction(
  account, mint, freezeAuthority, multiSigners?, programId?
): TransactionInstruction

createThawAccountInstruction(
  account, mint, freezeAuthority, multiSigners?, programId?
): TransactionInstruction
```

### createCloseAccountInstruction

```typescript
createCloseAccountInstruction(
  account, destination, owner, multiSigners?, programId?
): TransactionInstruction
```

### createSyncNativeInstruction

```typescript
createSyncNativeInstruction(
  account, programId?
): TransactionInstruction
```

### createAssociatedTokenAccountInstruction

```typescript
createAssociatedTokenAccountInstruction(
  payer, associatedToken, owner, mint, programId?, associatedTokenProgramId?
): TransactionInstruction
```

Non-idempotent — fails if the ATA already exists. Prefer the idempotent instruction below unless you specifically want the error.

### createAssociatedTokenAccountIdempotentInstruction

```typescript
createAssociatedTokenAccountIdempotentInstruction(
  payer, associatedToken, owner, mint, programId?, associatedTokenProgramId?
): TransactionInstruction
```

Idempotent — succeeds whether or not the ATA already exists. This is the instruction builder used throughout this skill's examples for composing ATA creation into a transaction (e.g. create-then-transfer atomically).

## Checked vs Unchecked — When to Use Which

| Operation | Unchecked | Checked | Recommendation |
|----------|-----------|---------|----------------|
| Mint | `mintTo` | `mintToChecked` | **Always use Checked** |
| Transfer | `transfer` | `transferChecked` | **Always use Checked** |
| Burn | `burn` | `burnChecked` | **Always use Checked** |

The Checked variants include the mint and decimals in the instruction data. The program validates that the provided decimals match the mint's actual decimals, catching a common class of bugs where a hardcoded decimal value drifts from the on-chain truth. The only reason to use unchecked is if you have a specific integration that requires it — and even then, read `getMint().decimals` first.

## AuthorityType Enum

```typescript
enum AuthorityType {
  MintTokens = 0,    // the authority that can mint new tokens
  FreezeAccount = 1, // the authority that can freeze/thaw accounts
  AccountOwner = 2,  // change a token account's owner
  CloseAccount = 3,  // the authority that can close a token account
  // Values 4–16 are Token-2022 extension authorities (TransferFeeConfig,
  // PermanentDelegate, MetadataPointer, etc.) — not used by the classic program.
}
```

Pass this to `setAuthority` / `createSetAuthorityInstruction` to specify which authority you are changing. The four values above (0–3) are the ones relevant to the classic Token program.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MINT_SIZE` | 82 | Byte length of a mint account |
| `ACCOUNT_SIZE` | 165 | Byte length of a token account |
| `MULTISIG_SIZE` | 355 | Byte length of a multisig account |

## Multi-Signers

When a token account or mint has an M-of-N multisig authority, pass the required signers via `multiSigners`. Note the type differs by call style: the high-level action helpers (`transferChecked`, `mintTo`, etc.) declare `multiSigners?: Signer[]` (they must actually sign), while the raw instruction builders (`createTransferCheckedInstruction`, etc.) accept `(Signer | PublicKey)[]` (you sign the transaction yourself). This is uncommon for most use cases — single-authority mints and accounts pass `[]` or omit the parameter.