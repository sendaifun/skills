# Token-2022 Troubleshooting

A deeper error catalog than SKILL.md's *Common Errors* — every failure mode that actually trips people
up when minting and integrating Token-2022, with the on-chain error you'll see, the **Cause**, and the
**Solution** (with the exact signature to use). For the summary set, see *Common Errors* in
[`../SKILL.md`](../SKILL.md); this doc is the overflow target.

> Versions referenced: `@solana/spl-token` **0.4.14**, `@solana/spl-token-metadata` **0.1.6**,
> `@solana-program/token-2022` **0.12.0** (kit), `@solana/web3.js` **1.98.4**, `@solana/kit` **7.0.0**.
> Program ids: Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, classic
> `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, ATA `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`,
> ZK ElGamal Proof `ZkE1Gama1Proof11111111111111111111111111111`.

## First: decode the error

Token program errors arrive as a custom program error (hex) inside `SendTransactionError`. Always pull
the **logs**, which name the failing program and instruction:

```ts
try {
  await sendAndConfirmTransaction(connection, tx, signers);
} catch (e: any) {
  // web3.js v1: full program logs (the real diagnostic, not the top-level message)
  console.error(await e.getLogs?.(connection) ?? e.logs ?? e);
}
```

A log line like `Program TokenzQd… failed: custom program error: 0x…` confirms it was Token-2022 (vs the
classic program or the ATA program). The JS SDK also throws named errors (`TokenInvalidAccountOwnerError`,
`TokenAccountNotFoundError`, `TokenInvalidMintError`) from `getAccount`/`getMint` before you ever send —
catch those too.

## Symptom → likely cause (quick index)

| Symptom | Most likely cause | Jump to |
|---|---|---|
| `InitializeMint` fails / "already in use" / `InvalidAccountData` | extension init ordered after `initializeMint`, or wrong `getMintLen` | [Mint creation](#mint-creation-errors) |
| "insufficient funds for rent" / account not rent-exempt | `getMintLen` missed an extension, or metadata bytes not funded | [Mint creation](#mint-creation-errors) |
| `TokenInvalidAccountOwnerError` / `IncorrectProgramId` / "account not found" | ATA derived under the wrong token program | [ATA & ownership](#ata--ownership-errors) |
| transfer fails: missing accounts | transfer-hook mint, extra accounts not resolved | [Transfers](#transfer-errors) |
| transfer fails: decimals / fee | `transfer` instead of `transferChecked`, wrong decimals, or wrong fee | [Transfers](#transfer-errors) |
| `ExtensionTypeMismatch` / "extension not found" | reading a mint-side ext as account-side (or it isn't there) | [Reading extensions](#reading-extension-state) |
| confidential transfer fails / "program is not deployed" | ZK ElGamal Proof feature gate off, or wrong SDK | [Confidential](#confidential-transfer-errors) |
| `TypeError` mixing `PublicKey` and `Address` | mixing `@solana/spl-token` (web3.js) with kit | [SDK & tooling](#sdk--tooling-errors) |
| metadata invisible in wallet/explorer | indexer lag, bad `uri`, or unsupported extension | [Display & ecosystem](#display--ecosystem-issues) |

---

## Mint creation errors

### Error: `InvalidAccountData` / "extension already initialized" on `InitializeMint`
**Cause** A fixed-length extension init instruction was placed **after** `createInitializeMintInstruction`
in the transaction. `InitializeMint` seals the mint layout; the program rejects any subsequent extension
init on that mint. (The reverse also fails: trying to init `TokenMetadata`/`TokenGroup` *before*
`initializeMint`.)
**Solution** Order the single transaction exactly:
`SystemProgram.createAccount(getMintLen([fixed exts]))` → all `createInitialize<Extension>Instruction`
(any order among themselves) → `createInitializeMintInstruction` → only then the variable/interface
inits (`createInitializeInstruction` for metadata, `createInitializeGroupInstruction` for groups). See
[`../SKILL.md`](../SKILL.md) *Creating a mint with extensions* and
[`../examples/create-mint-with-extensions/`](../examples/create-mint-with-extensions/).

### Error: `InitializeMint` fails because the account size doesn't match the declared extensions
**Cause** `SystemProgram.createAccount` allocated `space` that doesn't equal `getMintLen([...])` for the
exact fixed extensions you initialize — e.g. you initialized `TransferFeeConfig` but didn't list it in
`getMintLen`, or listed an extension you never init. `InitializeMint` validates that the account size
matches the declared extension set.
**Solution** Make `getMintLen([...])` list **exactly** the fixed extensions whose
`createInitialize<Extension>Instruction` you include — no more, no fewer — and pass that as `space`:

```ts
const extensions = [ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig]; // must match the inits below
const mintLen = getMintLen(extensions);
// createAccount({ space: mintLen, ... }) then init MetadataPointer + TransferFeeConfig only.
```

### Error: "insufficient funds for rent" / account is not rent-exempt (variable-length metadata)
**Cause** `getMintLen([...])` does **not** count variable-length extensions (`TokenMetadata`,
`TokenGroup`, `TokenGroupMember`). You funded rent for `mintLen` only, so when
`createInitializeInstruction` reallocs the mint to write metadata, the account drops below
rent-exemption and the tx fails.
**Solution** Size the metadata separately and fund both up front:

```ts
import { TYPE_SIZE, LENGTH_SIZE } from '@solana/spl-token';
import { pack } from '@solana/spl-token-metadata';
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);
// createAccount space = mintLen (fixed only); the extra lamports cover the metadata realloc.
```

### Error: adding a metadata field later fails (realloc not rent-exempt)
**Cause** `createUpdateFieldInstruction` (adding/extending an `additionalMetadata` pair after creation)
grows the mint account, but you didn't top up its lamports, so the realloc leaves it under rent-exemption.
**Solution** In the **same transaction, before** the update ix, transfer the rent delta to the mint:

```ts
import { SystemProgram } from '@solana/web3.js';
const topUp = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mint, lamports: rentDelta });
const tx = new Transaction().add(topUp, updateFieldIx); // top-up first
```

Compute `rentDelta` as `getMinimumBalanceForRentExemption(newSize) − currentLamports`. Full pattern in
[`./extensions-guide.md`](./extensions-guide.md#metadatapointer--tokenmetadata) and
[`../examples/metadata/`](../examples/metadata/).

### Error: `DefaultAccountState(Frozen)` mint can never be used
**Cause** You set `DefaultAccountState = Frozen` but passed `null` as the **freeze authority** to
`createInitializeMintInstruction`. Every account opens frozen and there is no authority to thaw them.
**Solution** Provide a real freeze authority at mint creation, and thaw each account before use:

```ts
createInitializeMintInstruction(mint, decimals, mintAuth, freezeAuth /* NOT null */, TOKEN_2022_PROGRAM_ID);
// later: createThawAccountInstruction(userAta, mint, freezeAuth, [], TOKEN_2022_PROGRAM_ID);
```

---

## ATA & ownership errors

### Error: `TokenInvalidAccountOwnerError` / `IncorrectProgramId` / "account not found"
**Cause** The ATA was derived or created under the **wrong token program**. The ATA address includes the
token program id as a PDA seed (`seeds = [owner, token_program_id, mint]`), so the Token-2022 ATA for
`(owner, mint)` is a **different account** than the classic ATA. Omitting the `programId` argument
defaults to legacy `TOKEN_PROGRAM_ID`.
**Solution** Detect the mint's owning program and thread it through every derivation and instruction:

```ts
const info = await connection.getAccountInfo(mint);
const programId = info!.owner; // TOKEN_2022_PROGRAM_ID or TOKEN_PROGRAM_ID
const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);          // pass programId
createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
```

See [`./migration-from-spl.md`](./migration-from-spl.md) for the full both-program detection pattern.

### Error: ATA creation fails with "account already in use" / `IllegalOwner`
**Cause** Either the ATA already exists (non-idempotent builder), or you created a token account at the
ATA address under one program and are now addressing it with the other.
**Solution** Use the **idempotent** builder in production so a pre-existing ATA is a no-op:

```ts
createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
```

If you genuinely have a collision, you derived the address under the wrong program — recompute with the
mint's actual owner.

### Error: passing the ATA program where the token program is expected (or vice-versa)
**Cause** `createAssociatedTokenAccountInstruction(payer, ata, owner, mint, programId?, associatedTokenProgramId?)`
takes the **mint's token program** as the 5th arg and the **ATA program** as the 6th. Swapping them
yields `IncorrectProgramId`.
**Solution** 5th arg = `TOKEN_2022_PROGRAM_ID` (the mint's program); 6th arg =
`ASSOCIATED_TOKEN_PROGRAM_ID`. These are different roles — don't pass `ASSOCIATED_TOKEN_PROGRAM_ID` for
both.

---

## Transfer errors

### Error: transfer moves the wrong amount or fails — used `transfer` not `transferChecked`
**Cause** The unchecked `Transfer` instruction passes neither `mint` nor `decimals`, so the program
can't validate them and most extensions reject it. On a fee mint the accounting is wrong; on a hook
mint it's missing accounts.
**Solution** Always use `transferChecked` and its extension-aware variants:

```ts
// plain:    createTransferCheckedInstruction(src, mint, dst, owner, amount, decimals, [], TOKEN_2022_PROGRAM_ID)
// fee:      createTransferCheckedWithFeeInstruction(src, mint, dst, owner, amount, decimals, fee, [], TOKEN_2022_PROGRAM_ID)
// hook:     await createTransferCheckedWithTransferHookInstruction(connection, src, mint, dst, owner, amount, decimals, [], 'confirmed', TOKEN_2022_PROGRAM_ID)
// fee+hook: await createTransferCheckedWithFeeAndTransferHookInstruction(connection, src, mint, dst, owner, amount, decimals, fee, [], 'confirmed', TOKEN_2022_PROGRAM_ID)
```

### Error: `MintDecimalsMismatch` ("Decimals mismatch")
**Cause** The `decimals` you passed to `transferChecked`/`mintToChecked`/`burnChecked` doesn't equal the
mint's actual decimals. Hard-coding `9` (SOL's) or `0` is the usual culprit.
**Solution** Read decimals from the mint, never assume:

```ts
const { decimals } = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
createTransferCheckedInstruction(src, mint, dst, owner, amount, decimals, [], TOKEN_2022_PROGRAM_ID);
```

### Error: transfer fails with missing accounts (transfer-hook mint)
**Cause** A plain `createTransferCheckedInstruction` was used on a mint that has the `TransferHook`
extension. The hook's `ExtraAccountMetaList` accounts (validation PDA + resolved extras) weren't
appended, so the hook CPI is short of accounts and the whole transfer aborts.
**Solution** Use the async hook-resolving builder, which reads the validation PDA via RPC and appends
the extra accounts:

```ts
const ix = await createTransferCheckedWithTransferHookInstruction(
  connection, src, mint, dst, owner, amount, decimals, [], 'confirmed', TOKEN_2022_PROGRAM_ID,
);
```

Or `addExtraAccountMetasForExecute(...)` on an existing checked ix. Building the hook program and the
validation PDA is in [`./transfer-hooks.md`](./transfer-hooks.md).

### Error: transfer rejected on a fee mint, or the fee is wrong
**Cause** You either used a plain checked transfer (the fee is silently withheld on the destination, so
the recipient gets `amount − fee`), or used `…WithFee` with a fee that doesn't match what the program
calculates for the current epoch (the program rounds **up** and may have a pending fee-config change).
**Solution** Compute the fee with the SDK so it matches on-chain rounding and epoch transitions:

```ts
import { getMint, getTransferFeeConfig, getEpochFee, calculateFee, createTransferCheckedWithFeeInstruction } from '@solana/spl-token';
const m = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
const cfg = getTransferFeeConfig(m);
const epoch = BigInt((await connection.getEpochInfo()).epoch);
const fee = cfg ? calculateFee(getEpochFee(cfg, epoch), amount) : 0n;
createTransferCheckedWithFeeInstruction(src, mint, dst, owner, amount, m.decimals, fee, [], TOKEN_2022_PROGRAM_ID);
```

### Error: transfer rejected — `NonTransferable`, paused, or frozen
**Cause** The mint or account state forbids the move: `NonTransferable` mints reject all transfers
(soul-bound); a `Pausable` mint rejects transfers/mints/burns while **paused**; a `DefaultAccountState =
Frozen` (or otherwise frozen) account can't send or receive until thawed.
**Solution** This is expected behavior, not a bug:
- `NonTransferable` → there is no fix; the token cannot be transferred (burn/close still work).
- Paused → wait for the pause authority to `createResumeInstruction(...)`.
- Frozen → the freeze authority must `createThawAccountInstruction(account, mint, freezeAuth, [], TOKEN_2022_PROGRAM_ID)`
  before the account can transact.

Detect these before building the tx with `getNonTransferable(mint)`, `getPausableConfig(mint)`, and the
account's `state` field.

---

## Reading extension state

### Error: `ExtensionTypeMismatch` / "extension not found" / `ExtensionBaseMismatch`
**Cause** You asked for an extension that isn't present, or read a **mint-side** extension off a token
account (or vice-versa), or unpacked with the wrong program id. Mint extensions (`TransferFeeConfig`,
`MetadataPointer`, …) live on the mint; account extensions (`ImmutableOwner`, `MemoTransfer`, the
auto-paired markers) live on token accounts.
**Solution** Use the matching getter against the right account type, and null-check:

```ts
const m = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
const fee = getTransferFeeConfig(m);                 // mint-side; null if absent
const meta = getMetadataPointerState(m);             // mint-side
// account-side example:
const acct = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
const withheld = getTransferFeeAmount(acct);         // account-side accumulator
if (!fee) { /* this mint has no transfer fee — branch accordingly */ }
```

The per-extension getter names are in
[`./extensions-guide.md`](./extensions-guide.md) and
[`../resources/sdk-reference.md`](../resources/sdk-reference.md).

### Error: tried to initialize an auto-paired account extension manually
**Cause** You called `createInitialize…` for `TransferFeeAmount`, `TransferHookAccount`,
`NonTransferableAccount`, `PausableAccount`, or `ConfidentialTransferAccount`. Token-2022 adds these
markers automatically when the token account is created for a mint that has the paired mint extension.
**Solution** Don't init them — just create the ATA (idempotent) and the marker appears. You only
manually init `ImmutableOwner` (non-ATA accounts), `MemoTransfer`, and `CpiGuard`.

---

## Confidential transfer errors

### Error: confidential transfer fails / "program is not deployed" / `ZkE1Gama1Proof…` invalid
**Cause** The **ZK ElGamal Proof program** (`ZkE1Gama1Proof11111111111111111111111111111`) is gated off
on your cluster. It was disabled on mainnet-beta in **June 2025** (epoch 805) after a Fiat-Shamir
soundness bug, re-enabled on testnet/devnet in **April 2026**, and on **mainnet-beta ~late June 2026**.
A cluster on an older feature set, or a custom validator, may still have it off.
**Solution** Verify the feature gate for your exact cluster/epoch before relying on it (don't assume).
Confirm the proof program is invocable and that your validator is on a recent Agave release. Then run the
flow via the kit client. See [`./confidential-transfers.md`](./confidential-transfers.md) for the
availability timeline and the verification steps.

### Error: `createConfigureAccountInstruction` (or any confidential ix) is undefined in `@solana/spl-token`
**Cause** `@solana/spl-token` 0.4.14 has **no confidential-transfer module** — none of the
`configure`/`deposit`/`applyPendingBalance`/`transfer`/`withdraw` confidential instructions exist there.
**Solution** Use the kit `@solana-program/token-2022` 0.12.0 client + `@solana/zk-sdk` 0.4.2 (or the
Rust proof crates, or the `spl-token` CLI). Key derivation (`deriveElGamalKeypairForOwnerMint`,
`deriveAeKeyForOwnerMint`) and the multi-tx proof-context flow are kit-only. Details in
[`./confidential-transfers.md`](./confidential-transfers.md).

### Error: confidential `Transfer` won't fit in one transaction / proof too large
**Cause** A confidential transfer needs three zero-knowledge proofs (equality, ciphertext validity,
range) plus the token instruction — they exceed the 1232-byte transaction limit.
**Solution** Split into sequential transactions: create + verify each proof **context-state account**,
run the token instruction referencing them, then `CloseContextState` to reclaim rent. The kit
`get…InstructionPlan` helpers emit this multi-tx structure for you. See
[`./confidential-transfers.md`](./confidential-transfers.md).

---

## SDK & tooling errors

### Error: `TypeError` / runtime mismatch mixing `PublicKey` and `Address`
**Cause** You mixed the two client stacks: `@solana/spl-token` is built on **web3.js v1** (`PublicKey`,
`Connection`, `Transaction`); the kit `@solana-program/token-2022` is built on **`@solana/kit`**
(`Address` strings, `Rpc`, `IInstruction`). Passing a `PublicKey` where an `Address` is expected (or
feeding a kit instruction to `sendAndConfirmTransaction`) breaks at runtime.
**Solution** Pick one stack per code path. If you must bridge, convert explicitly (`address(pk.toBase58())`
for kit; `new PublicKey(addr)` for web3.js) rather than passing objects across. The full mapping is in
[`../resources/sdk-reference.md`](../resources/sdk-reference.md).

### Error: `getTokenAccountsByOwner` doesn't return my Token-2022 accounts
**Cause** `getTokenAccountsByOwner` filters by a single program id. Querying with `TOKEN_PROGRAM_ID`
returns only classic accounts; Token-2022 accounts are owned by `TOKEN_2022_PROGRAM_ID`.
**Solution** Call it **twice** — once per program id — and merge:

```ts
const [legacy, t22] = await Promise.all([
  connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
  connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
]);
```

### Error: kit `getCreateMintInstructionPlan` / extension `__kind` is rejected
**Cause** Kit extensions are a tagged union keyed by `__kind`; a typo'd kind, a missing `some(...)`
wrapper on an optional field, or a `number` where a `bigint` is expected (`maximumFee: 5000` vs `5000n`)
fails type-checking or encoding.
**Solution** Use the exact `__kind` strings (`'TransferFeeConfig'`, `'MetadataPointer'`,
`'TokenMetadata'`, …), wrap optionals with `some(...)`/`none()`, and use `bigint` literals for token
amounts. Valid kinds and field shapes are in
[`../resources/sdk-reference.md`](../resources/sdk-reference.md).

---

## Display & ecosystem issues

### Error: wallet or explorer doesn't show the token's name/symbol/metadata
**Cause** One of: (a) the indexer hasn't picked up the new mint yet (propagation lag); (b) the metadata
`uri` is unreachable or returns invalid JSON; (c) the wallet/explorer doesn't yet read in-mint
`TokenMetadata` (some still expect a Metaplex account); (d) you set the `MetadataPointer` but never ran
the `createInitializeInstruction` metadata write, so there's a pointer to empty data.
**Solution** Verify on-chain first — `getTokenMetadata(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)`
should return your `{ name, symbol, uri }`. Ensure the `uri` serves valid JSON over HTTPS. Confirm the
pointer targets the mint itself (`getMetadataPointerState(mint).metadataAddress === mint`). Then allow
for explorer indexing delay, and test your specific target wallets — in-mint metadata support is broad
but uneven.

### Error: a DEX/AMM rejects the mint or a transfer fails inside a protocol
**Cause** The integrator hard-codes `TOKEN_PROGRAM_ID`, or doesn't support your specific extension. A
`TransferHook` in particular breaks naive AMMs that call plain `transferChecked` without resolving extra
accounts; `PermanentDelegate`/`NonTransferable` mints are refused by many venues.
**Solution** Confirm your target venue supports Token-2022 **and** your extensions before launch. For
hook tokens, the venue must use the hook-resolving transfer path. There is no client-side workaround for
a protocol that hasn't integrated Token-2022 — choose venues that have, or avoid extensions they reject.
See ecosystem gotchas in [`./migration-from-spl.md`](./migration-from-spl.md).

## See also

- [`../SKILL.md`](../SKILL.md) — *Common Errors* (summary) and the create-mint ordering rule.
- [`./extensions-guide.md`](./extensions-guide.md) — per-extension init/management signatures.
- [`./transfer-hooks.md`](./transfer-hooks.md) · [`./confidential-transfers.md`](./confidential-transfers.md)
  · [`./migration-from-spl.md`](./migration-from-spl.md)
- [`../resources/sdk-reference.md`](../resources/sdk-reference.md) ·
  [`../resources/program-addresses.md`](../resources/program-addresses.md)

## References

- Token-2022 program (errors, `ExtensionType`): https://github.com/solana-program/token-2022
- Token-2022 docs: https://www.solana-program.com/docs/token-2022
- `@solana/spl-token` (0.4.14): https://www.npmjs.com/package/@solana/spl-token
- ZK ElGamal Proof program status: https://docs.anza.xyz/runtime/zk-elgamal-proof
- June 2025 ZK ElGamal Proof post-mortem: https://solana.com/news/post-mortem-june-25-2025
