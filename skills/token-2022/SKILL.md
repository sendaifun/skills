---
name: token-2022
description: Complete guide for creating and managing Token-2022 (SPL Token Extensions) mints with @solana/spl-token. Covers transfer fees, interest-bearing, non-transferable (soulbound), metadata pointer + on-chain token metadata, default account state, permanent delegate, mint close authority, and transfer hooks. Use this when an agent needs to mint or manage SPL tokens that require extension behavior beyond the classic Token program.
---

# Token-2022 (SPL Token Extensions) Development Guide

A guide for building with **Token-2022**, the SPL **Token Extensions** program. Token-2022 is a superset of the original Token program: it keeps the same mint/account model but adds opt-in *extensions* that bake behavior (fees, soulbound, metadata, interest, delegates) directly into the mint. Use the `@solana/spl-token` JavaScript library for all of it.

## Overview

Token-2022 extends classic SPL tokens with mint-level features:

- **Transfer Fees** - Withhold a configurable fee (basis points, capped) on every transfer; harvest and withdraw later.
- **Interest-Bearing** - Display a continuously compounding interest rate (UI amount only; no new supply minted).
- **Non-Transferable** - Soulbound tokens that can be minted and burned but never transferred.
- **Metadata Pointer + Token Metadata** - Point at a metadata account (often the mint itself) and store name/symbol/URI + custom fields on-chain, no extra program.
- **Default Account State** - New token accounts start `Frozen` until the freeze authority thaws them (allow-list pattern).
- **Permanent Delegate** - A delegate with unconditional transfer/burn authority over every account of the mint.
- **Mint Close Authority** - Allows closing the mint account to reclaim rent once supply is zero.
- **Transfer Hook** - Invoke a custom program on every transfer (advanced; carries real security risk — see Best Practices).

> **Key rule:** classic Token and Token-2022 are *different programs with different IDs*. A Token-2022 mint must be handled with `TOKEN_2022_PROGRAM_ID` everywhere — ATAs, transfers, mint-to. Mixing program IDs is the #1 source of errors.

## Program IDs

| Program | Address |
|---------|---------|
| **Token-2022 (Token Extensions)** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| **SPL Token (classic)** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| **Associated Token Account** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

These addresses are identical on devnet, testnet, and mainnet-beta. The library exposes them as `TOKEN_2022_PROGRAM_ID`, `TOKEN_PROGRAM_ID`, and `ASSOCIATED_TOKEN_PROGRAM_ID`.

## Quick Start

### Installation

```bash
npm install @solana/web3.js @solana/spl-token @solana/spl-token-metadata
```

### Basic Setup

```typescript
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
} from '@solana/spl-token';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const payer = Keypair.generate(); // replace with a funded keypair
const mintKeypair = Keypair.generate();

// Funding note: a freshly generated keypair has zero SOL. On devnet, airdrop and
// confirm before sending (`await connection.requestAirdrop(payer.publicKey, 1e9)`);
// on mainnet load a funded keypair. The examples use `loadOrAirdropPayer` from
// `examples/_shared/util.ts`, which does this and asserts the balance.
const mint = mintKeypair.publicKey;

// Size the account for the extensions you intend to enable.
const mintLen = getMintLen([ExtensionType.MintCloseAuthority]);
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

const tx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID, // owner is Token-2022, not the classic program
  }),
  // ...extension init instructions go here, BEFORE the mint init...
  createInitializeMintInstruction(mint, 9, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
);
await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair]);
```

### The critical pattern

Creating an extension mint is always the same four-step shape inside one transaction:

1. **`SystemProgram.createAccount`** — allocate the mint account, sized with `getMintLen([ExtensionType.X, ...])`, owned by `TOKEN_2022_PROGRAM_ID`.
2. **One init instruction per extension** — `createInitializeTransferFeeConfigInstruction`, `createInitializeMetadataPointerInstruction`, etc.
3. **`createInitializeMintInstruction`** — *last* of the program's own init instructions.
4. **(Variable-length only)** on-chain metadata via `@solana/spl-token-metadata` `createInitializeInstruction` / `createUpdateFieldInstruction`.

**Order matters:** every extension must be initialized *before* `createInitializeMintInstruction`. Initializing the mint first locks the account and the extension inits will fail.

## Core Features

### Transfer Fees

Withhold a fee on each transfer. The fee accrues in recipient accounts; the withdraw-withheld authority later harvests it to the mint and withdraws it out.

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferFeeConfigInstruction,
  createInitializeMintInstruction,
  createTransferCheckedWithFeeInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);

