---
name: spl-token
description: Complete guide for creating and managing classic SPL Token mints with @solana/spl-token. Covers creating mints, associated token accounts (ATAs), minting tokens, transferring with transferChecked, burning, approving delegates, setting authorities, freezing/thawing accounts, wrapping/unwraping SOL, and reading on-chain mint/account state. Use this when an agent needs to mint or manage standard SPL tokens that do NOT require Token-2022 extensions.
---

# SPL Token (Classic Token Program) Development Guide

A guide for building with the **classic SPL Token program** — the original fungible-token program on Solana. It powers USDC, USDT, and the vast majority of SPL tokens in circulation. The `@solana/spl-token` JavaScript library provides both high-level helpers and raw instruction builders for the entire program surface.

## Overview

The classic Token program implements the core fungible-token model:

- **Mints** — define a token (decimals, supply, mint authority, optional freeze authority).
- **Token Accounts** — hold balances for a given mint; the canonical per-wallet account is the **Associated Token Account (ATA)**.
- **Minting & Burning** — mint authority increases supply; any holder can burn their own tokens to reduce supply.
- **Transfers** — move tokens between accounts; prefer `transferChecked` which asserts decimals on-chain.
- **Delegates** — approve a delegate to transfer or burn up to a delegated amount on behalf of the owner.
- **Authorities** — set or revoke mint authority and freeze authority (passing `null` disables irreversibly).
- **Freeze/Thaw** — a mint with a freeze authority can freeze and thaw individual token accounts.
- **Wrapped SOL** — NATIVE_MINT (`So11111111111111111111111111111111111111112`) lets you treat lamports as an SPL token.

> **When to use this skill vs Token-2022:** This is the *classic* Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). If you need extensions like transfer fees, on-chain metadata, non-transferable (soulbound), permanent delegate, or transfer hooks, use the [token-2022 skill](../token-2022/SKILL.md) instead. Both skills use the same `@solana/spl-token` library — the program ID is the difference.

> **Key rule:** classic Token and Token-2022 are *different programs with different IDs*. A classic Token mint must be handled with `TOKEN_PROGRAM_ID` everywhere — ATAs, transfers, mint-to. Mixing program IDs is the #1 source of errors.

## Program IDs

| Program | Address | Export |
|---------|---------|--------|
| **SPL Token (classic)** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `TOKEN_PROGRAM_ID` |
| **Associated Token Account** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | `ASSOCIATED_TOKEN_PROGRAM_ID` |
| **Token-2022** (separate) | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `TOKEN_2022_PROGRAM_ID` |
| **Wrapped SOL (NATIVE_MINT)** | `So11111111111111111111111111111111111111112` | `NATIVE_MINT` |

These addresses are identical on devnet, testnet, and mainnet-beta. See `resources/program-addresses.md` for cluster notes.

## Quick Start

### Installation

```bash
npm install @solana/web3.js @solana/spl-token
# bs58 is also needed if you load a keypair from a base58 secret key
# (see templates/setup.ts and examples/_shared/util.ts):
npm install bs58
```

### Basic Setup

```typescript
import {
  Connection,
  Keypair,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
  getAccount,
} from '@solana/spl-token';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const payer = Keypair.generate(); // replace with a funded keypair

// Funding note: a freshly generated keypair has zero SOL. On devnet, airdrop
// and confirm before sending:
//   await connection.requestAirdrop(payer.publicKey, 1e9);
// On mainnet load a funded keypair from an environment variable.
// The examples use `loadOrAirdropPayer` from `examples/_shared/util.ts`,
// which does this and asserts the balance.

// Create a mint with 6 decimals, payer as mint authority.
const mint = await createMint(
  connection,
  payer,           // pays for the mint account
  payer.publicKey, // mint authority
  null,            // freeze authority (null = none)
  6,               // decimals
  undefined,
  undefined,
  TOKEN_PROGRAM_ID,
);

// Get or create the payer's ATA for this mint.
const ata = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,
  mint,
  payer.publicKey,
  false,
  'confirmed',
  undefined,
  TOKEN_PROGRAM_ID,
);

// Mint 1,000 tokens (base units = 1_000 * 10^6 = 1_000_000_000).
await mintToChecked(
  connection,
  payer,
  mint,
  ata.address,
  payer.publicKey, // mint authority
  1_000_000_000n,   // amount as bigint
  6,                // decimals — asserted on-chain
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);

console.log('Mint:', mint.toBase58());
console.log('ATA:', ata.address.toBase58());

// `ata.amount` reflects the balance from BEFORE the mint (the object was
// fetched when the ATA was created). Re-fetch to see the post-mint balance:
const ataInfo = await getAccount(connection, ata.address, undefined, TOKEN_PROGRAM_ID);
console.log('Balance:', ataInfo.amount.toString()); // 1000000000
```

