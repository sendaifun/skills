---
name: token-2022
description: Create and integrate Token-2022 (Token Extensions) mints on Solana: transfer fees, transfer hooks, confidential transfers, metadata pointer + token metadata, interest-bearing, non-transferable, permanent delegate, default account state, scaled UI amount and pausable. Covers the correct extension-initialization order, ATA handling, transferChecked requirements, detecting which token program owns a mint, and both the @solana/spl-token (web3.js) and kit @solana-program/token-2022 SDKs. Use when minting or integrating tokens that use the Token-2022 program.
---

# Token-2022 (Token Extensions)

Token-2022 is the extension-enabled successor to the original SPL Token program. This skill covers creating extension mints with the correct initialization order and integrating them safely — ATAs, `transferChecked`, fee/hook resolution, and program detection — across both the `@solana/spl-token` (web3.js) and kit `@solana-program/token-2022` SDKs.

## Overview

Token-2022 (program id `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, also called "Token Extensions") is a **separate on-chain program** from classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). It is a superset: every classic instruction (`InitializeMint`, `MintTo`, `TransferChecked`, `Burn`, …) exists with an identical layout, plus a set of **extensions** that bolt extra behavior onto a mint or token account.

Extensions are stored using **TLV** (Type-Length-Value) encoding appended after the fixed 82-byte mint / 165-byte account base data:

```
TYPE_SIZE   = 2   // u16 little-endian: which extension (the ExtensionType discriminant)
LENGTH_SIZE = 2   // u16 little-endian: byte length of this extension's data
<value>           // the extension's serialized state
```

Because the layout is self-describing, one program supports an open-ended set of features without new account types. That is why Token-2022 has become the default primitive for **regulated and programmable money**:

- **Stablecoins / RWAs** (USDG, PYUSD, AUSD and others mint under Token-2022): `TransferFeeConfig` for protocol revenue, `PermanentDelegate` + `DefaultAccountState` for compliance freezes/clawback, `Pausable` for emergency stops, `ConfidentialTransfer` for private balances with an optional auditor key.
- **Royalty / allowlist tokens**: `TransferHook` invokes a custom program on every transfer.
- **Rebasing / interest tokens**: `InterestBearingConfig` and `ScaledUiAmount` change the *displayed* amount without moving lamports.
- **Self-describing tokens**: `MetadataPointer` + `TokenMetadata` put name/symbol/URI **inside the mint**, no Metaplex account required.

The two costs of this power: (1) a strict **extension-initialization order** (get it wrong and `InitializeMint` fails), and (2) every integration must **thread the owning token program id** through ATA derivation and transfers, because nothing defaults to Token-2022.

> Verified versions used throughout: `@solana/spl-token` **0.4.14**, `@solana/spl-token-metadata` **0.1.6**, `@solana-program/token-2022` **0.12.0** (kit), `@solana/kit` **7.0.0**, `@solana/web3.js` **1.98.4**, `@solana/zk-sdk` **0.4.2**, Rust `spl-token-2022` **11.0.0**. See `resources/program-addresses.md` and `resources/sdk-reference.md`.

## Quick Start — integrate an existing Token-2022 mint

The most common task is **integrating**, not minting: given a mint address, hold and move it correctly. The rule of thumb is "detect the program, then thread it through everything." This minimal flow creates the recipient's ATA and sends a checked transfer (creating a mint is covered later under [Creating a mint with extensions](#creating-a-mint-with-extensions--the-critical-order)):

```ts
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, clusterApiUrl,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const payer = Keypair.generate();           // fund on devnet
const mint = new PublicKey('<MINT_ADDRESS>');
const recipient = new PublicKey('<RECIPIENT_OWNER>');

// 1. Detect the owning token program from the mint account itself.
const acc = await connection.getAccountInfo(mint);
if (!acc) throw new Error('mint not found');
const programId = acc.owner;                 // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID

// 2. Derive ATAs UNDER THAT PROGRAM (the program id is a PDA seed).
const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, programId);
const destAta   = getAssociatedTokenAddressSync(mint, recipient,      false, programId);

// 3. Read decimals (needed by every checked instruction); pass the detected program.
const { decimals } = await getMint(connection, mint, 'confirmed', programId);

