---
name: token-2022
description: Create and manage Token-2022 (Token Extensions) tokens on Solana. Use when building, minting, or integrating tokens that need transfer fees, on-chain metadata, confidential transfers, non-transferable (soulbound) tokens, interest-bearing balances, permanent delegate, transfer hooks, default frozen accounts, or close authority. Covers @solana/spl-token and @solana/spl-token-metadata instruction building, extension ordering, space/rent calculation, transferChecked rules, and integration safety checks.
license: MIT
metadata:
  author: token-2022-skill
  version: "1.0.0"
tags:
  - token-2022
  - token-extensions
  - spl-token
  - transfer-fee
  - confidential-transfer
  - transfer-hook
  - metadata-pointer
  - token-metadata
  - non-transferable
  - interest-bearing
  - permanent-delegate
  - default-account-state
  - mint-close-authority
  - soulbound
---

# Token-2022 (Token Extensions)

Build and integrate tokens using the Token Extensions Program (Token-2022), a strict superset of the SPL Token Program that adds optional features ("extensions") directly to mint and token accounts via a Type-Length-Value (TLV) layout.

**Program ID**: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (same on devnet and mainnet)
**Associated Token Program**: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` (one ATA program serves both Token and Token-2022)
**Core packages**: `@solana/spl-token`, `@solana/spl-token-metadata`, `@solana/web3.js`

## Use / Do Not Use

Use when:
- Creating a token that needs a feature the classic SPL Token Program does not have (fees, embedded metadata, confidential balances, soulbound, interest, seizure, hooks, etc.).
- Minting, transferring, or burning tokens that live under the Token-2022 program.
- A wallet, DEX, or backend must **read, detect, or safely handle** a token that may carry extensions.
- Debugging "incorrect program id", "invalid account data", or transfers that fail only on certain mints.

Do not use when:
- The token is a plain fungible token with no special behavior — the classic SPL Token Program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) is simpler and more widely supported.
- The task is pure price/quote/routing logic with no on-chain token creation or account handling.

**Triggers**: `token-2022`, `token extensions`, `transfer fee`, `confidential transfer`, `transfer hook`, `metadata pointer`, `on-chain metadata`, `non-transferable`, `soulbound`, `interest-bearing`, `permanent delegate`, `default account state`, `freeze on creation`, `close mint`, `required memo`, `cpi guard`, `seize tokens`, `royalty enforcement`, `KYC token`, `stablecoin issuance`

## Core Mental Model

1. **Extensions are chosen at creation time.** Most mint extensions **cannot be added after the mint is initialized**. Plan the full feature set up front. (`MetadataPointer` + `TokenMetadata` and a few account-level extensions are the practical exceptions — see the reference.)
2. **Instruction order is strict.** For a new mint: `SystemProgram.createAccount` → each `createInitialize<Extension>Instruction` → `createInitializeMintInstruction`. Extension-init instructions must come **before** `InitializeMint`, or the transaction fails.
3. **Space must be pre-computed.** Use `getMintLen([...extensionTypes])` to size the account. Under-allocating fails the transaction. Variable-length data (embedded metadata) is reallocated separately — see the metadata flow.
4. **Always pass the program id explicitly.** Every helper that defaults to `TOKEN_PROGRAM_ID` (e.g. `getAssociatedTokenAddressSync`, `createAssociatedTokenAccountInstruction`, `createTransferCheckedInstruction`) must receive `TOKEN_2022_PROGRAM_ID` for Token-2022 mints. This is the #1 cause of silent failures.
5. **Detect before you integrate.** Code that handles arbitrary mints must read the account's owning program and its extension set, then decide whether each extension is acceptable. Never assume a mint is "just a token".

## Instructions

When a user asks to build or integrate a Token-2022 token, follow this process.

### 1. Clarify the feature set and the environment

- Ask (or infer) which behaviors are needed, then map each to an extension using `resources/extensions-reference.md`.
- Confirm **devnet vs mainnet**. The program id is identical on both; only the RPC URL and funded keypair differ. Always build and test on devnet first.
- Flag incompatible combinations early (e.g. `NonTransferable` + `TransferFeeConfig` make no sense together; `ConfidentialTransferMint` has its own constraints).

### 2. Install and pin versions

```bash
npm install @solana/web3.js @solana/spl-token @solana/spl-token-metadata bs58 dotenv
```

Token-2022 helpers evolve quickly. Pin `@solana/spl-token` to a recent 0.4.x release and verify the exact `createInitialize*` export names against the installed version before relying on them. If an import is missing, check the package's `src/extensions` directory or the official docs rather than guessing.

### 3. Build the create-mint transaction in the correct order

Compute space, fund rent, initialize extensions, then initialize the mint — all in one transaction signed by the payer and the new mint keypair. See `examples/create-token-with-transfer-fee.ts` for a complete, runnable version.

```typescript
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
} from "@solana/spl-token";
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";

