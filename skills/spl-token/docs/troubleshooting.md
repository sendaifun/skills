# Troubleshooting

Common errors when working with the classic SPL Token program (`TOKEN_PROGRAM_ID`) and how to fix them.

## Program ID Errors

### `TokenInvalidAccountOwnerError` / `IncorrectProgramId`

**Cause:** Used the wrong program ID for a mint. Most commonly: used `TOKEN_2022_PROGRAM_ID` on a classic Token mint, or used the default (classic) on a Token-2022 mint.

**Solution:** Determine which program owns the mint by reading `getAccountInfo(mint).owner`, then pass the correct program ID to every helper call:

```typescript
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const accountInfo = await connection.getAccountInfo(mint);
if (!accountInfo) throw new Error('Mint not found');

const programId = accountInfo.owner.equals(TOKEN_PROGRAM_ID)
  ? TOKEN_PROGRAM_ID
  : accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : null;

if (!programId) throw new Error('Mint is not owned by a known token program');

// Pass programId to getMint, getOrCreateAssociatedTokenAccount, transferChecked, etc.
```

---

## Account Errors

### `TokenAccountNotFoundError`

**Cause:** Tried to read, transfer from, or transfer to a token account that doesn't exist on-chain.

**Solution:** Create the ATA first. Use `getOrCreateAssociatedTokenAccount` for a simple create-if-missing, or `createAssociatedTokenAccountIdempotent` for composing into a transaction:

```typescript
// Simple approach:
const ata = await getOrCreateAssociatedTokenAccount(
  connection, payer, mint, recipient, false, 'confirmed', undefined, TOKEN_PROGRAM_ID,
);

// Composed approach (atomic create-then-transfer):
const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey, recipientAta, recipient, mint, TOKEN_PROGRAM_ID,
  ),
  createTransferCheckedInstruction(
    source, mint, recipientAta, owner, amount, decimals, [], TOKEN_PROGRAM_ID,
  ),
);
await sendAndConfirmTransaction(connection, tx, [payer, ownerKeypair]);
```

---

### `AccountNotInitialized`

**Cause:** The token account exists but has not been initialized, or you're referencing a random address that is not a token account at all.

**Solution:** Verify the account exists and is owned by `TOKEN_PROGRAM_ID` before operating on it. Use `getAccount` which will throw a clear error if the account is missing or uninitialized.

---

### Account is Frozen

**Cause:** The mint's freeze authority froze the account. A frozen account cannot send or receive tokens.

**Solution:** `thawAccount` first — the mint's freeze authority must sign:

```typescript
await thawAccount(
  connection, payer, account, mint, freezeAuthority, [], undefined, TOKEN_PROGRAM_ID,
);
```

If the freeze authority has been disabled (`setAuthority(AuthorityType.FreezeAccount, null)`), the account **cannot** be thawed — it is permanently frozen. This is irreversible.

---

### `TokenInvalidMintError`

**Cause:** Passed a non-mint account (e.g., a token account) where a mint was expected.

**Solution:** Verify the address is a mint with `getMint(connection, mint, undefined, TOKEN_PROGRAM_ID)`. If it throws, the address is not a mint or is the wrong program.

---

## Decimals & Amount Errors

### Decimals Mismatch / Custom Error `0x6`

**Cause:** A `*Checked` call (`transferChecked`/`mintToChecked`/`burnChecked`) was given a `decimals` value that doesn't match the mint, so the program rejected it with `0x6`. Note the unchecked variants (`transfer`/`mintTo`/`burn`) carry no decimals and never raise this — they silently use whatever base-unit amount you passed, which is the more dangerous failure.

**Solution:** Use the `*Checked` variants (`transferChecked`, `mintToChecked`, `burnChecked`) which assert decimals on-chain:

```typescript
// BAD — no decimals assertion:
await transfer(connection, payer, source, dest, owner, amount, [], undefined, TOKEN_PROGRAM_ID);

// GOOD — decimals asserted on-chain:
await transferChecked(
  connection, payer, source, mint, dest, owner, amount, decimals, [], undefined, TOKEN_PROGRAM_ID,
);
```

Always read `getMint(connection, mint).decimals` rather than hardcoding.

---

### Precision Loss with Large Numbers

**Cause:** Used JavaScript `Number` for token amounts. `Number` loses precision above 2^53 (~9 quadrillion). For high-decimals tokens or large supplies, this silently corrupts balances.

**Solution:** Use `bigint` for all amounts:

```typescript
// BAD:
const amount = 100.5 * 10 ** 9; // Number — precision loss risk

// OK for small, trusted values — but the `*` is still Number math:
const amount = BigInt(Math.round(100.5 * 10 ** 9)); // safe only for small amounts

// BEST — parse the decimal string, never touching Number:
function uiToBaseUnits(ui: string, decimals: number): bigint {
  const [whole, frac = ''] = ui.split('.');
  return BigInt(whole + (frac + '0'.repeat(decimals)).slice(0, decimals));
}
const exact = uiToBaseUnits('100.5', 9); // 100500000000n
```