// 4. Create the recipient ATA (idempotent) + a CHECKED transfer, in one tx.
const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey, destAta, recipient, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID,
  ),
  createTransferCheckedInstruction(
    sourceAta, mint, destAta, payer.publicKey, BigInt(1_000_000), decimals, [], programId,
  ),
);
await sendAndConfirmTransaction(connection, tx, [payer]);
```

This is safe for a plain mint. If the mint carries `TransferFeeConfig` or `TransferHook`, swap step 4's builder for the fee/hook-aware variant (see [Transferring](#transferring)). The rest of this skill explains each piece in depth.

## Token-2022 vs SPL Token — which to use

| Question | Classic SPL Token | Token-2022 |
|---|---|---|
| Program id | `Tokenkeg…623VQ5DA` | `Tokenz…PxuEb` |
| Need transfer fees, hooks, confidential balances, in-mint metadata, interest, pausable, permanent delegate? | Not possible | **Use Token-2022** |
| Plain fungible token, maximum wallet/DEX/CEX compatibility, no special behavior | **Use classic** (still the safest default for a no-frills token) | Works, but extensions may not render everywhere |
| In-mint metadata without Metaplex | No (needs Metaplex Token Metadata) | **Yes** (`MetadataPointer` + `TokenMetadata`) |
| Wallet / explorer / DEX support | Universal | Broad but **uneven per extension** — hooks, confidential, scaled-UI historically lagged |
| Convert an existing mint between programs | — | **Not possible** — the owning program is fixed at mint creation |
| Rust crate / JS package | `spl-token` 9.0.0 / `@solana/spl-token` | `spl-token-2022` 11.0.0 / `@solana/spl-token` (same JS pkg, pass `TOKEN_2022_PROGRAM_ID`) or kit `@solana-program/token-2022` |

**Key caveats:**

- **You cannot migrate a mint.** A mint's owning program is set when the account is allocated and is permanent. To "move" a token to Token-2022 you mint a brand-new token and run a swap/airdrop. Plan the program choice up front.
- **Extension support is per-wallet and per-extension.** Most wallets handle fees and metadata; transfer hooks, confidential transfers, and scaled-UI amount have historically rendered or transacted inconsistently. Test on your target wallets/explorers before launch.
- **A DEX or protocol must opt in.** Integrators that hard-code `TOKEN_PROGRAM_ID` will reject your mint. Confirm your target venues support Token-2022 (and your specific extensions — a transfer hook can break naive AMMs).

## Program IDs & ATAs

```ts
import {
  TOKEN_PROGRAM_ID,            // Tokenkeg…623VQ5DA   (classic)
  TOKEN_2022_PROGRAM_ID,       // Tokenz…PxuEb        (Token Extensions)
  ASSOCIATED_TOKEN_PROGRAM_ID, // ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
} from '@solana/spl-token';
```

There is **one** Associated Token Account program (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`) shared by both token programs. But the **derived ATA address differs**, because the token program id is one of the PDA seeds:

```
seeds   = [ owner_pubkey, token_program_id, mint_pubkey ]
program = ASSOCIATED_TOKEN_PROGRAM_ID
```

So for the same `(owner, mint)` the ATA under `TOKEN_PROGRAM_ID` is a **different account** than the ATA under `TOKEN_2022_PROGRAM_ID`. Derive an ATA with the wrong token program and every downstream instruction fails with a wrong-owner / `IncorrectProgramId` error. Always pass the mint's owning token program:

```ts
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
// getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve?, programId?, associatedTokenProgramId?)
const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
```

Note also that wrapped SOL has two mints: `NATIVE_MINT` (`So111…112`, classic) and `NATIVE_MINT_2022` (`9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP`). Pick the one matching the token program. Full address list and the ZK ElGamal Proof program id are in `resources/program-addresses.md`.

## SDK choice

Two JavaScript paths wrap the same on-chain program with identical instruction layouts. Pick by which client framework your codebase uses.

| | `@solana/spl-token` **0.4.14** | kit `@solana-program/token-2022` **0.12.0** |
|---|---|---|
| Base library | `@solana/web3.js` 1.x (`Connection`, `PublicKey`, `Transaction`) | `@solana/kit` 7.x (`Address`, `Rpc`, `IInstruction`) |
| Style | named functions, `programId?` arg switches programs | tree-shakable instruction builders `get<Name>Instruction(...)` |
| Dominance | The default in tutorials/most apps today | Modern functional path; required for confidential transfers |
| Confidential transfers | **Not supported** (no module) | **Supported** (+ `@solana/zk-sdk` 0.4.2) |
| Account decode | `getMint` / `unpackMint` | `fetchMint` / `decodeMint` |
| Mint creation helper | manual ix ordering | `getCreateMintInstructionPlan({ … })` (orders for you) |

```bash
# web3.js path (primary)
npm i @solana/spl-token@0.4.14 @solana/web3.js@1.98.4

# kit path (modern; required for confidential transfers)
npm i @solana-program/token-2022@0.12.0 @solana-program/system @solana/kit@7.0.0 @solana/zk-sdk@0.4.2
```

This skill **leads with `@solana/spl-token`** (web3.js) and shows kit equivalents alongside. **Confidential transfers are the exception**: `@solana/spl-token` 0.4.14 has no confidential module, so use the kit client + `@solana/zk-sdk` (or the Rust/CLI path). Full function-by-function mapping is in `resources/sdk-reference.md`.