const bps = 100;             // fee basis points = 1%
const maxFee = 5_000_000n;   // maximum fee (base units), caps the fee per transfer

// During mint creation (before createInitializeMintInstruction):
createInitializeTransferFeeConfigInstruction(
  mint,
  payer.publicKey, // transfer fee config authority (or null to make the fee config immutable)
  payer.publicKey, // withdraw withheld authority (nullable; null = no one can withdraw)
  bps,
  maxFee,
  TOKEN_2022_PROGRAM_ID,
);

// Transfer with the fee computed client-side, applying the same cap the program enforces.
const amount = 100_000_000n;
const calculated = (amount * BigInt(bps)) / 10_000n;
const fee = calculated > maxFee ? maxFee : calculated;
createTransferCheckedWithFeeInstruction(
  source, mint, destination, owner, amount, /* decimals */ 6, fee, [], TOKEN_2022_PROGRAM_ID,
);

// Later: sweep withheld fees from accounts to the mint, then withdraw to a destination ATA.
createHarvestWithheldTokensToMintInstruction(mint, [destination], TOKEN_2022_PROGRAM_ID);
createWithdrawWithheldTokensFromMintInstruction(
  mint, feeDestinationAta, /* withdraw authority */ payer.publicKey, [], TOKEN_2022_PROGRAM_ID,
);
```

See the full runnable example in `examples/create-mint-with-transfer-fee/example.ts`.

### Interest-Bearing

Stores an interest rate and shows a compounded *UI amount*. It does **not** mint new tokens — `getAccountBalance` raw amounts are unchanged; only the displayed amount grows.

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeInterestBearingMintInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.InterestBearingConfig]);

createInitializeInterestBearingMintInstruction(
  mint,
  payer.publicKey, // rate authority (can update the rate later)
  500,             // rate in basis points (5%)
  TOKEN_2022_PROGRAM_ID,
);
```

### Non-Transferable (soulbound)

Tokens can be minted and burned, but never transferred — ideal for credentials and achievements.

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeNonTransferableMintInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.NonTransferable]);

createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID);
```

See `examples/non-transferable-soulbound/example.ts` for a full mint + a transfer that is rejected on-chain.

### Metadata Pointer + On-chain Token Metadata

Point the mint at a metadata account (commonly the mint itself), then store the metadata on-chain with `@solana/spl-token-metadata`. Metadata is variable-length, so it needs **extra lamports** beyond `getMintLen`.

```typescript
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  getMintLen,
} from '@solana/spl-token';
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from '@solana/spl-token-metadata';

const metadata: TokenMetadata = {
  mint,
  name: 'My Token',
  symbol: 'MTK',
  uri: 'https://example.com/metadata.json',
  additionalMetadata: [['category', 'demo']],
};

// Fund rent for BOTH the mint extensions AND the variable metadata blob.
const mintLen = getMintLen([ExtensionType.MetadataPointer]);
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

// Allocate space = mintLen ONLY (the metadata init reallocs the account up to size).
// Order: metadata-pointer init -> mint init -> metadata init -> update field.
createInitializeMetadataPointerInstruction(mint, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID);
// ...createInitializeMintInstruction(...)...
createInitializeInstruction({
  programId: TOKEN_2022_PROGRAM_ID,
  metadata: mint,          // metadata lives in the mint account
  updateAuthority: payer.publicKey,
  mint,
  mintAuthority: payer.publicKey,
  name: metadata.name,
  symbol: metadata.symbol,
  uri: metadata.uri,
});
createUpdateFieldInstruction({
  programId: TOKEN_2022_PROGRAM_ID,
  metadata: mint,
  updateAuthority: payer.publicKey,
  field: 'category',       // a Field enum value or any custom string key
  value: 'demo',
});
```

> Allocate `space = mintLen` in `createAccount` but fund `mintLen + metadataLen` lamports. The metadata `createInitializeInstruction` reallocates the account to fit the metadata; the account must already hold enough lamports to stay rent-exempt at the larger size.

### Default Account State

Force every new token account into a state (typically `Frozen`) until the freeze authority thaws it — an allow-list / KYC gate.

```typescript
import {
  AccountState,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMintInstruction,
  createThawAccountInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.DefaultAccountState]);

createInitializeDefaultAccountStateInstruction(
  mint,
  AccountState.Frozen, // new accounts start frozen
  TOKEN_2022_PROGRAM_ID,
);

