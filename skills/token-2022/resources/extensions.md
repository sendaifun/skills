# Token-2022 Extensions Reference

All extensions are enabled at mint-creation time. Size the mint account with
`getMintLen([ExtensionType.X, ...])` from `@solana/spl-token`, run each
extension's init instruction **before** `createInitializeMintInstruction`, and
pass `TOKEN_2022_PROGRAM_ID` everywhere.

"Immutable after init?" = whether the extension's settings can be changed once
the mint exists. "Yes" means the setting is fixed forever once initialized.

Not every authority parameter accepts `null`. The "Authority nullable?" column
records the verified truth from the installed `@solana/spl-token` types: where
the parameter is `PublicKey | null`, passing `null` makes that setting immutable
(or that role unavailable); where it is a required `PublicKey`, you must pass a
real key at init. The permanent delegate's type happens to allow `null`, but the
delegate *is* the feature — a null delegate is pointless, so always pass a key.

## Mint extensions covered by this skill

| Extension | ExtensionType enum | Init instruction (verified signature) | What it does | Immutable after init? | Authority nullable? |
|-----------|--------------------|------------------|--------------|-----------------------|---------------------|
| Transfer Fees | `TransferFeeConfig` | `createInitializeTransferFeeConfigInstruction(mint, configAuthority: PublicKey \| null, withdrawAuthority: PublicKey \| null, feeBasisPoints, maxFee, programId?)` | Withholds a capped, basis-point fee on every transfer; fees accrue in accounts and are harvested to the mint, then withdrawn | Rate/max updatable by the fee-config authority (immutable if that authority is `null`) | **Yes** — both `configAuthority` and `withdrawAuthority` are `PublicKey \| null`; `null` makes that role permanent/unavailable |
| Interest-Bearing | `InterestBearingConfig` | `createInitializeInterestBearingMintInstruction(mint, rateAuthority: PublicKey, rate, programId?)` | Stores an interest rate; the displayed UI amount compounds over time (no new supply minted) | Rate updatable by the rate authority | **No** — `rateAuthority` is a required `PublicKey` |
| Non-Transferable | `NonTransferable` | `createInitializeNonTransferableMintInstruction(mint, programId)` | Soulbound: tokens can be minted and burned but never transferred | Yes (no authority; fixed for the mint) | n/a — no authority parameter |
| Metadata Pointer | `MetadataPointer` | `createInitializeMetadataPointerInstruction(mint, authority: PublicKey \| null, metadataAddress: PublicKey \| null, programId)` | Points the mint at a metadata account (often the mint itself) | Pointer updatable by the metadata-pointer authority | **Yes** — `authority` (and `metadataAddress`) are `PublicKey \| null` |
| Token Metadata | `TokenMetadata` (variable length) | `createInitializeInstruction({ ..., updateAuthority: PublicKey })` from `@solana/spl-token-metadata` | Stores name/symbol/URI + custom key/value fields on-chain; update with `createUpdateFieldInstruction` | Fields updatable by the metadata update authority | **No at init** — `updateAuthority` is a required `PublicKey`; drop it later via the update-authority instruction (set to none) |
| Default Account State | `DefaultAccountState` | `createInitializeDefaultAccountStateInstruction(mint, accountState, programId?)` | Forces new token accounts into a state (e.g. `AccountState.Frozen`) until the freeze authority thaws them | State updatable by the freeze authority | n/a in the ix — relies on the **mint freeze authority**, which MUST be non-null for the frozen-default pattern to be usable |
| Permanent Delegate | `PermanentDelegate` | `createInitializePermanentDelegateInstruction(mint, permanentDelegate: PublicKey \| null, programId)` | Grants an address unconditional transfer/burn authority over every account of the mint | Yes (set once at creation) | Type allows `null`, but the delegate **is** the feature — always pass a real key |
| Mint Close Authority | `MintCloseAuthority` | `createInitializeMintCloseAuthorityInstruction(mint, closeAuthority: PublicKey \| null, programId)` | Allows closing the mint account (reclaim rent) once supply is zero | Set once at creation | **Yes** — `closeAuthority` is `PublicKey \| null` (`null` = no close authority ever) |
| Transfer Hook | `TransferHook` | `createInitializeTransferHookInstruction(mint, authority: PublicKey, transferHookProgramId: PublicKey, programId)` | Invokes a custom program on every transfer (royalties, allow-lists, checks) — **audit the hook program** | Hook program updatable by the hook authority | **No** — `authority` and `transferHookProgramId` are required `PublicKey` |

## Extension compatibility matrix

Quick-reference for how each extension behaves when integrating. "Special
transfer ix?" = whether a plain `transferChecked` is enough, or you need a
dedicated builder.

| Extension | Mint-level vs account-level | Needs special transfer ix? | Authority nullable? |
|-----------|-----------------------------|----------------------------|---------------------|
| Transfer Fees | Mint-level | **Yes** — `createTransferCheckedWithFeeInstruction` (assert the capped fee on-chain) | Yes (config + withdraw authorities) |
| Interest-Bearing | Mint-level | No (UI-amount display only; raw transfers normal) | No (rate authority required) |
| Non-Transferable | Mint-level | n/a — transfers are rejected (mint/burn only) | n/a (no authority) |
| Metadata Pointer | Mint-level | No | Yes (pointer authority) |
| Token Metadata | Mint-level (variable length) | No | No at init (updateAuthority required) |
| Default Account State | Mint-level (gates new accounts) | No, but thaw frozen accounts first (`createThawAccountInstruction`) | n/a in ix — needs a non-null mint freeze authority |
| Permanent Delegate | Mint-level | No (delegate uses normal transfer/burn) | No (delegate is the feature) |
| Mint Close Authority | Mint-level | No | Yes (close authority) |
| Transfer Hook | Mint-level | **Yes** — `createTransferCheckedWithTransferHookInstruction` (resolves the hook's extra accounts; hook program must be deployed) | No (hook authority required) |

> All extensions in this skill are **mint-level** (configured on the mint at
> creation). Account-level extensions (`ImmutableOwner`, `MemoTransfer`,
> `CpiGuard`, …) live on token accounts and are out of scope here.

## Notes

- **Variable-length sizing (Token Metadata):** `getMintLen` covers only
  fixed-length extensions. For on-chain metadata, add
  `TYPE_SIZE + LENGTH_SIZE + pack(metadata).length` lamports of rent on top of
  `getMintLen([...])`. Allocate `space = mintLen` in `createAccount`; the
  metadata `createInitializeInstruction` reallocs the account to fit.
- **`null` authorities are permanent — where `null` is even accepted.** For the
  nullable authorities (see the column above), once set to `null` there is no way
  to "re-add" the authority. Choose deliberately. The non-nullable ones
  (rate authority, transfer-hook authority, metadata `updateAuthority`, permanent
  delegate) require a real key at init.
- **Extensions can't be added later.** Pick the complete extension set before
  calling `createInitializeMintInstruction`.
- **Account extensions** (e.g. `ImmutableOwner`, `MemoTransfer`, `CpiGuard`)
  apply to token accounts rather than mints and are out of scope for this skill,
  which focuses on mint-level extensions.

## ExtensionType enum values (from @solana/spl-token)

`TransferFeeConfig = 1`, `MintCloseAuthority = 3`, `DefaultAccountState = 6`,
`NonTransferable = 9`, `InterestBearingConfig = 10`, `PermanentDelegate = 12`,
`TransferHook = 14`, `MetadataPointer = 18`, `TokenMetadata = 19`.

Reference the `ExtensionType` enum from the package directly rather than
hardcoding these numbers.