## Extension catalog

The `ExtensionType` discriminant is the on-chain TLV type number. "Mint" extensions are configured on the mint; "Account" extensions live on individual token accounts. Several mint extensions auto-add a paired **account** marker that you never initialize yourself. "Change after init?" describes whether the behavior/config can be updated or disabled once set — **note that every extension's *presence* must be declared at mint creation; you cannot add an extension to an existing mint.**

| # | ExtensionType (JS name if different) | Mint/Account | Change after init? | Purpose | In JS SDK 0.4.14? |
|---|---|---|---|---|---|
| 1 | `TransferFeeConfig` | Mint | Fee/max updatable; authority revocable | Protocol fee (bps + cap), withheld on recipient accounts | Yes |
| 2 | `TransferFeeAmount` | Account | Auto-paired | Per-account withheld-fee accumulator | Yes (auto) |
| 3 | `MintCloseAuthority` | Mint | Authority can close mint (supply 0) | Reclaim mint rent | Yes |
| 4 | `ConfidentialTransferMint` | Mint | Config updatable | Encrypted balances + optional auditor key | **No** — enum only; use kit + `@solana/zk-sdk` |
| 5 | `ConfidentialTransferAccount` | Account | Auto-paired | Per-account encrypted balance state | **No** — enum only (auto) |
| 6 | `DefaultAccountState` | Mint | Updatable by freeze authority | New token accounts start `Frozen`/`Initialized` | Yes |
| 7 | `ImmutableOwner` | Account | Permanent | Owner cannot be reassigned (ATAs always set this) | Yes |
| 8 | `MemoTransfer` | Account | Toggle per account | Require a memo on incoming transfers | Yes |
| 9 | `NonTransferable` | Mint | **Permanent** | Soul-bound: tokens cannot be transferred | Yes |
| 10 | `InterestBearingConfig` | Mint | Rate updatable | UI amount accrues continuous interest (cosmetic) | Yes |
| 11 | `CpiGuard` | Account | Toggle per account | Block privileged token ops via CPI | Yes |
| 12 | `PermanentDelegate` | Mint | **Permanent** | Unrestricted delegate over ALL accounts (transfer/burn) | Yes |
| 13 | `NonTransferableAccount` | Account | Auto-paired | Marker on accounts of a non-transferable mint | Yes (auto) |
| 14 | `TransferHook` | Mint | Hook program updatable | CPI a custom program on every transfer | Yes |
| 15 | `TransferHookAccount` | Account | Auto-paired | Marker + `transferring` flag during CPI | Yes (auto) |
| 16 | `ConfidentialTransferFeeConfig` | Mint | Config updatable | Encrypted withheld fees (confidential + fees) | **No** |
| 17 | `ConfidentialTransferFeeAmount` | Account | Auto-paired | Per-account encrypted withheld fees | **No** |
| 18 | `MetadataPointer` | Mint | Pointer updatable | Points to the metadata account (often the mint itself) | Yes |
| 19 | `TokenMetadata` | Mint | Fields updatable; authority revocable | In-mint name/symbol/uri/additional (variable length) | Yes |
| 20 | `GroupPointer` | Mint | Pointer updatable | Points to a group/collection config account | Yes |
| 21 | `TokenGroup` | Mint | Config updatable | In-mint group/collection config (variable) | Yes |
| 22 | `GroupMemberPointer` | Mint | Pointer updatable | Points to the group-member account | Yes |
| 23 | `TokenGroupMember` | Mint | Updatable | In-mint group-membership data (variable) | Yes |
| 24 | `ConfidentialMintBurn` | Mint | Config updatable | Confidential mint & burn | **No** |
| 25 | `ScaledUiAmount` (`ScaledUiAmountConfig`) | Mint | Multiplier updatable | Multiplier on displayed UI amount (splits/rebasing) | Yes |
| 26 | `Pausable` (`PausableConfig`) | Mint | Pause/resume toggle | Pause all transfers/mints/burns | Yes |
| 27 | `PausableAccount` | Account | Auto-paired | Marker on accounts of a pausable mint | Yes (auto) |
| 28 | `PermissionedBurn` | Mint | Config | Burns require a burn authority co-signature | **No** (cutting-edge) |

**JS SDK 0.4.14 omits**: `ConfidentialTransferFeeConfig`/`Amount` (16/17), `ConfidentialMintBurn` (24), and `PermissionedBurn` (28). All exist in the on-chain program (Rust `spl-token-2022` 11.0.0); use the kit client / Rust / CLI for those.