// REQUIRED for the frozen-default pattern: the mint MUST have a non-null freeze
// authority, otherwise no one can ever thaw the accounts the extension freezes.
createInitializeMintInstruction(
  mint,
  decimals,
  mintAuthority,
  freezeAuthority, // must NOT be null when default state is Frozen
  TOKEN_2022_PROGRAM_ID,
);

// Every new account is created Frozen. Thaw it (signed by the freeze authority)
// before it can receive a mint-to or transfer.
createThawAccountInstruction(
  account,         // the token account to unfreeze
  mint,
  freezeAuthority, // signer
  [],
  TOKEN_2022_PROGRAM_ID,
);
```

> **The freeze authority is not optional here.** `AccountState.Frozen` as the
> default is useless without a freeze authority to thaw accounts — pass a real
> key (never `null`) to `createInitializeMintInstruction`, and budget a thaw
> instruction into your onboarding flow before the first mint-to/transfer.

### Permanent Delegate

Grants an address unconditional authority to transfer or burn from any account of the mint. Powerful and dangerous — holders cannot opt out.

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializePermanentDelegateInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.PermanentDelegate]);

createInitializePermanentDelegateInstruction(
  mint,
  payer.publicKey, // the permanent delegate — this IS the feature; pass a real key
  TOKEN_2022_PROGRAM_ID,
);
```

### Mint Close Authority

Allows closing the mint account (reclaiming its rent) once the supply is zero.

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintCloseAuthorityInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.MintCloseAuthority]);

createInitializeMintCloseAuthorityInstruction(
  mint,
  payer.publicKey, // close authority (or null)
  TOKEN_2022_PROGRAM_ID,
);
```

### Transfer Hook

Calls a custom program on every transfer (e.g. royalties, allow-lists, on-chain checks).

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferHookInstruction,
  getMintLen,
} from '@solana/spl-token';

const mintLen = getMintLen([ExtensionType.TransferHook]);

createInitializeTransferHookInstruction(
  mint,
  payer.publicKey,        // authority that can update the hook program
  transferHookProgramId,  // your deployed hook program
  TOKEN_2022_PROGRAM_ID,
);
```

> **Security caveat:** a transfer hook runs arbitrary program code on every transfer. Holders are exposed to whatever that program does (it can block transfers, enforce fees, or interact with other accounts). Only enable a hook that points at a program you have audited and trust, and treat the hook-update authority like a privileged key. See Best Practices.

#### Transferring a hook mint

A plain `transferChecked` (or `transferCheckedWithFee`) **fails** once the hook
declares extra accounts: the program expects those accounts in the instruction
and the bare transfer doesn't include them. Use the SDK's hook-aware path, which
reads the on-chain extra-account-meta list and appends the accounts for you:

```typescript
import {
  createTransferCheckedWithTransferHookInstruction, // hook-aware transfer builder
} from '@solana/spl-token';

// Builds a transferChecked with the hook's extra accounts already attached.
const ix = await createTransferCheckedWithTransferHookInstruction(
  connection, source, mint, destination, owner,
  amount, decimals, [], 'confirmed', TOKEN_2022_PROGRAM_ID,
);
```