## Core Operations

### Create Mint

`createMint` is the high-level helper that creates the mint account, initializes it, and returns the mint `PublicKey`.

```typescript
import { createMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const mint = await createMint(
  connection,
  payer,             // fee payer + signer
  mintAuthority,      // who can mint tokens (PublicKey — required, not nullable)
  freezeAuthority,    // who can freeze accounts (PublicKey or null for none)
  decimals,           // e.g. 6 for USDC-style, 9 for SOL-style
  undefined,           // mint keypair (optional; generated if omitted)
  undefined,
  TOKEN_PROGRAM_ID,
);
```

For low-level control, use `createInitializeMintInstruction` after allocating the account manually:

```typescript
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
} from '@solana/spl-token';
import {
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const mintKeypair = Keypair.generate();
const mint = mintKeypair.publicKey;
const decimals = 6;
const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

const tx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint,
    space: MINT_SIZE,
    lamports,
    programId: TOKEN_PROGRAM_ID,
  }),
  createInitializeMintInstruction(
    mint,
    decimals,
    payer.publicKey, // mint authority
    null,            // freeze authority
    TOKEN_PROGRAM_ID,
  ),
);
await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
```

### Associated Token Accounts (ATAs)

The **Associated Token Account** is the canonical token account for a given mint + owner pair — derived deterministically via PDA. Use `getOrCreateAssociatedTokenAccount` to create if missing:

```typescript
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const ata = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,           // pays rent for the ATA if it needs creating
  mint,
  owner,            // the wallet that owns this ATA
  false,            // allowOwnerOffCurve — false for normal wallets
  'confirmed',      // commitment
  undefined,        // confirmOptions
  TOKEN_PROGRAM_ID,
);
```