**Auto-paired extensions** (configure on the mint; the account marker is added automatically when a token account is created — never initialize the account side yourself): `TransferFeeConfig→TransferFeeAmount`, `ConfidentialTransferMint→ConfidentialTransferAccount`, `NonTransferable→NonTransferableAccount`, `TransferHook→TransferHookAccount`, `Pausable→PausableAccount`, `ConfidentialTransferFeeConfig→ConfidentialTransferFeeAmount`.

**Account-only extensions you DO initialize per token account**: `ImmutableOwner` (ATAs already have it), `MemoTransfer`, `CpiGuard`.

Per-extension parameters, sizes, and init function names are in `resources/extensions-reference.md`; full how-to code per extension is in `docs/extensions-guide.md`.

## Creating a mint with extensions — THE CRITICAL ORDER

This is the section that determines whether your mint compiles or fails on-chain. All mint setup happens in **one transaction**, in this exact order:

```
1. SystemProgram.createAccount        // space = getMintLen([FIXED extensions]); fund rent
2. createInitialize<Extension>Ix      // ONE per FIXED-length extension (any order among themselves)
3. createInitializeMintInstruction    // LAST of the mint-setup steps — "seals" the layout
4. (variable-length only) metadata/group init   // AFTER initializeMint
```

Why the order is mandatory:

- `InitializeMint` finalizes the mint and **rejects any extension init afterward** ("extension already initialized" / `InvalidAccountData`).
- `InitializeMint` also **rejects an account whose size doesn't match the declared extensions** — so `createAccount` must allocate `getMintLen([...])` for exactly the fixed extensions you will init.
- **Variable-length** extensions (`TokenMetadata`, `TokenGroup`, `TokenGroupMember`) are the *only* inits that run **after** `InitializeMint`. Their fixed-length pointer (`MetadataPointer`, `GroupPointer`) is initialized **before** the mint like any other fixed extension; the variable data is written after. `getMintLen` does **not** count variable-length data unless you pass `variableLengthExtensions` — for metadata, size only the fixed extensions and add the metadata bytes to the rent (shown below).

### `getMintLen` and `createInitializeMintInstruction` signatures

```ts
// getMintLen(extensionTypes: ExtensionType[], variableLengthExtensions?): number
const mintLen = getMintLen([ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig]);

// createInitializeMintInstruction(mint, decimals, mintAuthority, freezeAuthority, programId?)
// programId defaults to LEGACY Token — always pass TOKEN_2022_PROGRAM_ID.
```

### Worked example — MetadataPointer + TransferFee + in-mint TokenMetadata

Copy-paste runnable (Node 20+, `@solana/spl-token@0.4.14` + `@solana/web3.js@1.98.4`). This is the canonical pattern: **createAccount → fixed-extension inits → initializeMint → metadata init**.

```ts
import {
  Connection, Keypair, SystemProgram, Transaction,
  sendAndConfirmTransaction, clusterApiUrl,
} from '@solana/web3.js';
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID,
  getMintLen, createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferFeeConfigInstruction,
  TYPE_SIZE, LENGTH_SIZE,
} from '@solana/spl-token';
import { createInitializeInstruction, pack, type TokenMetadata } from '@solana/spl-token-metadata';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const payer = Keypair.generate();        // fund this on devnet first
const mintKp = Keypair.generate();
const mint = mintKp.publicKey;
const decimals = 6;

// 1. Metadata blob — the mint points to ITSELF as its metadata account.
const metadata: TokenMetadata = {
  mint,
  name: 'Example Token',
  symbol: 'EXMPL',
  uri: 'https://example.com/token.json',
  additionalMetadata: [['category', 'stablecoin']],
};

// 2. Size the account for the FIXED extensions; size TokenMetadata separately for rent.
const extensions = [ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig];
const mintLen = getMintLen(extensions);
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

const tx = new Transaction().add(
  // (a) allocate the mint — space = mintLen (fixed exts only); rent covers metadata too
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  }),
  // (b) FIXED-length extension inits — BEFORE initializeMint, in any order among themselves
  createInitializeMetadataPointerInstruction(
    mint, payer.publicKey /* update authority */, mint /* metadata = self */, TOKEN_2022_PROGRAM_ID,
  ),
  createInitializeTransferFeeConfigInstruction(
    mint,
    payer.publicKey,      // transferFeeConfigAuthority (can later update the fee)
    payer.publicKey,      // withdrawWithheldAuthority (can harvest fees)
    50,                   // 50 bps = 0.5%
    BigInt(5_000),        // maximumFee per transfer, in base units
    TOKEN_2022_PROGRAM_ID,
  ),
  // (c) initialize the mint — LAST of the mint-setup steps
  createInitializeMintInstruction(
    mint, decimals, payer.publicKey /* mint auth */, payer.publicKey /* freeze auth */, TOKEN_2022_PROGRAM_ID,
  ),
  // (d) variable-length TokenMetadata — AFTER initializeMint
  createInitializeInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    metadata: mint,
    updateAuthority: payer.publicKey,
    mint,
    mintAuthority: payer.publicKey,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
  }),
);

await sendAndConfirmTransaction(connection, tx, [payer, mintKp]);
```