This resolves the extra accounts from the **deployed** hook program, so the
program must exist on the cluster you target (it can't resolve a hook that
hasn't been deployed). For fee + hook mints, use
`createTransferCheckedWithFeeAndTransferHookInstruction`.

## Best Practices

### Authorities

- **Decide mutability up front.** For the genuinely nullable authorities (transfer-fee config authority, transfer-fee withdraw-withheld authority, mint close authority, metadata-pointer authority), passing `null` makes that setting *immutable forever* — pass a real key only if you need to change it later. Not every "authority" is nullable: the permanent delegate, transfer-hook authority, interest-rate authority, and the metadata `updateAuthority` are required `PublicKey` values at init (the permanent delegate IS the feature, not a toggle). See `resources/extensions.md` for the per-API truth.
- **Separate roles.** Use distinct keys for mint authority, freeze authority, fee config authority, and withdraw-withheld authority where possible. Don't concentrate everything in one hot key.
- **Treat permanent delegate as a backdoor.** It can move or burn anyone's tokens at any time. Do *not* enable the `PermanentDelegate` extension unless the use case genuinely needs an unconditional clawback/regulated-asset delegate. When you do enable it, pass a real key — the delegate IS the feature, not an optional toggle, so there is no "or null" middle ground. If you don't need clawback, leave the extension out entirely (omit it from `getMintLen` and skip its init instruction), and disclose it to holders when you do use it.

### Transfer hooks

- A hook executes third-party code on every transfer — the highest-risk extension. Audit the hook program, pin its program ID, and guard the hook-update authority.
- Hooks add compute cost and extra accounts to each transfer. Test transfers end-to-end before launch; budget compute units accordingly.

### Devnet vs mainnet

- **Always validate on devnet first** (`clusterApiUrl('devnet')`, airdrop SOL with `connection.requestAirdrop`). Extension behavior — especially fees, hooks, and default-frozen accounts — is easy to misconfigure and hard to undo on mainnet.
- Some wallets and explorers render Token-2022 extensions inconsistently. Verify your token displays correctly in the target wallet on devnet before going live on mainnet-beta.

### General

- **Always pass `TOKEN_2022_PROGRAM_ID`** to ATA derivation (`getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID)`), ATA creation, mint-to, and transfer helpers. The default is the classic program and will fail against a Token-2022 mint.
- **Size for the future you ship, not the future you imagine.** Extensions can't be added after the mint is initialized — choose the full extension set at creation time.
- **Use `transferCheckedWithFee`** (not plain `transferChecked`) for fee-bearing mints so the expected fee is asserted on-chain.

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `TokenInvalidAccountOwnerError` / `IncorrectProgramId` | Used `TOKEN_PROGRAM_ID` (classic) on a Token-2022 mint, or omitted the program ID so it defaulted | Pass `TOKEN_2022_PROGRAM_ID` to every ATA, mint-to, and transfer call |
| `InvalidAccountData` / extension init fails | `createInitializeMintInstruction` ran *before* an extension init, or account allocated too small | Init all extensions first, mint last; size with `getMintLen([...all extensions])` |
| Account is not rent-exempt / metadata init fails | Funded rent for `getMintLen` only, ignoring the variable-length metadata blob | Fund `mintLen + (TYPE_SIZE + LENGTH_SIZE + pack(metadata).length)` lamports |
| `Transfer is disabled for this mint` | Tried to transfer a `NonTransferable` (soulbound) token | Expected — non-transferable mints can only be minted and burned |
| Transfer to a non-existent ATA fails | Recipient ATA was never created | Add `createAssociatedTokenAccountInstruction(..., TOKEN_2022_PROGRAM_ID)` (or use `getOrCreateAssociatedTokenAccount`) before transferring |
| `TransferFeeExceedsMaximum` / fee mismatch | Wrong fee passed to `createTransferCheckedWithFeeInstruction` | Compute `fee = amount * bps / 10_000`, then cap at the configured maximum fee |
| `ExtensionType not supported` / mismatch | Tried to add an extension after the mint was initialized | Recreate the mint with the extension included from the start |
| Account is frozen / mint-to or transfer reverts | Mint has `DefaultAccountState = Frozen`; the new account was never thawed | Thaw it first with `createThawAccountInstruction(account, mint, freezeAuthority, [], TOKEN_2022_PROGRAM_ID)`; ensure the mint has a non-null freeze authority |
| Transfer of a hook mint fails / missing accounts | Used plain `transferChecked` on a mint whose hook needs extra accounts | Use `createTransferCheckedWithTransferHookInstruction` (or `...WithFeeAndTransferHookInstruction`); the hook program must be deployed on the target cluster |

## Resources

- [Token-2022 / Token Extensions overview](https://solana.com/developers/guides/token-extensions/getting-started)
- [SPL Token Extensions docs](https://www.solana-program.com/docs/token-2022)
- [Extension guides (per-extension)](https://solana.com/developers/guides/token-extensions/transfer-fee)
- [@solana/spl-token (npm)](https://www.npmjs.com/package/@solana/spl-token)
- [@solana/spl-token-metadata (npm)](https://www.npmjs.com/package/@solana/spl-token-metadata)
- [solana-program/token-2022 (GitHub)](https://github.com/solana-program/token-2022)

## Skill Structure

```
token-2022/
├── SKILL.md                                  # This file
├── resources/
│   ├── extensions.md                         # Every extension: enum, init instruction, behavior, mutability
│   └── program-addresses.md                  # Program IDs
├── examples/
│   ├── create-mint-with-transfer-fee/
│   │   └── example.ts                        # Full: fee + metadata-pointer + metadata, mint, transfer, harvest
│   └── non-transferable-soulbound/
│       └── example.ts                        # Soulbound mint + a rejected transfer
├── templates/
│   └── setup.ts                              # Connection + payer + buildToken2022Mint helper (placeholders)
└── docs/
    └── troubleshooting.md                    # Common errors and fixes
```