---

## Authority Errors

### `0x2` (Owner Mismatch)

**Cause:** Tried to perform a privileged operation (transfer, mint, burn, freeze) but the signing key is not the account's owner or the mint's authority.

**Solution:** Check `getAccount(source).owner` or `getMint(mint).mintAuthority` and ensure the correct key signs. The signer must match the on-chain authority exactly.

---

### Mint Authority is Null

**Cause:** Tried to `mintTo` after the mint authority was disabled with `setAuthority(AuthorityType.MintTokens, null)`.

**Solution:** This is **irreversible** — no more tokens can ever be minted to this mint. If you need to mint again, you must create a new mint. Always confirm before disabling authorities.

---

### Freeze Authority is Null

**Cause:** Tried to `freezeAccount` or `thawAccount` but the freeze authority was disabled.

**Solution:** This is **irreversible**. No account of this mint can ever be frozen or thawed again. If you need freeze/thaw capability, create a new mint with a non-null freeze authority.

---

## Transfer Errors

### Insufficient Funds

**Cause:** The source account has fewer base units than the transfer amount.

**Solution:** Read the balance first and check:

```typescript
const sourceInfo = await getAccount(connection, source, undefined, TOKEN_PROGRAM_ID);
if (sourceInfo.amount < amount) {
  throw new Error(`Insufficient: have ${sourceInfo.amount}, need ${amount}`);
}
await transferChecked(connection, payer, source, mint, dest, owner, amount, decimals, [], undefined, TOKEN_PROGRAM_ID);
```

---

### Transfer to a Non-Existent Recipient ATA

**Cause:** The recipient doesn't have an ATA for this mint, so the transfer fails.

**Solution:** Create the ATA in the same transaction:

```typescript
const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, recipientAta, recipient, mint, TOKEN_PROGRAM_ID),
  createTransferCheckedInstruction(source, mint, recipientAta, owner, amount, decimals, [], TOKEN_PROGRAM_ID),
);
await sendAndConfirmTransaction(connection, tx, [payer, ownerKeypair]);
```

---

## Wrapped SOL Errors

### `syncNative` Not Called After Funding WSOL ATA

**Cause:** Transferred lamports to the WSOL ATA via `SystemProgram.transfer` but forgot to call `syncNative`. The token program's recorded balance doesn't match the actual lamports.

**Solution:** Always include `syncNative` after funding:

```typescript
const tx = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: owner, toPubkey: wsolAta, lamports }),
  createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
);
```

---

### Unwrapping WSOL — closing with a non-zero balance is normal

**Clarification:** Unlike regular SPL token accounts (which must be emptied to zero before `closeAccount`), a **native/WSOL** account can be closed with a non-zero wrapped balance — that *is* the unwrap operation. `closeAccount` returns the wrapped SOL amount **plus** the account's rent-reserve lamports to the destination. The "balance must be zero before closing" rule applies only to non-native token accounts.

**To unwrap:** call `closeAccount(connection, payer, wsolAta, destination, owner, ...)`. The owner of the WSOL ATA must sign; all lamports (wrapped balance + rent) go to `destination`.

---

## ATA Creation Errors

### ATA Already Exists

**Cause:** Called `createAssociatedTokenAccount` (non-idempotent) when the ATA was already created in a previous transaction.

**Solution:** Use `createAssociatedTokenAccountIdempotent` — it succeeds whether or not the ATA exists:

```typescript
// BAD — fails if ATA already exists:
createAssociatedTokenAccountInstruction(payer, ata, owner, mint, TOKEN_PROGRAM_ID)

// GOOD — idempotent, no-op if ATA exists:
createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, TOKEN_PROGRAM_ID)
```

---

### Rent-Exempt Failure

**Cause:** The payer doesn't have enough SOL to cover rent for the new token account or mint account.

**Solution:** Fund the payer with at least `getMinimumBalanceForRentExemption(ACCOUNT_SIZE)` lamports (for token accounts) or `getMinimumBalanceForRentExemption(MINT_SIZE)` for mints. On devnet, request an airdrop. On mainnet, fund from an external wallet.

---

## Devnet vs Mainnet

| Concern | Devnet | Mainnet |
|--------|--------|---------|
| Airdrop | Available (rate-limited to ~1 SOL per request) | Not available |
| Token values | Zero value | Real value — mistakes cost money |
| Program IDs | Same as mainnet | Same as devnet |
| RPC rate limits | Public endpoint is heavily rate-limited | Use a dedicated provider |
| Airdrop reliability | Can fail or be slow | N/A |

**Always test on devnet first.** Misconfiguring authorities, decimals, or freeze behavior is easy to do and hard to undo on mainnet.