> Gotcha: if you add `additionalMetadata` you must include its packed size in `metadataLen` (handled by `pack(metadata)` above). Adding fields *later* via `createUpdateFieldInstruction` reallocs the mint and may need an explicit lamport top-up before the realloc.

### Kit equivalent

The kit client's `getCreateMintInstructionPlan` computes space via `getMintSize(extensions)` and emits create-account → pre-init → `initializeMint2` → post-init metadata in the right order for you. Extensions are a tagged union keyed by `__kind`:

```ts
import { getCreateMintInstructionPlan, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';

const extensions = [
  { __kind: 'TransferFeeConfig', transferFeeConfigAuthority, withdrawWithheldAuthority,
    transferFeeBasisPoints: 50, maximumFee: 5_000n },
  { __kind: 'MetadataPointer', authority: some(updateAuthority), metadataAddress: some(mint.address) },
  { __kind: 'TokenMetadata', name: 'Example Token', symbol: 'EXMPL', uri: 'https://example.com/token.json',
    additionalMetadata: new Map([['category', 'stablecoin']]) },
];
const plan = getCreateMintInstructionPlan({ newMint: mint, payer, mintAuthority, decimals: 6, extensions });
```

A full runnable version of both paths is in `examples/create-mint-with-extensions/`.

## Associated token accounts

Always derive and create ATAs with the **mint's owning token program**. ATAs created under Token-2022 automatically carry the `ImmutableOwner` extension (no manual init needed):

```ts
import {
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

// createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint, programId?, associatedTokenProgramId?)
const ix = createAssociatedTokenAccountInstruction(
  payer.publicKey, ata, owner, mint,
  TOKEN_2022_PROGRAM_ID,            // the MINT's owning token program (NOT the ATA program)
  ASSOCIATED_TOKEN_PROGRAM_ID,
);

// Prefer the idempotent variant in production (no failure if the ATA already exists):
const ixIdem = createAssociatedTokenAccountIdempotentInstruction(
  payer.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);

// High-level helper (fetch-or-create) — also takes the program id:
// getOrCreateAssociatedTokenAccount(connection, payer, mint, owner, allowOwnerOffCurve?, commitment?, confirmOptions?, programId?, associatedTokenProgramId?)
const acct = await getOrCreateAssociatedTokenAccount(
  connection, payer, mint, owner, false, 'confirmed', undefined,
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
);
```

The `programId` argument is positional and easy to drop. If you omit it, the helper derives a **legacy** ATA and you get a different address than the mint expects.

## Transferring

Always use **`transferChecked`** (or its extension-aware variants) for Token-2022. The unchecked `Transfer` instruction passes neither `mint` nor `decimals`, so the program cannot validate them — and most extensions require that data. Plain `transfer()` will fail or silently move the wrong amount.

```ts
import {
  createTransferCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

// Plain mint (no fee / no hook):
// createTransferCheckedInstruction(source, mint, destination, owner, amount, decimals, multiSigners?, programId?)
const ix = createTransferCheckedInstruction(
  srcAta, mint, dstAta, owner, BigInt(1_000_000), decimals, [], TOKEN_2022_PROGRAM_ID,
);

// Transfer-FEE mint — supply the explicit fee (compute it from the mint's bps + maximumFee):
// createTransferCheckedWithFeeInstruction(source, mint, destination, authority, amount, decimals, fee, multiSigners?, programId?)
const feeIx = createTransferCheckedWithFeeInstruction(
  srcAta, mint, dstAta, owner, BigInt(1_000_000), decimals, BigInt(5_000), [], TOKEN_2022_PROGRAM_ID,
);

// Transfer-HOOK mint — ASYNC; reads the on-chain ExtraAccountMetaList and appends the resolved accounts:
// createTransferCheckedWithTransferHookInstruction(connection, source, mint, destination, owner, amount, decimals, multiSigners?, commitment?, programId?)
const hookIx = await createTransferCheckedWithTransferHookInstruction(
  connection, srcAta, mint, dstAta, owner, BigInt(1_000_000), decimals, [], 'confirmed', TOKEN_2022_PROGRAM_ID,
);
```

**Choosing the right transfer builder:**

- No fee, no hook → `createTransferCheckedInstruction`.
- Mint has `TransferFeeConfig` → `createTransferCheckedWithFeeInstruction` (pass the computed fee). A plain checked transfer on a fee mint can fail or under-pay the withheld amount.
- Mint has `TransferHook` → `createTransferCheckedWithTransferHookInstruction` (async). A plain checked transfer **fails with missing accounts** because the hook's extra accounts aren't present. For fee+hook mints use `createTransferCheckedWithFeeAndTransferHookInstruction`.
- Don't know? Read the mint's extensions first (or branch on detection — see below). When in doubt, the hook-resolving variant is safe even on non-hook mints.

