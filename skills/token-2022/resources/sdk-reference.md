# Token-2022 SDK Reference — `@solana/spl-token` ↔ kit `@solana-program/token-2022`

Side-by-side function map for the two JavaScript clients, with verified signatures. Both wrap the
**same on-chain program** with identical instruction layouts — pick by which framework your codebase
already uses. `@solana/spl-token` 0.4.14 is web3.js-based and dominant; `@solana-program/token-2022`
0.12.0 is kit-native and is **required for confidential transfers**.

> This is the lookup behind [SKILL.md → SDK choice](../SKILL.md#sdk-choice). Signatures are verified
> from `facts` (the 0.4.14 `.d.ts` files and the 0.12.0 generated client). The extension catalog is in
> [extensions-reference.md](./extensions-reference.md); addresses/versions in
> [program-addresses.md](./program-addresses.md).

---

## 1. The two clients at a glance

| | `@solana/spl-token` **0.4.14** | kit `@solana-program/token-2022` **0.12.0** |
|---|---|---|
| Base library | `@solana/web3.js` 1.98.4 (`Connection`, `PublicKey`, `Transaction`, `TransactionInstruction`) | `@solana/kit` 7.0.0 (`Address`, `Rpc`, `IInstruction`) |
| Builder style | named functions; trailing `programId?` switches programs | tree-shakable, one `get<Name>Instruction(...)` per ix; no classes |
| Program-switch | pass `TOKEN_2022_PROGRAM_ID` (defaults to legacy) | the client **is** the Token-2022 client (`TOKEN_2022_PROGRAM_ADDRESS`) |
| Account creation | `SystemProgram.createAccount(...)` | `getCreateAccountInstruction(...)` from `@solana-program/system` |
| Send | `sendAndConfirmTransaction(connection, tx, signers)` | `pipe(...)` + `sendAndConfirmTransactionFactory(...)` |
| Decode mint | `getMint` / `unpackMint` | `fetchMint` / `decodeMint` (codec-based) |
| Mint-creation helper | manual ordering (see SKILL.md) | `getCreateMintInstructionPlan({...})` orders for you |
| Confidential transfers | **not supported** (no module) | **supported** (+ `@solana/zk-sdk` 0.4.2) |

**Do not mix the types**: web3.js uses `PublicKey`/`Connection`; kit uses `Address`/`Rpc`. Owners are
`PublicKey` (compare `.equals()`) in web3.js and base58 `Address` strings (compare `===`) in kit.

---

## 2. Function map

`programId` below is always `TOKEN_2022_PROGRAM_ID` (web3.js) — pass it explicitly; optional
`programId?` args default to the **legacy** Token program. Kit instruction names follow
`get<Name>Instruction`; the Token-2022 program address is implicit.

### 2.1 Sizing & mint init

| Purpose | `@solana/spl-token` 0.4.14 | kit `@solana-program/token-2022` 0.12.0 |
|---|---|---|
| Mint account size | `getMintLen(extensionTypes, variableLengthExtensions?)` | `getMintSize(extensions)` |
| Token account size | `getAccountLen(extensionTypes)` | `getTokenSize(extensions)` |
| Initialize mint | `createInitializeMintInstruction(mint, decimals, mintAuthority, freezeAuthority, programId?)` | `getInitializeMintInstruction({ mint, decimals, mintAuthority, freezeAuthority })` |
| Initialize mint (v2, no rent sysvar) | `createInitializeMint2Instruction(...)` | `getInitializeMint2Instruction({...})` |

### 2.2 Per-extension initialize (mint extensions — run BEFORE `initializeMint`)

| # | Extension | `@solana/spl-token` 0.4.14 | kit 0.12.0 |
|---|---|---|---|
| 1 | TransferFeeConfig | `createInitializeTransferFeeConfigInstruction` | `getInitializeTransferFeeConfigInstruction` |
| 3 | MintCloseAuthority | `createInitializeMintCloseAuthorityInstruction` | `getInitializeMintCloseAuthorityInstruction` |
| 4 | ConfidentialTransferMint | — (none) | `getInitializeConfidentialTransferMintInstruction` |
| 6 | DefaultAccountState | `createInitializeDefaultAccountStateInstruction` | `getInitializeDefaultAccountStateInstruction` |
| 9 | NonTransferable | `createInitializeNonTransferableMintInstruction` | `getInitializeNonTransferableMintInstruction` |
| 10 | InterestBearingConfig | `createInitializeInterestBearingMintInstruction` | `getInitializeInterestBearingMintInstruction` |
| 12 | PermanentDelegate | `createInitializePermanentDelegateInstruction` | `getInitializePermanentDelegateInstruction` |
| 14 | TransferHook | `createInitializeTransferHookInstruction` | `getInitializeTransferHookInstruction` |
| 18 | MetadataPointer | `createInitializeMetadataPointerInstruction` | `getInitializeMetadataPointerInstruction` |
| 20 | GroupPointer | `createInitializeGroupPointerInstruction` | `getInitializeGroupPointerInstruction` |
| 22 | GroupMemberPointer | `createInitializeGroupMemberPointerInstruction` | `getInitializeGroupMemberPointerInstruction` |
| 25 | ScaledUiAmount | `createInitializeScaledUiAmountConfigInstruction` | `getInitializeScaledUiAmountMintInstruction` |
| 26 | Pausable | `createInitializePausableConfigInstruction` | `getInitializePausableConfigInstruction` |

Variable-length, run **AFTER** `initializeMint`:

| # | Extension | `@solana/spl-token` | kit 0.12.0 |
|---|---|---|---|
| 19 | TokenMetadata | `createInitializeInstruction` (`@solana/spl-token-metadata`) | `getInitializeTokenMetadataInstruction` |
| 21 | TokenGroup | `createInitializeGroupInstruction` (`@solana/spl-token-group`) | via `getCreateMintInstructionPlan` `__kind: 'TokenGroup'` |
| 23 | TokenGroupMember | `createInitializeMemberInstruction` (`@solana/spl-token-group`) | via `getCreateMintInstructionPlan` `__kind: 'TokenGroupMember'` |

Account-side extensions (run on the token account):

| # | Extension | `@solana/spl-token` | kit 0.12.0 |
|---|---|---|---|
| 7 | ImmutableOwner | `createInitializeImmutableOwnerInstruction(account, programId)` | `getInitializeImmutableOwnerInstruction` |
| 8 | MemoTransfer | `createEnableRequiredMemoTransfersInstruction(account, authority, multiSigners?, programId?)` | `getEnableRequiredMemoTransfersInstruction` ¹ |
| 11 | CpiGuard | `createEnableCpiGuardInstruction(account, authority, multiSigners?, programId?)` | `getEnableCpiGuardInstruction` ¹ |

¹ Kit generated names follow the `get<Name>Instruction` convention; confirm exact spelling against the
0.12.0 client (`@solana-program/token-2022`) — the union of valid extensions is the `ExtensionArgs`
`__kind` list in §4.

### 2.3 ATAs

| Purpose | `@solana/spl-token` 0.4.14 | kit 0.12.0 |
|---|---|---|
| Derive ATA address | `getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve?, programId?, associatedTokenProgramId?)` | `await findAssociatedTokenPda({ mint, owner, tokenProgram })` |
| Create ATA ix | `createAssociatedTokenAccountInstruction(payer, ata, owner, mint, programId?, associatedTokenProgramId?)` | `getCreateAssociatedTokenInstruction({...})` |
| Create ATA (idempotent) | `createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, programId?, associatedTokenProgramId?)` | `getCreateAssociatedTokenIdempotentInstruction({...})` |
| Fetch-or-create (high level) | `getOrCreateAssociatedTokenAccount(connection, payer, mint, owner, allowOwnerOffCurve?, commitment?, confirmOptions?, programId?, associatedTokenProgramId?)` | compose with `getCreateAssociatedTokenIdempotentInstruction` + `fetchToken` |

Pass the **mint's owning token program** (`TOKEN_2022_PROGRAM_ID` / `tokenProgram`) — it is an ATA
seed, so the address differs per program. ATAs created under Token-2022 automatically carry
`ImmutableOwner` (no manual init).

### 2.4 Transfers, mint, burn (always the **Checked** variants)

| Purpose | `@solana/spl-token` 0.4.14 | kit 0.12.0 |
|---|---|---|
| Transfer (plain) | `createTransferCheckedInstruction(source, mint, destination, owner, amount, decimals, multiSigners?, programId?)` | `getTransferCheckedInstruction({...})` |
| Transfer (fee mint) | `createTransferCheckedWithFeeInstruction(source, mint, destination, authority, amount, decimals, fee, multiSigners?, programId?)` | `getTransferCheckedWithFeeInstruction({...})` |
| Transfer (hook mint, async) | `createTransferCheckedWithTransferHookInstruction(connection, source, mint, destination, owner, amount, decimals, multiSigners?, commitment?, programId?)` | generated `getTransferCheckedInstruction` + hook resolution in `transferToATA.ts` |
| Transfer (fee + hook, async) | `createTransferCheckedWithFeeAndTransferHookInstruction(connection, source, mint, destination, owner, amount, decimals, fee, multiSigners?, commitment?, programId?)` | — (compose) |
| Mint to | `createMintToCheckedInstruction(mint, destination, authority, amount, decimals, multiSigners?, programId?)` | `getMintToCheckedInstruction({...})` |
| Burn | `createBurnCheckedInstruction(account, mint, owner, amount, decimals, multiSigners?, programId?)` | `getBurnCheckedInstruction({...})` |
| Approve delegate | `createApproveCheckedInstruction(...)` | `getApproveCheckedInstruction({...})` |
| Set authority | `createSetAuthorityInstruction(...)` | `getSetAuthorityInstruction({...})` |
| Close account | `createCloseAccountInstruction(...)` | `getCloseAccountInstruction({...})` |

### 2.5 Management / runtime (extension-specific)

| Purpose | `@solana/spl-token` 0.4.14 |
|---|---|
| Transfer-fee: harvest withheld → mint | `createHarvestWithheldTokensToMintInstruction(mint, sources, programId?)` |
| Transfer-fee: withdraw withheld from mint | `createWithdrawWithheldTokensFromMintInstruction(mint, destination, authority, signers?, programId?)` |
| Transfer-fee: withdraw withheld from accounts | `createWithdrawWithheldTokensFromAccountsInstruction(mint, destination, authority, signers, sources, programId?)` |
| Interest-bearing: update rate | `createUpdateRateInterestBearingMintInstruction(mint, rateAuthority, rate, multiSigners?, programId?)` |
| Pausable: pause / resume | `createPauseInstruction(mint, authority, multiSigners?, programId?)` / `createResumeInstruction(...)` |
| Transfer hook: update program | `createUpdateTransferHookInstruction(mint, authority, transferHookProgramId, multiSigners?, programId?)` |
| Hook resolve (lower level) | `addExtraAccountMetasForExecute(connection, instruction, programId, source, mint, destination, owner, amount, commitment?)` |
| Default-account-state: update | `createUpdateDefaultAccountStateInstruction(mint, accountState, freezeAuthority, multiSigners?, programId?)` |

### 2.6 Metadata (`@solana/spl-token-metadata` 0.1.6, re-exported by `@solana/spl-token`)

```ts
createInitializeInstruction({ programId, metadata, updateAuthority, mint, mintAuthority, name, symbol, uri }) // after initializeMint
createUpdateFieldInstruction({ programId, metadata, updateAuthority, field: Field | string, value: string })
createRemoveKeyInstruction({ programId, metadata, updateAuthority, key: string, idempotent: boolean })
createUpdateAuthorityInstruction({ programId, metadata, oldAuthority, newAuthority: PublicKey | null }) // null = lock
pack(meta: TokenMetadata): Uint8Array   // size metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(meta).length
// TokenMetadata = { updateAuthority?, mint, name, symbol, uri, additionalMetadata: [string, string][] }
```

### 2.7 Reading / decoding

| Purpose | `@solana/spl-token` 0.4.14 | kit 0.12.0 |
|---|---|---|
| Fetch + decode mint | `getMint(connection, mint, commitment?, programId?)` | `fetchMint(rpc, address)` |
| Decode mint (from bytes) | `unpackMint(address, accountInfo, programId?)` | `decodeMint(account)` |
| Fetch + decode token account | `getAccount(connection, address, commitment?, programId?)` | `fetchToken(rpc, address)` |
| Read a typed extension | per-extension getters on the decoded mint, e.g. `getTransferFeeConfig(mint)`, `getTransferHook(mint)`, `getMetadataPointerState(mint)`, `getInterestBearingMintConfigState(mint)`; `getTokenMetadata(connection, address)` | decode the extension from `fetchMint` data |
| Raw extension bytes | `getExtensionData(extensionType, tlvData)` | codec-based decode |

`getMint(... programId)` returns the base mint plus a `tlvData` buffer; the per-extension getters
unpack that buffer and return `null` when the extension is absent — use them to branch integrations
(see [docs/migration-from-spl.md](../docs/migration-from-spl.md#44-branching-on-extensions-before-transferring)).

---

## 3. Verified web3.js signatures (init instructions)

All take `programId = TOKEN_2022_PROGRAM_ID` (pass it explicitly):

```ts
createInitializeMintInstruction(mint, decimals, mintAuthority, freezeAuthority: PublicKey | null, programId?)

createInitializeTransferFeeConfigInstruction(
  mint, transferFeeConfigAuthority: PublicKey | null, withdrawWithheldAuthority: PublicKey | null,
  transferFeeBasisPoints: number, maximumFee: bigint, programId?)

createInitializeMintCloseAuthorityInstruction(mint, closeAuthority: PublicKey | null, programId)
createInitializeDefaultAccountStateInstruction(mint, accountState: AccountState, programId?)
//   AccountState: Uninitialized=0, Initialized=1, Frozen=2
createInitializeNonTransferableMintInstruction(mint, programId)
createInitializeInterestBearingMintInstruction(mint, rateAuthority: PublicKey, rate: number, programId?) // rate = i16 bps/yr
createInitializePermanentDelegateInstruction(mint, permanentDelegate: PublicKey | null, programId)
createInitializeTransferHookInstruction(mint, authority: PublicKey, transferHookProgramId: PublicKey, programId)
createInitializeMetadataPointerInstruction(mint, authority: PublicKey | null, metadataAddress: PublicKey | null, programId)
createInitializeGroupPointerInstruction(mint, authority: PublicKey | null, groupAddress: PublicKey | null, programId?)
createInitializeGroupMemberPointerInstruction(mint, authority: PublicKey | null, memberAddress: PublicKey | null, programId?)
createInitializeScaledUiAmountConfigInstruction(mint, authority: PublicKey | null, multiplier: number, programId?)
createInitializePausableConfigInstruction(mint, authority: PublicKey | null, programId?)

// account extensions:
createInitializeImmutableOwnerInstruction(account, programId)
createEnableRequiredMemoTransfersInstruction(account, authority, multiSigners?, programId?)
createEnableCpiGuardInstruction(account, authority, multiSigners?, programId?)
```

UI-amount helpers (interest-bearing / scaled-UI display conversion):

```ts
amountToUiAmountForMintWithoutSimulation(connection, mint, amount: bigint): Promise<string>
uiAmountToAmountForMintWithoutSimulation(connection, mint, uiAmount: string): Promise<bigint>
```

---

## 4. Kit-only assets (the part that beats hand-rolling)

```ts
import {
  getCreateMintInstructionPlan, getMintSize, getTokenSize,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';

// Orders create-account → pre-init ext ixs → initializeMint2 → post-init (metadata/group) for you:
const plan = getCreateMintInstructionPlan({
  newMint, payer, mintAuthority, decimals: 6, freezeAuthority,
  extensions,                 // ExtensionArgs[] (tagged union, see below)
});
```

- **`ExtensionArgs` is a tagged union keyed by `__kind`.** Valid `__kind` values:
  `ConfidentialTransferMint`, `ConfidentialMintBurn`, `ConfidentialTransferFee`, `DefaultAccountState`,
  `TransferFeeConfig`, `MetadataPointer`, `TokenMetadata`, `InterestBearingConfig`, `ScaledUiAmountConfig`,
  `PausableConfig`, `PermissionedBurn`, `GroupPointer`, `GroupMemberPointer`, `TokenGroup`,
  `NonTransferable`, `TransferHook`, `PermanentDelegate`, `MintCloseAuthority`, `MemoTransfer`, `CpiGuard`.

  ```ts
  const extensions = [
    { __kind: 'TransferFeeConfig', transferFeeConfigAuthority, withdrawWithheldAuthority,
      transferFeeBasisPoints: 50, maximumFee: 5_000n },
    { __kind: 'MetadataPointer', authority: some(updateAuthority), metadataAddress: some(mint.address) },
    { __kind: 'TokenMetadata', name: 'Example', symbol: 'EX', uri: 'https://example.com/t.json',
      additionalMetadata: new Map([['category', 'stablecoin']]) },
  ];
  ```

- **Helpers:** `getPreInitializeInstructionsForMintExtensions`,
  `getPostInitializeInstructionsForMintExtensions`, `getPostInitializeInstructionsForTokenExtensions`,
  `mintToATA`, `transferToATA`, `amountToUiAmount`.
- **Confidential-transfer support (kit-only, + `@solana/zk-sdk` 0.4.2):** generated ixs
  `configureConfidentialTransferAccount(WithRegistry)`, `confidentialDeposit`,
  `applyConfidentialPendingBalance`, `confidentialTransfer(WithFee)`, `confidentialWithdraw`,
  `emptyConfidentialTransferAccount`, `initializeConfidentialTransferMint`; high-level plan helpers
  (under the **`@solana-program/token-2022/confidential`** subpath)
  `getCreateConfidentialTransferAccountInstructionPlan`, `getConfidentialTransferInstructionPlan`,
  `getConfidentialWithdrawInstructionPlan`, `getApplyConfidentialPendingBalanceInstructionFromToken`;
  read the balance via the `getDecryptableBalanceDecoder()` codec + your AES key (there is **no**
  `decryptAvailableBalance` export); key derivation (also under `/confidential`)
  `deriveElGamalKeypair[ForOwnerMint]`,
  `deriveAeKey[ForOwnerMint]` (import `ElGamalKeypair`, `AeKey` from `@solana/zk-sdk`). See
  [docs/confidential-transfers.md](../docs/confidential-transfers.md).

---

## 5. Choosing & gotchas

- **`@solana/spl-token` (web3.js)** — the default for tutorials and most apps. Everything except
  confidential transfers. Always pass `TOKEN_2022_PROGRAM_ID`.
- **kit `@solana-program/token-2022`** — modern functional/tree-shakable; use for new kit codebases
  and **mandatory** for confidential transfers. `getCreateMintInstructionPlan` handles the mint-init
  ordering automatically.
- **Never mix `PublicKey` and `Address`** across the two clients in one code path.
- **The universal Token-2022 rules apply to both:** fixed-extension inits **before** `initializeMint`,
  variable-length metadata/group **after**; always the **Checked** transfer variants; thread the
  mint's owning token program everywhere. See [SKILL.md](../SKILL.md) and
  [docs/migration-from-spl.md](../docs/migration-from-spl.md).

---

## References

- `@solana/spl-token` (0.4.14): https://www.npmjs.com/package/@solana/spl-token
- `@solana/spl-token-metadata` (0.1.6): https://www.npmjs.com/package/@solana/spl-token-metadata
- `@solana-program/token-2022` (kit, 0.12.0): https://www.npmjs.com/package/@solana-program/token-2022
- kit client source (`clients/js`): https://github.com/solana-program/token-2022/tree/main/clients/js
- `@solana/kit` (7.0.0): https://www.npmjs.com/package/@solana/kit
- `@solana/zk-sdk` (0.4.2): https://www.npmjs.com/package/@solana/zk-sdk