const extensions = [ExtensionType.TransferFeeConfig];
const mintLen = getMintLen(extensions);
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

const tx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  }),
  // Extension init MUST come before InitializeMint:
  createInitializeTransferFeeConfigInstruction(
    mint.publicKey,
    payer.publicKey,        // transfer fee config authority
    payer.publicKey,        // withdraw withheld authority
    100,                    // fee basis points (1%)
    BigInt(1_000_000),      // max fee (in base units)
    TOKEN_2022_PROGRAM_ID,
  ),
  createInitializeMintInstruction(
    mint.publicKey, 6, payer.publicKey, null, TOKEN_2022_PROGRAM_ID,
  ),
);

await sendAndConfirmTransaction(connection, tx, [payer, mint]);
```

### 4. Honor extension-specific transfer rules

- **Transfer fee mints**: never use `transfer`. Use `transferChecked` (or `transferCheckedWithFee`), which requires the mint and decimals. A plain `transfer` on a fee mint fails.
- **Fee collection**: fees are withheld on recipient accounts. Harvest them with `harvestWithheldTokensToMint`, then `withdrawWithheldTokensFromMint` using the withdraw authority.
- **Transfer hook mints**: the transfer must include the hook program's extra accounts; resolve them with the on-chain `ExtraAccountMetaList` before sending, or the transfer fails.
- **Default frozen / KYC mints**: a new ATA starts `Frozen`; the freeze authority must `thawAccount` before the holder can move tokens.

### 5. Detect extensions when integrating an unknown mint

```typescript
import { getMint, getTokenMetadata, getExtensionTypes, getTransferFeeConfig } from "@solana/spl-token";