### Minting and burning

Use the **checked** variants here too — they validate `decimals` against the mint:

```ts
import { createMintToCheckedInstruction, createBurnCheckedInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// createMintToCheckedInstruction(mint, destination, authority, amount, decimals, multiSigners?, programId?)
const mintIx = createMintToCheckedInstruction(mint, destAta, mintAuthority, BigInt(1_000_000), decimals, [], TOKEN_2022_PROGRAM_ID);

// createBurnCheckedInstruction(account, mint, owner, amount, decimals, multiSigners?, programId?)
const burnIx = createBurnCheckedInstruction(srcAta, mint, owner, BigInt(500_000), decimals, [], TOKEN_2022_PROGRAM_ID);
```

`Pausable` mints reject mint/burn/transfer while paused; `NonTransferable` mints allow mint and burn but reject transfer; `DefaultAccountState = Frozen` requires the freeze authority to `thawAccount` a destination before it can receive a `MintTo`.

## Key extensions tour

Short orientation; full code for each is in `docs/extensions-guide.md` (and the dedicated docs noted below).

- **Transfer fee** (`TransferFeeConfig`) — fee in basis points + a per-transfer cap. The fee is *withheld on the recipient's account*; the `withdrawWithheldAuthority` harvests it with `createHarvestWithheldTokensToMintInstruction` / `createWithdrawWithheldTokensFromAccountsInstruction`. Runnable demo: `examples/transfer-fees/`.
- **Metadata** (`MetadataPointer` + `TokenMetadata`) — name/symbol/uri stored in the mint; no Metaplex account. Update with `createUpdateFieldInstruction`; lock by setting update authority to `null`. Runnable demo: `examples/metadata/`.
- **Interest-bearing** (`InterestBearingConfig`) — a basis-points/year rate (i16) that grows the *displayed* UI amount continuously. Purely cosmetic — no tokens are minted. Update with `createUpdateRateInterestBearingMintInstruction`. Runnable demo: `examples/interest-bearing/`.
- **Non-transferable** (`NonTransferable`) — soul-bound tokens; permanent. Holders can still burn/close. Runnable demo: `examples/non-transferable/`.
- **Permanent delegate** (`PermanentDelegate`) — an authority that can transfer/burn from **any** holder's account without consent. Powerful for clawback/compliance; a serious **trust hazard** — wallets warn on it. Permanent once set.
- **Default account state** (`DefaultAccountState`) — new token accounts open `Frozen`, so the freeze authority must `thawAccount` before use (allowlist gating). Update with `createUpdateDefaultAccountStateInstruction`.
- **Transfer hook** (`TransferHook`) — CPI a custom program on every transfer for royalties/allowlists/counters. Requires an `ExtraAccountMetaList` PDA and client-side account resolution. Full build-a-hook guide (Rust program + TS client): `docs/transfer-hooks.md`; example: `examples/transfer-hook/`.
- **Confidential transfer** (`ConfidentialTransferMint`) — encrypted balances via twisted-ElGamal + the ZK ElGamal Proof program, with an optional auditor key. **Not in `@solana/spl-token`** — use kit + `@solana/zk-sdk`. Full guide and mainnet-availability caveat: `docs/confidential-transfers.md`.
- **Scaled UI amount** (`ScaledUiAmount`) and **Pausable** — a display multiplier for stock-split/rebasing, and an emergency pause (`createPauseInstruction` / `createResumeInstruction`). Both in 0.4.14; see `docs/extensions-guide.md`.

## Supporting both token programs

An app that handles arbitrary mints must detect each mint's owning program and thread it everywhere. The owning program is the **account's `owner` field** — not anything inside the mint data. There is **no `getTokenProgramForMint` helper** in `@solana/spl-token`; detect it yourself, then pass it to `getMint`, ATA derivation, and every transfer.

```ts
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint,
  getAssociatedTokenAddressSync, programSupportsExtensions,
} from '@solana/spl-token';
import { PublicKey, Connection } from '@solana/web3.js';

async function getTokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error('Mint not found');
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID))      return TOKEN_PROGRAM_ID;
  throw new Error(`Not a token mint, owner=${info.owner.toBase58()}`);
}

const programId = await getTokenProgramForMint(connection, mint);
const mintInfo  = await getMint(connection, mint, 'confirmed', programId);          // pass detected id
const ata       = getAssociatedTokenAddressSync(mint, owner, false, programId);     // ATA seed = programId
const isT22     = programSupportsExtensions(programId);                             // true for Token-2022
```