For **idempotent** ATA creation (won't error if the ATA already exists), use `createAssociatedTokenAccountIdempotent`:

```typescript
import {
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { sendAndConfirmTransaction } from '@solana/web3.js';

const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,   // funder
    ata,               // associated token account
    owner,             // wallet
    mint,
    TOKEN_PROGRAM_ID,
  ),
);
await sendAndConfirmTransaction(connection, tx, [payer]);
```

Derive the ATA address without sending a transaction using `getAssociatedTokenAddressSync`:

```typescript
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
```

### Mint Tokens

Prefer `mintToChecked` — it passes `decimals` + `mint` and fails safely on mismatch:

```typescript
import { mintToChecked, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await mintToChecked(
  connection,
  payer,
  mint,
  destination,        // token account to credit
  mintAuthority,      // must sign
  amount,             // bigint in base units
  decimals,           // asserted on-chain
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

The unchecked `mintTo` variant omits the decimals assertion — use it only when you are certain of the mint's decimals:

```typescript
import { mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await mintTo(
  connection,
  payer,
  mint,
  destination,
  mintAuthority,
  amount, // bigint
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

### Transfer (use transferChecked)

`transferChecked` is the **recommended** default — it includes the mint and decimals in the instruction, so the program asserts them on-chain:

```typescript
import { transferChecked, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await transferChecked(
  connection,
  payer,
  source,        // source token account
  mint,
  destination,   // recipient token account (must exist)
  owner,         // owner of the source account (must sign)
  amount,        // bigint in base units
  decimals,      // asserted on-chain
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

The unchecked `transfer` variant does not include the mint in the instruction and cannot assert decimals. Use `transferChecked` unless you have a specific reason not to:

```typescript
import { transfer, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await transfer(
  connection,
  payer,
  source,
  destination,
  owner,
  amount, // bigint
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

> **The recipient's ATA must exist before transferring.** If it does not, the transfer will fail with `TokenAccountNotFoundError`. Create it first with `getOrCreateAssociatedTokenAccount` or `createAssociatedTokenAccountIdempotent`.

### Burn

Prefer `burnChecked` — it passes the mint + decimals and asserts them on-chain:

```typescript
import { burnChecked, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await burnChecked(
  connection,
  payer,
  account,      // token account holding the tokens
  mint,
  owner,        // owner of the account (must sign)
  amount,       // bigint in base units
  decimals,     // asserted on-chain
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

### Approve / Revoke Delegate

`approve` grants a delegate the power to transfer or burn up to `amount` tokens from the owner's account. The owner signs:

```typescript
import { approve, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await approve(
  connection,
  payer,
  account,     // owner's token account
  delegate,    // the address being delegated to
  owner,       // owner of the account (must sign)
  amount,      // bigint — max the delegate can transfer/burn
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

`revoke` removes any existing delegate:

```typescript
import { revoke, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await revoke(
  connection,
  payer,
  account,
  owner, // must sign
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

> A delegate is different from an authority. A delegate can transfer/burn from *one specific account* up to a set amount. A mint authority can mint new tokens. A freeze authority can freeze accounts. Do not conflate them.

### Set / Disable Authority

Use `setAuthority` to change the mint authority or freeze authority. Pass `null` as the new authority to **disable** it irreversibly:

```typescript
import {
  AuthorityType,
  setAuthority,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// Change mint authority to a new key:
await setAuthority(
  connection,
  payer,
  mint,
  currentAuthority,   // current mint authority (must sign)
  AuthorityType.MintTokens,
  newMintAuthority,    // new authority PublicKey
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);

// Disable mint authority permanently (irreversible!):
await setAuthority(
  connection,
  payer,
  mint,
  currentAuthority,
  AuthorityType.MintTokens,
  null,               // disables minting forever
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

> **Warning:** `setAuthority(..., null)` is **irreversible**. Once you disable the mint authority, no more tokens can ever be minted. Once you disable the freeze authority, no account can ever be frozen or thawed again. Confirm this is what you want before executing.

### Freeze / Thaw Account

If the mint has a non-null freeze authority, the freeze authority can freeze individual token accounts. A frozen account cannot transfer or receive tokens:

```typescript
import {
  freezeAccount,
  thawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

await freezeAccount(
  connection,
  payer,
  account,           // token account to freeze
  mint,
  freezeAuthority,    // must sign
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);

await thawAccount(
  connection,
  payer,
  account,
  mint,
  freezeAuthority,
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

### Read Mint / Account State

`getMint` and `getAccount` deserialize on-chain state:

```typescript
import { getMint, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const mintInfo = await getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
console.log('Decimals:', mintInfo.decimals);
console.log('Supply:', mintInfo.supply.toString());
console.log('Mint authority:', mintInfo.mintAuthority?.toBase58() ?? 'null');
console.log('Freeze authority:', mintInfo.freezeAuthority?.toBase58() ?? 'null');

const accountInfo = await getAccount(connection, ata, undefined, TOKEN_PROGRAM_ID);
console.log('Amount:', accountInfo.amount.toString());
console.log('Owner:', accountInfo.owner.toBase58());
console.log('Delegated amount:', accountInfo.delegatedAmount.toString());
console.log('Frozen:', accountInfo.isFrozen); // boolean
```

`getMint().decimals` is the **source of truth** for decimals — always read it rather than hardcoding.

## Wrapped SOL

Wrapped SOL (`NATIVE_MINT`) lets you use lamports as an SPL token — useful for DEX routing and uniform account handling.

**Wrap SOL** — transfer lamports to the WSOL ATA, then call `syncNative`:

```typescript
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import {
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const wsolAta = getAssociatedTokenAddressSync(
  NATIVE_MINT,
  owner,
  false,
  TOKEN_PROGRAM_ID,
);

// Create the ATA if it doesn't exist, then fund it with lamports and sync.
const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(
    owner,
    wsolAta,
    owner,
    NATIVE_MINT,
    TOKEN_PROGRAM_ID,
  ),
  SystemProgram.transfer({
    fromPubkey: owner,
    toPubkey: wsolAta,
    lamports: 1_000_000_000, // 1 SOL in lamports
  }),
  createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
);
await sendAndConfirmTransaction(connection, tx, [payer, ownerKeypair]);
```

**Unwrap SOL** — close the WSOL ATA; the lamports are returned to the owner:

```typescript
import { closeAccount, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';

await closeAccount(
  connection,
  payer,
  wsolAta,
  owner,         // destination for reclaimed lamports
  ownerKeypair,  // owner of the WSOL ATA (must sign)
  [],
  undefined,
  TOKEN_PROGRAM_ID,
);
```

> After wrapping, the WSOL ATA's token amount equals the lamports deposited. `syncNative` must be called every time you add more lamports to the WSOL ATA via a System Program transfer — otherwise the token program's recorded balance won't match the actual lamports.

## Decimals & Amounts

Token amounts are **integers in base units** — never JavaScript floats. `amount * 10^decimals` is the base-unit representation.

```typescript
// Quick conversion — fine ONLY for small, trusted UI values. Note this still
// does Number math (`uiAmount * 10 ** decimals`) before converting to bigint,
// so it loses precision for large amounts or high-decimals mints:
const uiAmount = 100.5;
const decimals = 6;
const baseUnitsQuick = BigInt(Math.round(uiAmount * 10 ** decimals)); // → 100_500_000n

// Exact conversion — parse the decimal STRING, never touching Number.
// Use this for large amounts, high-decimals mints, or untrusted input:
function uiToBaseUnits(ui: string, decimals: number): bigint {
  const [whole, frac = ''] = ui.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole + fracPadded);
}
const baseUnits = uiToBaseUnits('100.5', 6); // → 100_500_000n (no float involved)

// Format base units back to a UI string without Number precision loss:
function baseUnitsToUi(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals) || '0';
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
```

> **Always use `BigInt`/`bigint` for amounts and avoid `Number` math when scaling them.** JavaScript `Number` loses precision above 2^53, so `uiAmount * 10 ** decimals` silently corrupts large or high-decimals balances even when the result is later wrapped in `BigInt`. Parse decimal strings (as above) for exact conversion. `getMint().decimals` is the source of truth — read it and pass it to `*Checked` variants.

## Composing Instructions

For atomic multi-step operations, build individual instructions and add them to a single `Transaction`:

```typescript
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const recipientAta = getAssociatedTokenAddressSync(
  mint,
  recipient,
  false,
  TOKEN_PROGRAM_ID,
);

const tx = new Transaction().add(
  // 1. Create recipient ATA (idempotent — no-op if it already exists)
  createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    recipientAta,
    recipient,
    mint,
    TOKEN_PROGRAM_ID,
  ),
  // 2. Transfer tokens in the same transaction
  createTransferCheckedInstruction(
    sourceAta,
    mint,
    recipientAta,
    owner,
    amount,      // bigint
    decimals,    // asserted on-chain
    [],
    TOKEN_PROGRAM_ID,
  ),
);
await sendAndConfirmTransaction(connection, tx, [payer, ownerKeypair]);
```

This pattern — create ATA + transfer in one transaction — is the recommended way to send tokens to a wallet that may not have an ATA yet. Either both instructions succeed or the entire transaction reverts.

Other instruction builders for composition:

- `createMintToCheckedInstruction(mint, destination, mintAuthority, amount, decimals, [], TOKEN_PROGRAM_ID)`
- `createBurnCheckedInstruction(account, mint, owner, amount, decimals, [], TOKEN_PROGRAM_ID)`
- `createApproveInstruction(account, delegate, owner, amount, [], TOKEN_PROGRAM_ID)`
- `createRevokeInstruction(account, owner, [], TOKEN_PROGRAM_ID)`
- `createFreezeAccountInstruction(account, mint, freezeAuthority, [], TOKEN_PROGRAM_ID)`
- `createThawAccountInstruction(account, mint, freezeAuthority, [], TOKEN_PROGRAM_ID)`
- `createSetAuthorityInstruction(account, currentAuthority, authorityType, newAuthority, [], TOKEN_PROGRAM_ID)`
- `createCloseAccountInstruction(account, destination, owner, [], TOKEN_PROGRAM_ID)`
- `createSyncNativeInstruction(account, TOKEN_PROGRAM_ID)`

See `resources/instruction-reference.md` for the full signature list.

## Guidelines

- **DO** use `transferChecked`, `mintToChecked`, and `burnChecked` — they assert decimals on-chain and catch mismatch bugs early.
- **DO** pass `TOKEN_PROGRAM_ID` explicitly to every helper — the default is classic Token, but being explicit prevents confusion when both programs are in play.
- **DO** use `BigInt`/`bigint` for all amounts — never JavaScript floats.
- **DO** create the recipient ATA before transferring (or use `createAssociatedTokenAccountIdempotent` in the same transaction).
- **DO** read `getMint().decimals` as the source of truth rather than hardcoding.
- **DO** verify that the current authority matches the expected key before calling `setAuthority`, `freezeAccount`, or `mintTo`.
- **DON'T** use JavaScript `Number` for token amounts — it loses precision above 2^53.
- **DON'T** forget that the recipient ATA may not exist — a transfer to a non-existent account fails.
- **DON'T** disable the freeze authority unintentionally — `setAuthority(AuthorityType.FreezeAccount, null)` is irreversible and means no account can ever be frozen or thawed again.
- **DON'T** disable the mint authority unintentionally — `setAuthority(AuthorityType.MintTokens, null)` is irreversible and means no more tokens can ever be minted.
- **DON'T** log or commit secret keys — examples generate ephemeral devnet keypairs or load from environment variables.
- **DON'T** confuse delegates with authorities — a delegate can transfer/burn from one account up to a set amount; an authority controls the mint.

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `TokenAccountNotFoundError` | Tried to read or transfer from an account that doesn't exist | Create the ATA first with `getOrCreateAssociatedTokenAccount` or `createAssociatedTokenAccountIdempotent` |
| `TokenInvalidAccountOwnerError` / `IncorrectProgramId` | Used `TOKEN_2022_PROGRAM_ID` on a classic mint, or vice versa | Pass `TOKEN_PROGRAM_ID` consistently for classic mints |
| `0x6` (custom error) / decimals mismatch | A `*Checked` call was given a `decimals` that doesn't match the mint (the program rejects it). Unchecked `transfer`/`mintTo`/`burn` never raise this — they carry no decimals and silently use whatever base-unit amount you passed | Read `getMint().decimals` and pass the real value to the `*Checked` variant; prefer `*Checked` so wrong-scale bugs surface as this error instead of silent corruption |
| Insufficient funds | Source account has fewer base units than the transfer amount | Read `getAccount(source).amount` and check before sending |
| `AccountNotInitialized` | Recipient ATA was never created | Add `createAssociatedTokenAccountIdempotent` before the transfer instruction |
| ATA already exists | Called `createAssociatedTokenAccount` (non-idempotent) when the ATA was already there | Use `createAssociatedTokenAccountIdempotent` — it succeeds whether or not the ATA exists |
| `0x2` (custom error) / owner mismatch | Tried to transfer from an account you don't own | Ensure the correct owner signs; check `getAccount(source).owner` |
| Account is frozen | Tried to transfer from/to a frozen account | `thawAccount` first (requires the mint's freeze authority to sign) |
| Mint authority is null | Tried to `mintTo` after the mint authority was disabled | `setAuthority(AuthorityType.MintTokens, null)` is irreversible — you cannot re-enable it |

See `docs/troubleshooting.md` for expanded diagnostics and fixes.

## References

- [Solana Docs — SPL Token](https://solana.com/docs/core/tokens)
- [SPL Token (spl.solana.com)](https://spl.solana.com/token)
- [@solana/spl-token (npm)](https://www.npmjs.com/package/@solana/spl-token)
- [solana-program/token (GitHub)](https://github.com/solana-program/token)
- [Token-2022 skill (sibling)](../token-2022/SKILL.md) — for extension features (transfer fees, metadata, soulbound, etc.)

## Skill Structure

```
spl-token/
├── SKILL.md                                # This file
├── resources/
│   ├── program-addresses.md               # Program IDs, NATIVE_MINT, cluster notes
│   └── instruction-reference.md           # Helper signatures + Checked vs unchecked
├── examples/
│   ├── _shared/util.ts                    # Shared helpers (loadOrAirdropPayer, explorerLink)
│   ├── create-mint-and-mint-to/example.ts # Runnable: createMint → ATA → mintToChecked
│   └── transfer-tokens/example.ts         # Runnable: sender+recipient ATAs → transferChecked
├── templates/
│   └── setup.ts                           # Connection + payer + airdrop boilerplate
└── docs/
    └── troubleshooting.md                 # Common errors and fixes (expanded)
```