const mintInfo = await getMint(connection, mintPubkey, undefined, TOKEN_2022_PROGRAM_ID);
const present = getExtensionTypes(mintInfo.tlvData);
// Branch on `present`: warn/block on PermanentDelegate, TransferHook, NonTransferable,
// ConfidentialTransferMint, DefaultAccountState before allowing deposits or listings.
```

### 6. Verify on-chain

After sending, fetch the mint and assert the extensions are present and configured as intended (fee bps, authorities, metadata fields). Print the explorer URL with the correct cluster. Treat "transaction succeeded" as necessary but not sufficient — confirm the resulting state.

## Examples

### Example: "Create a token that charges a 1% transfer fee, capped at 1 token"

The agent should:
1. Map the request to `ExtensionType.TransferFeeConfig`.
2. Build one transaction: `createAccount` (space from `getMintLen([TransferFeeConfig])`) → `createInitializeTransferFeeConfigInstruction` → `createInitializeMintInstruction`.
3. Set fee basis points to `100` and max fee to the base-unit equivalent of 1 token (`10 ** decimals`).
4. Tell the user every transfer must use `transferChecked`, and how to harvest/withdraw fees.
5. See `examples/create-token-with-transfer-fee.ts`.

### Example: "Create a token with on-chain name, symbol, and image — no Metaplex"

The agent should:
1. Use `ExtensionType.MetadataPointer` on the mint, pointing the metadata address **to the mint itself**, plus the `TokenMetadata` extension for embedded metadata.
2. Size rent for `getMintLen([MetadataPointer])` **plus** the packed metadata length (`TYPE_SIZE + LENGTH_SIZE + pack(metadata).length`), but create the account with `space = mintLen` only — `createInitializeInstruction` (metadata) reallocs the account and pulls the extra rent.
3. Order: `createAccount` → `createInitializeMetadataPointerInstruction` → `createInitializeMintInstruction` → `createInitializeInstruction` (from `@solana/spl-token-metadata`).
4. See `examples/create-token-with-metadata.ts`.

### Example: "Make a soulbound credential token"

Map to `ExtensionType.NonTransferable`. Note it blocks transfers permanently but **not** burns — the holder can still burn. Pair with embedded metadata for a self-describing credential.

## Guidelines

- **DO** compute account size with `getMintLen` for every extension set; never hardcode `MINT_SIZE`.
- **DO** initialize all extension instructions before `InitializeMint`, in the same transaction.
- **DO** pass `TOKEN_2022_PROGRAM_ID` to every ATA and transfer helper for Token-2022 mints.
- **DO** use `transferChecked` everywhere, and mandatorily on transfer-fee mints.
- **DO** treat `PermanentDelegate`, `TransferHook`, and `ConfidentialTransferMint` as elevated-risk and surface them to users/integrators.
- **DO** test on devnet, with a dedicated throwaway keypair, before mainnet.
- **DON'T** use `createMint` (the high-level one-shot helper) when extensions are required — it does not initialize them.
- **DON'T** assume an extension can be added later; most are creation-time only.
- **DON'T** mix incompatible extensions (see reference) on one mint.
- **DON'T** hardcode private keys; load from env and keep agent wallets separate from main funds.

## Common Errors

### Error: transfer fails with "incorrect program id" or "could not find account"
**Cause**: a helper defaulted to the classic Token program for a Token-2022 mint.
**Solution**: pass `TOKEN_2022_PROGRAM_ID` to `getAssociatedTokenAddressSync`, `createAssociatedTokenAccountInstruction`, and every transfer instruction.

### Error: transfer of a fee token fails
**Cause**: used `transfer` instead of `transferChecked` on a `TransferFeeConfig` mint.
**Solution**: use `transferChecked` / `transferCheckedWithFee` with the mint and correct decimals.

### Error: "invalid account data for instruction" when initializing the mint
**Cause**: account space too small, or an extension-init instruction placed after `InitializeMint`.
**Solution**: size with `getMintLen([...])` and order all extension inits before `InitializeMint`.

### Error: metadata fields missing or rent error after init
**Cause**: account created with too little rent for variable-length metadata, or metadata pointer not pointing at the mint.
**Solution**: fund rent for `mintLen + metadataLen`, create the account with `space = mintLen`, point the metadata pointer at the mint, and run `createInitializeInstruction` last.

### Error: recipient cannot use received tokens
**Cause**: `DefaultAccountState` is `Frozen`; the ATA is created frozen.
**Solution**: the freeze authority must `thawAccount` the recipient's ATA.

## References

- Token-2022 program docs: https://www.solana-program.com/docs/token-2022
- Extension guide (per-extension, with examples): https://www.solana-program.com/docs/token-2022/extensions
- Solana token extensions overview: https://solana.com/docs/tokens/extensions
- `@solana/spl-token` (JS client): https://www.npmjs.com/package/@solana/spl-token
- `@solana/spl-token-metadata`: https://www.npmjs.com/package/@solana/spl-token-metadata
- Full extension/program-id/error reference: `resources/extensions-reference.md`