`programSupportsExtensions(programId)` returns `true` for Token-2022 and `false` for classic — useful to decide whether to read extensions. To list **all** of a wallet's token accounts you must call `getTokenAccountsByOwner` **twice** (once per program id); there is no combined call. Full both-program integration patterns and gotchas: `docs/migration-from-spl.md`.

### Reading a mint's extensions

`getMint(connection, mint, commitment?, programId?)` returns the base mint plus a `tlvData` buffer holding the raw extension TLV entries. `@solana/spl-token` provides per-extension getters that unpack that buffer — for example `getTransferFeeConfig(mint)`, `getInterestBearingMintConfigState(mint)`, `getMetadataPointerState(mint)`, and `getTokenMetadata(connection, address, …)` for the in-mint metadata. Use them to branch your integration (e.g. detect a fee or hook before choosing a transfer builder):

```ts
import { getMint, getTransferFeeConfig, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const mintState = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
const feeConfig = getTransferFeeConfig(mintState);   // null if the mint has no transfer fee
if (feeConfig) {
  const { transferFeeBasisPoints, maximumFee } = feeConfig.newerTransferFee;
  // compute fee = min(amount * bps / 10_000, maximumFee) and use createTransferCheckedWithFeeInstruction
}
```

> The per-extension getters (`getTransferFeeConfig`, `getInterestBearingMintConfigState`, `getMetadataPointerState`, `getTokenMetadata`) and `getMint(...).tlvData` are stable `@solana/spl-token` 0.4.14 helpers; exact field shapes are in `resources/sdk-reference.md`.

## Guidelines

**DO:**
- **DO** allocate `createAccount` with `getMintLen([fixed extensions])` and init those extensions **before** `createInitializeMintInstruction`, all in one transaction.
- **DO** init variable-length `TokenMetadata`/`TokenGroup` **after** `initializeMint`, and add their packed size to the rent (`getMinimumBalanceForRentExemption(mintLen + metadataLen)`).
- **DO** pass `TOKEN_2022_PROGRAM_ID` explicitly to every builder — `createInitializeMintInstruction`, `getAssociatedTokenAddressSync`, `transferChecked`, `getMint`, ATA creation. Optional `programId` args default to **legacy** Token.
- **DO** use `transferChecked` (and `…WithFee` / `…WithTransferHook` variants) for every transfer.
- **DO** detect a mint's owning program via its account `.owner` and thread that program id through ATA derivation and all instructions.
- **DO** choose extensions up front — most are permanent or can only be locked (authority → `null`), and a mint can never switch programs.
- **DO** test wallet/explorer/DEX rendering and transferability for your specific extensions (especially hooks, confidential, scaled-UI) before mainnet.

**DON'T:**
- **DON'T** call the unchecked `transfer()` on a Token-2022 mint — it omits `mint`/`decimals` and most extensions reject it.
- **DON'T** manually initialize auto-paired account extensions (`TransferFeeAmount`, `TransferHookAccount`, `NonTransferableAccount`, `PausableAccount`, `ConfidentialTransferAccount`) — Token-2022 adds them when the account is created.
- **DON'T** derive or create an ATA with the default (legacy) program for a Token-2022 mint — you'll get a different address and wrong-owner failures.
- **DON'T** assume `@solana/spl-token` can do confidential transfers (it can't) or assume confidential transfers are active on your cluster — verify the ZK ElGamal Proof feature gate.
- **DON'T** assume every wallet/protocol supports your extension — a transfer hook can break naive integrators that call plain `transferChecked`.
- **DON'T** forget rent for extension space; an undersized `createAccount` makes `initializeMint` fail.

## Common Errors

### Error: `InvalidAccountData` on `InitializeMint`
**Cause** Extension init instructions were placed **after** `createInitializeMintInstruction`, or `createAccount` allocated the wrong size, or the extension set didn't match the allocated space. Initializing the mint seals the layout.
**Solution** Order the transaction `createAccount(getMintLen([fixed exts])) → fixed-extension inits → initializeMint → variable-length metadata/group`. Ensure `getMintLen` lists exactly the fixed extensions you initialize.

### Error: instructions silently target the classic Token program
**Cause** The optional `programId` argument was omitted, so the function defaulted to `TOKEN_PROGRAM_ID`. The transaction may even succeed but against the wrong program/account.
**Solution** Pass `TOKEN_2022_PROGRAM_ID` explicitly to `createInitializeMintInstruction`, `getAssociatedTokenAddressSync`, ATA creation, `transferChecked`, and `getMint`.

