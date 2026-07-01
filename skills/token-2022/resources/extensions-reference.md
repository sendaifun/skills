# Token-2022 Extension Reference

Authoritative lookup for every Token-2022 `ExtensionType`. Discriminants, mint-vs-account
classification, auto-pairing, reversibility, `@solana/spl-token` 0.4.14 availability, and the
initialize-instruction name. Discriminants are the on-chain TLV type numbers, verified from the Rust
`ExtensionType` enum (`solana-program/token-2022`, `interface/src/extension/mod.rs`, v11.0.0); the
mint/account split and SDK availability are verified from `@solana/spl-token` 0.4.14
(`isMintExtension`/`isAccountExtension`, `extensions/` directory).

> This is the data behind [SKILL.md → Extension catalog](../SKILL.md#extension-catalog). Per-extension
> how-to code is in [docs/extensions-guide.md](../docs/extensions-guide.md); the side-by-side
> web3.js↔kit function map is in [sdk-reference.md](./sdk-reference.md). For transfer hooks and
> confidential transfers see [docs/transfer-hooks.md](../docs/transfer-hooks.md) and
> [docs/confidential-transfers.md](../docs/confidential-transfers.md).

---

## TLV layout & sizing constants

Extensions are stored as **TLV** (Type-Length-Value) entries appended after the fixed account base.
Verified from `@solana/spl-token` (`extensionType.d.ts`):

```
TYPE_SIZE   = 2     // u16 LE: the ExtensionType discriminant
LENGTH_SIZE = 2     // u16 LE: byte length of this extension's value
<value>             // the extension's serialized state

Base mint    = 82 bytes      // before any TLV
Base account = 165 bytes     // before any TLV
```

When **any** extension is present the program writes an account-type byte at offset 165 (for token
accounts) and then the TLV entries. You never compute these by hand:

- `getMintLen(extensionTypes: ExtensionType[], variableLengthExtensions?)` → exact mint account size.
- `getAccountLen(extensionTypes: ExtensionType[])` → exact token account size.
- **Variable-length extensions** (`TokenMetadata` 19, `TokenGroup` 21, `TokenGroupMember` 23) are
  **not** counted by `getMintLen` unless you pass `variableLengthExtensions`. For metadata, size the
  fixed extensions with `getMintLen` and add `TYPE_SIZE + LENGTH_SIZE + pack(metadata).length` to the
  rent (see [SKILL.md](../SKILL.md#creating-a-mint-with-extensions--the-critical-order)).
- Kit equivalents: `getMintSize(extensions)` / `getTokenSize(extensions)`.

---

## Table 1 — Discriminant & classification (all 28)

| # | `ExtensionType` (Rust) | JS name (if different) | Side | Auto-paired | Length | In `@solana/spl-token` 0.4.14? |
|---|---|---|---|---|---|---|
| 0 | `Uninitialized` | — | — | — | — | yes (sentinel/padding) |
| 1 | `TransferFeeConfig` | — | **Mint** | → adds #2 to accounts | fixed | yes |
| 2 | `TransferFeeAmount` | — | **Account** | auto (added by #1) | fixed | yes (auto) |
| 3 | `MintCloseAuthority` | — | **Mint** | no | fixed | yes |
| 4 | `ConfidentialTransferMint` | — | **Mint** | → adds #5 to accounts | fixed | enum only ¹ |
| 5 | `ConfidentialTransferAccount` | — | **Account** | auto (added by #4) | fixed | enum only ¹ |
| 6 | `DefaultAccountState` | — | **Mint** | no | fixed | yes |
| 7 | `ImmutableOwner` | — | **Account** | no (ATAs set it) | fixed | yes |
| 8 | `MemoTransfer` | — | **Account** | no | fixed | yes |
| 9 | `NonTransferable` | — | **Mint** | → adds #13 to accounts | fixed | yes |
| 10 | `InterestBearingConfig` | — | **Mint** | no | fixed | yes |
| 11 | `CpiGuard` | — | **Account** | no | fixed | yes |
| 12 | `PermanentDelegate` | — | **Mint** | no | fixed | yes |
| 13 | `NonTransferableAccount` | — | **Account** | auto (added by #9) | fixed | yes (auto) |
| 14 | `TransferHook` | — | **Mint** | → adds #15 to accounts | fixed | yes |
| 15 | `TransferHookAccount` | — | **Account** | auto (added by #14) | fixed | yes (auto) |
| 16 | `ConfidentialTransferFeeConfig` | — | **Mint** | → adds #17 to accounts | fixed | **NO** |
| 17 | `ConfidentialTransferFeeAmount` | — | **Account** | auto (added by #16) | fixed | **NO** |
| 18 | `MetadataPointer` | — | **Mint** | no | fixed | yes |
| 19 | `TokenMetadata` | — | **Mint** | no | **variable** | yes |
| 20 | `GroupPointer` | — | **Mint** | no | fixed | yes |
| 21 | `TokenGroup` | — | **Mint** | no | **variable** | yes |
| 22 | `GroupMemberPointer` | — | **Mint** | no | fixed | yes |
| 23 | `TokenGroupMember` | — | **Mint** | no | **variable** | yes |
| 24 | `ConfidentialMintBurn` | — | **Mint** | no | fixed | **NO** |
| 25 | `ScaledUiAmount` | `ScaledUiAmountConfig` | **Mint** | no | fixed | yes |
| 26 | `Pausable` | `PausableConfig` | **Mint** | → adds #27 to accounts | fixed | yes |
| 27 | `PausableAccount` | — | **Account** | auto (added by #26) | fixed | yes (auto) |
| 28 | `PermissionedBurn` | — | **Mint** | no | fixed | **NO** |

¹ **`ConfidentialTransferMint`/`Account` (4/5):** the `ExtensionType` enum members exist in
`@solana/spl-token` 0.4.14 (so `getMintLen`/`getAccountLen` can size them), but the SDK ships **no
confidential-transfer instruction builders** (no `configure`/`deposit`/`transfer`/`withdraw`). Do
confidential transfers with the kit client `@solana-program/token-2022` 0.12.0 + `@solana/zk-sdk`
0.4.2, the Rust proof crates, or the `spl-token` CLI. See
[docs/confidential-transfers.md](../docs/confidential-transfers.md).

**JS SDK 0.4.14 omits entirely** (not in the enum / no builders): `ConfidentialTransferFeeConfig`
(16), `ConfidentialTransferFeeAmount` (17), `ConfidentialMintBurn` (24), `PermissionedBurn` (28). All
four exist in the on-chain program (Rust `spl-token-2022` 11.0.0); use kit / Rust / CLI. `PermissionedBurn`
(28) is the newest — treat as cutting-edge and verify mainnet support before relying on it.

> Higher enum values (`AccountPaddingTest`, `MintPaddingTest`) exist in the Rust enum but are
> **test-only** — never use them.

---

## Table 2 — Reversibility, key params & init function

"Presence" of every extension is **permanent and must be declared at mint creation** — you cannot add
an extension to an existing mint, and a mint can never switch token programs. The column below
describes whether the extension's *config/behavior* can be changed or disabled after init.

| # | Extension | Config change after init | Key params | `@solana/spl-token` 0.4.14 init function |
|---|---|---|---|---|
| 1 | `TransferFeeConfig` | Fee/max updatable; authorities revocable to `null` | `transferFeeConfigAuthority`, `withdrawWithheldAuthority`, `transferFeeBasisPoints`, `maximumFee: bigint` | `createInitializeTransferFeeConfigInstruction` |
| 3 | `MintCloseAuthority` | Authority changeable/revocable (`SetAuthority`) | `closeAuthority: PublicKey \| null` | `createInitializeMintCloseAuthorityInstruction` |
| 4 | `ConfidentialTransferMint` | Config updatable | `authority`, `autoApproveNewAccounts`, `auditorElgamalPubkey?` | — (kit: `getInitializeConfidentialTransferMintInstruction`) |
| 6 | `DefaultAccountState` | Updatable by freeze authority | `accountState: AccountState` (`Uninitialized=0`,`Initialized=1`,`Frozen=2`) | `createInitializeDefaultAccountStateInstruction` |
| 7 | `ImmutableOwner` | **Permanent** | — (account-only) | `createInitializeImmutableOwnerInstruction` |
| 8 | `MemoTransfer` | Toggle per account (enable/disable) | `authority` | `createEnableRequiredMemoTransfersInstruction` |
| 9 | `NonTransferable` | **Permanent** | — | `createInitializeNonTransferableMintInstruction` |
| 10 | `InterestBearingConfig` | Rate updatable by `rateAuthority` | `rateAuthority`, `rate: number` (bps/yr as i16) | `createInitializeInterestBearingMintInstruction` |
| 11 | `CpiGuard` | Toggle per account | `authority` | `createEnableCpiGuardInstruction` |
| 12 | `PermanentDelegate` | **Permanent** (trust hazard — wallets warn) | `permanentDelegate: PublicKey \| null` | `createInitializePermanentDelegateInstruction` |
| 14 | `TransferHook` | Hook program id updatable; authority revocable | `authority`, `transferHookProgramId` | `createInitializeTransferHookInstruction` |
| 18 | `MetadataPointer` | Pointer updatable; authority revocable | `authority: PublicKey \| null`, `metadataAddress: PublicKey \| null` | `createInitializeMetadataPointerInstruction` |
| 19 | `TokenMetadata` | Fields updatable; authority revocable to `null` | `name`, `symbol`, `uri`, `additionalMetadata` | `createInitializeInstruction` (`@solana/spl-token-metadata`) — **after `initializeMint`** |
| 20 | `GroupPointer` | Pointer updatable; authority revocable | `authority`, `groupAddress` | `createInitializeGroupPointerInstruction` |
| 21 | `TokenGroup` | Config updatable | `updateAuthority`, `maxSize` | `createInitializeGroupInstruction` (`@solana/spl-token-group`) — **after `initializeMint`** |
| 22 | `GroupMemberPointer` | Pointer updatable; authority revocable | `authority`, `memberAddress` | `createInitializeGroupMemberPointerInstruction` |
| 23 | `TokenGroupMember` | Updatable | `group`, `member`, `memberNumber` | `createInitializeMemberInstruction` (`@solana/spl-token-group`) — **after `initializeMint`** |
| 25 | `ScaledUiAmount` | Multiplier updatable | `authority: PublicKey \| null`, `multiplier: number` | `createInitializeScaledUiAmountConfigInstruction` |
| 26 | `Pausable` | Pause/resume toggle (`createPauseInstruction`/`createResumeInstruction`) | `authority: PublicKey \| null` | `createInitializePausableConfigInstruction` |
| 16 | `ConfidentialTransferFeeConfig` | Config updatable | encrypted-fee config | — (not in 0.4.14; kit/Rust) |
| 24 | `ConfidentialMintBurn` | Config updatable | confidential supply config | — (not in 0.4.14; kit/Rust) |
| 28 | `PermissionedBurn` | Config | burn authority co-signer | — (not in 0.4.14; kit/Rust/CLI) |

Auto-paired account extensions (2, 5, 13, 15, 17, 27) have **no init function** — the program adds
them when a token account of the mint is created (see auto-pairing list below).

> Signatures (all `programId` trailing-optional, default to legacy — always pass
> `TOKEN_2022_PROGRAM_ID`): full verified parameter lists are in
> [sdk-reference.md](./sdk-reference.md) and `facts`-derived [SKILL.md](../SKILL.md). Kit init names
> follow `get<Name>Instruction` (e.g. `getInitializeTransferFeeConfigInstruction`,
> `getInitializeScaledUiAmountMintInstruction`) — see [sdk-reference.md](./sdk-reference.md) for the
> full kit mapping.

---

## Mint → account auto-pairing

These extensions are configured on the **mint**, but cause a paired marker to be **auto-added to
every token account** of that mint. You do **not** initialize the account-side variant yourself —
attempting to is an error.

| Mint extension | Auto-added account extension |
|---|---|
| `TransferFeeConfig` (1) | `TransferFeeAmount` (2) |
| `ConfidentialTransferMint` (4) | `ConfidentialTransferAccount` (5) |
| `NonTransferable` (9) | `NonTransferableAccount` (13) |
| `TransferHook` (14) | `TransferHookAccount` (15) |
| `ConfidentialTransferFeeConfig` (16) | `ConfidentialTransferFeeAmount` (17) |
| `Pausable` (26) | `PausableAccount` (27) |

## Account-only extensions you DO initialize per token account

Configured on the **token account**, not the mint:

- `ImmutableOwner` (7) — owner can never be reassigned. **ATAs always carry it automatically**; you
  only init it manually for raw (non-ATA) accounts: `createAccount` → `createInitializeImmutableOwnerInstruction` → `initializeAccount3`.
- `MemoTransfer` (8) — require an SPL Memo on incoming transfers. Enable with
  `createEnableRequiredMemoTransfersInstruction`; can be disabled later.
- `CpiGuard` (11) — block privileged token operations from being invoked via CPI (user protection).
  Enable with `createEnableCpiGuardInstruction`; can be disabled later.

---

## Notes & combinations

- **Choose extensions up front.** Presence is permanent; many extensions are also permanent in
  behavior (`NonTransferable`, `PermanentDelegate`, `ImmutableOwner`) or can only be *locked* by
  setting their authority to `null` (`TransferFeeConfig`, `MetadataPointer`, `TransferHook`,
  `TokenMetadata`, `ScaledUiAmount`, `Pausable`).
- **Most extensions combine freely** (e.g. `MetadataPointer` + `TransferFeeConfig` + `TokenMetadata`,
  the canonical example in [SKILL.md](../SKILL.md)). Combine them by listing every fixed extension in
  `getMintLen([...])` and issuing each init **before** `initializeMint`; init variable-length
  metadata/group **after**.
- **Conflicting/unusual pairs to think about:** `NonTransferable` (9) makes transfer-side extensions
  (`TransferFeeConfig`, `TransferHook`) pointless since transfers are blocked; `DefaultAccountState =
  Frozen` (6) means every new account must be thawed before it can receive tokens (allowlist gating).
- **Display vs raw amount:** `InterestBearingConfig` (10) and `ScaledUiAmount` (25) change the
  *displayed* UI amount only — no tokens move. Indexers/price feeds must convert with the SDK's
  UI-amount helpers, not read the raw amount directly.
- **CU/size:** every extension adds account bytes (rent) and the transfer-side ones add compute.
  Transfer hooks and confidential transfers add the most (extra CPIs / proof verification). Size with
  `getMintLen`/`getAccountLen` (or kit `getMintSize`/`getTokenSize`); never hand-compute byte offsets.

---

## References

- Rust `ExtensionType` enum (authoritative discriminants): https://github.com/solana-program/token-2022/blob/main/interface/src/extension/mod.rs
- Token-2022 extensions overview: https://www.solana-program.com/docs/token-2022/extensions
- `@solana/spl-token` (0.4.14): https://www.npmjs.com/package/@solana/spl-token
- `@solana/spl-token-metadata` (0.1.6): https://www.npmjs.com/package/@solana/spl-token-metadata
- `@solana/spl-token-group` (0.0.7): https://www.npmjs.com/package/@solana/spl-token-group
- `@solana-program/token-2022` (kit, 0.12.0): https://www.npmjs.com/package/@solana-program/token-2022
