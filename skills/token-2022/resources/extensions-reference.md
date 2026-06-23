# Token-2022 Extensions Reference

Static lookup data for the `token-2022` skill. The export names and signatures here are
confirmed against `@solana/spl-token@0.4.14` and `@solana/spl-token-metadata@0.1.6` (every
example compiles `tsc --noEmit` clean and was run on devnet). The official extension guide
is the source of truth for extensions added after these versions:
https://www.solana-program.com/docs/token-2022/extensions

## Program IDs

| Program | Address |
|---------|---------|
| Token-2022 (Token Extensions) | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Classic SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

The Token-2022 program id is identical on devnet, testnet, and mainnet-beta.

## Mint extensions

Most of these are **creation-time only** — they cannot be added after `InitializeMint`.

| Extension (`ExtensionType`) | What it does | Notes / risk |
|---|---|---|
| `TransferFeeConfig` | Protocol-level fee withheld on every transfer | Requires `transferChecked`; fees harvested then withdrawn by authority |
| `MintCloseAuthority` | Allows closing (reclaiming rent of) the mint account | Classic mints can never be closed |
| `InterestBearingConfig` | Cosmetic continuously-compounding interest on UI amount | No new tokens minted; display-only |
| `NonTransferable` | Soulbound — transfers permanently rejected by the runtime | Burn still allowed by the holder |
| `DefaultAccountState` | New token accounts start `Frozen` (or `Initialized`) | Freeze authority must `thaw` before use; common for KYC |
| `PermanentDelegate` | A fixed authority can transfer/burn ANY account's tokens | **High risk** — seizure power; surface to integrators |
| `TransferHook` | Calls a custom program on every transfer | **High risk** — can brick transfers; must resolve extra accounts |
| `MetadataPointer` | Points to where token metadata lives (often the mint itself) | Pair with `TokenMetadata` for embedded metadata |
| `TokenMetadata` | On-chain name/symbol/uri/additional fields, no Metaplex | Variable length; reallocs the mint account |
| `GroupPointer` / `TokenGroup` | Define a collection/group at the mint level | Used for collections |
| `GroupMemberPointer` / `TokenGroupMember` | Mark a mint as a member of a group | |
| `ConfidentialTransferMint` | Encrypted (hidden) balances and transfer amounts via ZK | **High complexity/risk**; auditor key for issuer |

> Newer extensions (e.g. scaled UI amount, pausable, confidential mint/burn) have been
> added over time. When a user requests behavior not in this table, check the official
> extension guide for the current `ExtensionType` rather than guessing an export name.

## Token-account extensions

| Extension (`ExtensionType`) | What it does | Notes |
|---|---|---|
| `ImmutableOwner` | Account owner can never change | ATAs get this by default under Token-2022 |
| `MemoTransfer` | Requires an SPL memo on incoming transfers | Opt-in per account |
| `CpiGuard` | Blocks certain actions via CPI (anti-drainer) | Opt-in per account |
| `NonTransferableAccount` | Account-side flag paired with `NonTransferable` mint | Set automatically |
| `TransferHookAccount` | Account-side flag paired with `TransferHook` mint | Set automatically |
| `ConfidentialTransferAccount` | Per-account confidential balance state | Requires configuration |

## Known incompatibilities (do not combine on one mint)

- `NonTransferable` with `TransferFeeConfig`, `TransferHook`, or `ConfidentialTransferMint` — a token that cannot move has no transfer behavior to extend.
- `ConfidentialTransferMint` with `TransferFeeConfig` requires the confidential-transfer-fee variant; the plain combination is not valid.
- Always confirm pairwise compatibility in the official guide before enabling two behavior-changing extensions together.

## Key JS imports (confirmed against `@solana/spl-token@0.4.14` / `@solana/spl-token-metadata@0.1.6`)

```typescript
// from @solana/spl-token
ExtensionType, TOKEN_2022_PROGRAM_ID, getMintLen, getAccountLen,
createInitializeMintInstruction, createInitializeMint2Instruction,
createInitializeTransferFeeConfigInstruction,
createInitializeMetadataPointerInstruction,
createInitializeNonTransferableMintInstruction,
createInitializeDefaultAccountStateInstruction,
createInitializePermanentDelegateInstruction,
createInitializeInterestBearingMintInstruction,
createInitializeMintCloseAuthorityInstruction,
createTransferCheckedInstruction, createTransferCheckedWithFeeInstruction,
transferCheckedWithFee, mintTo, getAccount, thawAccount,
getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
createAssociatedTokenAccountIdempotent, getOrCreateAssociatedTokenAccount,
getMint, getExtensionTypes, getTransferFeeConfig, getTokenMetadata,
getDefaultAccountState, AccountState,
harvestWithheldTokensToMint, withdrawWithheldTokensFromMint,
TYPE_SIZE, LENGTH_SIZE

// from @solana/spl-token-metadata
createInitializeInstruction, createUpdateFieldInstruction, pack, unpack,
type TokenMetadata
```

## Integration safety checklist (for wallets / DEXs / backends)

Before crediting, listing, or routing an arbitrary mint:
1. Confirm the owning program (`TOKEN_2022_PROGRAM_ID` vs classic).
2. Read `getExtensionTypes(mintInfo.tlvData)`.
3. Block or warn on `PermanentDelegate` (funds can be seized), `TransferHook` (transfers can fail or be gated), `NonTransferable`, `DefaultAccountState=Frozen`, `ConfidentialTransferMint`.
4. For fee mints, account for the withheld amount so balances reconcile.
5. Use `transferChecked` with correct decimals everywhere.