### Error: `TokenInvalidAccountOwnerError` / `IncorrectProgramId` / "account not found"
**Cause** An ATA was derived or created under the wrong token program. The ATA address depends on the token program id (it's a PDA seed), so a Token-2022 ATA ≠ a legacy ATA for the same `(owner, mint)`.
**Solution** Detect the mint's owner (`getAccountInfo(mint).owner`) and pass that program id to `getAssociatedTokenAddressSync` and `createAssociatedTokenAccountInstruction`.

### Error: transfer fails with missing accounts (transfer-hook mint)
**Cause** A plain `createTransferCheckedInstruction` was used on a mint with `TransferHook`; the hook's `ExtraAccountMetaList` accounts weren't resolved and appended.
**Solution** Use `createTransferCheckedWithTransferHookInstruction` (async — it reads the validation PDA via RPC) or `addExtraAccountMetasForExecute`. For fee+hook mints use `createTransferCheckedWithFeeAndTransferHookInstruction`.

### Error: insufficient funds / fee accounting wrong (transfer-fee mint)
**Cause** Transferred a fee mint with a plain checked transfer, so the withheld fee wasn't accounted for, or the explicit fee was miscalculated.
**Solution** Use `createTransferCheckedWithFeeInstruction` and compute the fee as `min(amount * bps / 10_000, maximumFee)` from the mint's `TransferFeeConfig`.

### Error: `ExtensionTypeMismatch` / "extension not found"
**Cause** Read or wrote an extension that the mint/account doesn't have, mixed a mint extension with an account (or vice-versa), or used a different program id than the account's owner.
**Solution** Confirm the extension exists on that account (`getExtensionData` / `getMint(... programId)` with the correct program), and that you're using mint-side vs account-side extensions correctly. Auto-paired account extensions are added by the program, not by you.

### Error: confidential transfer fails / proof program unavailable
**Cause** The ZK ElGamal Proof program (`ZkE1Gama1Proof11111111111111111111111111111`) is gated off on your cluster, or you tried to do confidential transfers with `@solana/spl-token` (which has no confidential module).
**Solution** Verify the feature gate is active on your cluster/epoch (it was disabled Jun 2025 and re-enabled on mainnet-beta ~2026-06-29). Use the kit `@solana-program/token-2022` client + `@solana/zk-sdk`, or the Rust/CLI path. See `docs/confidential-transfers.md`.

More build/test errors and fixes: `docs/troubleshooting.md`.

## Files in This Skill

```
token-2022/
├── SKILL.md                              # This file — entry point & decision guide
├── docs/
│   ├── extensions-guide.md               # Per-extension how-to with code (fees, metadata,
│   │                                     #   interest, non-transferable, permanent delegate,
│   │                                     #   default state, scaled-UI, pausable, group, memo, CPI guard)
│   ├── transfer-hooks.md                 # Build a hook program (Rust/Anchor 1.x) + TS client resolution
│   ├── confidential-transfers.md         # ElGamal keys, configure/deposit/apply/transfer/withdraw,
│   │                                     #   ZK ElGamal Proof program + mainnet availability caveat
│   ├── migration-from-spl.md             # Differences; supporting both programs; owner detection
│   └── troubleshooting.md                # Build/test/runtime error catalog with fixes
├── resources/
│   ├── extensions-reference.md           # Table: extension | mint/account | reversible | params | init fn
│   ├── program-addresses.md              # Program ids, ATA program, ZK ElGamal Proof, wrapped SOL mints
│   └── sdk-reference.md                  # @solana/spl-token ↔ kit @solana-program/token-2022 mapping
├── examples/
│   ├── create-mint-with-extensions/      # web3.js + kit: full mint creation in correct order
│   ├── transfer-fees/                    # Fee mint: create, transfer-with-fee, harvest, withdraw
│   ├── metadata/                         # MetadataPointer + TokenMetadata: init, update, read
│   ├── transfer-hook/                    # Rust hook program (lib.rs) + TS client
│   ├── interest-bearing/                 # Interest-bearing mint + UI amount conversion
│   └── non-transferable/                 # Soul-bound mint
└── templates/
    └── token2022-client.ts               # Boilerplate: program detection, ATA, mint, transfer helpers
```

## References

- Token-2022 docs (program guide, extensions): https://www.solana-program.com/docs/token-2022
- Token-2022 program source (Rust 11.0.0, `ExtensionType` enum): https://github.com/solana-program/token-2022
- `@solana/spl-token` (web3.js SDK, 0.4.14): https://www.npmjs.com/package/@solana/spl-token
- `@solana-program/token-2022` (kit SDK, 0.12.0): https://www.npmjs.com/package/@solana-program/token-2022
- `@solana/zk-sdk` (confidential transfers, 0.4.2): https://www.npmjs.com/package/@solana/zk-sdk
- Token extensions guides (metadata, transfer fee, confidential): https://solana.com/developers/guides/token-extensions
- Confidential balances guide: https://www.solana-program.com/docs/confidential-balances
- ZK ElGamal Proof program (instructions, status): https://docs.anza.xyz/runtime/zk-elgamal-proof
