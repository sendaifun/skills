# Token-2022 Extensions — Per-Extension How-To

The practical, copy-paste reference for every Token-2022 extension. For each one: **which side**
it lives on (mint or token account), **whether it auto-pairs** an account marker, **how reversible**
it is, the exact `@solana/spl-token` 0.4.14 **init + management signatures**, a focused snippet, and
the gotchas that bite in production.

This guide is the expansion of the "Key extensions tour" in [`../SKILL.md`](../SKILL.md). It does
**not** re-teach the mint-creation ordering rule — that lives in SKILL.md under *"Creating a mint with
extensions — THE CRITICAL ORDER"* and is shown end-to-end in
[`../examples/create-mint-with-extensions/`](../examples/create-mint-with-extensions/). Read those
first; the snippets below assume you know the order:

```
SystemProgram.createAccount(space = getMintLen([fixed extensions]))   // fund rent
  → createInitialize<Extension>Instruction   // one per FIXED extension, any order among themselves
  → createInitializeMintInstruction          // LAST mint-setup step — "seals" the layout
  → (variable/interface only) metadata / group init   // AFTER initializeMint
```

> Verified versions: `@solana/spl-token` **0.4.14**, `@solana/spl-token-metadata` **0.1.6**,
> `@solana/spl-token-group` **0.0.7**, `@solana-program/token-2022` **0.12.0** (kit). Two extensions
> get their own deep-dive docs: **Transfer Hook** → [`transfer-hooks.md`](./transfer-hooks.md),
> **Confidential Transfer** → [`confidential-transfers.md`](./confidential-transfers.md). A flat lookup
> table (sizes, kit equivalents) is in
> [`../resources/extensions-reference.md`](../resources/extensions-reference.md).

## How to read the fact box

Every section opens with a one-line fact box:

> **Side** Mint · **Auto-pairs** `TransferFeeAmount` (account) · **Reversibility** config-updatable,
> authority lockable, presence permanent · **In SDK 0.4.14** yes

The three reversibility axes, used consistently below:

- **Presence — always permanent.** You declare an extension at mint creation and it is part of the
  account forever. *You can never add an extension to, or remove one from, an existing mint.* The only
  way to "remove" a behavior is a new mint + swap/airdrop.
- **Config — updatable or not.** Whether an authority can change the extension's parameters later
  (fee bps, interest rate, multiplier, pointer target, …).
- **Lock — can the authority be revoked?** Most config authorities can be set to `null`, which freezes
  the current config permanently (a one-way lock). Two extensions (`NonTransferable`,
  `PermanentDelegate`) have **no off switch at all** once present.

## Auto-paired account markers (never init these yourself)

Six mint extensions cause Token-2022 to **auto-add** a paired account-side marker the moment a token
account for that mint is created. You configure only the mint side:

| Mint extension | Auto-added account marker |
|---|---|
| `TransferFeeConfig` | `TransferFeeAmount` (per-account withheld accumulator) |
| `NonTransferable` | `NonTransferableAccount` |
| `TransferHook` | `TransferHookAccount` (carries the `transferring` flag) |
| `Pausable` | `PausableAccount` |
| `ConfidentialTransferMint` | `ConfidentialTransferAccount` |
| `ConfidentialTransferFeeConfig` | `ConfidentialTransferFeeAmount` |

The **only** account-side extensions you initialize by hand are `ImmutableOwner`, `MemoTransfer`, and
`CpiGuard` (covered at the end). Trying to manually `createInitialize…` an auto-paired marker fails.

---

# Mint extensions: economics & control

## TransferFeeConfig

> **Side** Mint · **Auto-pairs** `TransferFeeAmount` (account) · **Reversibility** fee values
> updatable by `transferFeeConfigAuthority`, both authorities lockable to `null`, presence permanent ·
> **In SDK 0.4.14** yes

**Purpose.** A protocol fee on every transfer, expressed as **basis points** (1 bp = 0.01%) with a
**per-transfer cap** (`maximumFee`, in base units). The fee is **not** sent anywhere at transfer time —
it is **withheld on the recipient's token account** (in its `TransferFeeAmount` marker). The
`withdrawWithheldAuthority` later **harvests** those withheld tokens to the mint and **withdraws** them
to a treasury. This is how USDG-style stablecoins and RWAs take revenue without a custom program.

**Init signature.**

```ts
createInitializeTransferFeeConfigInstruction(
  mint: PublicKey,
  transferFeeConfigAuthority: PublicKey | null,  // can later change the fee (null = locked forever)
  withdrawWithheldAuthority: PublicKey | null,    // can harvest/withdraw withheld fees
  transferFeeBasisPoints: number,                 // e.g. 50 = 0.50%
  maximumFee: bigint,                             // hard cap per transfer, in base units
  programId?: PublicKey,                          // pass TOKEN_2022_PROGRAM_ID
): TransactionInstruction
```

```ts
import { createInitializeTransferFeeConfigInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// Slots into the create-mint tx BEFORE createInitializeMintInstruction:
const feeIx = createInitializeTransferFeeConfigInstruction(
  mint,
  payer.publicKey,   // transferFeeConfigAuthority
  payer.publicKey,   // withdrawWithheldAuthority
  50,                // 0.50%
  5_000n,            // cap = 0.005 tokens at 6 decimals
  TOKEN_2022_PROGRAM_ID,
);
```

**Transferring on a fee mint.** Use `createTransferCheckedWithFeeInstruction` and pass the **exact**
fee. Compute it with the SDK helper so you match the on-chain rounding (the program rounds the fee
**up** and respects the cap and any pending fee-config epoch transition):

```ts
import {
  getMint, getTransferFeeConfig, calculateFee,
  createTransferCheckedWithFeeInstruction, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const mintState = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
const cfg = getTransferFeeConfig(mintState);          // null if mint has no fee
const epoch = BigInt((await connection.getEpochInfo()).epoch);
const amount = 1_000_000n;
const fee = cfg
  ? calculateFee(getEpochFee(cfg, epoch), amount)     // honors bps, cap, and the active epoch's fee
  : 0n;
// (getEpochFee/calculateFee/getTransferFeeConfig are all exported from @solana/spl-token)

const ix = createTransferCheckedWithFeeInstruction(
  srcAta, mint, dstAta, owner, amount, mintState.decimals, fee, [], TOKEN_2022_PROGRAM_ID,
);
```

**Harvest then withdraw (the fee lifecycle).** Withheld tokens accumulate on each recipient account.
Two-step collection:

```ts
import {
  createHarvestWithheldTokensToMintInstruction,      // (mint, sources: PublicKey[], programId?)
  createWithdrawWithheldTokensFromMintInstruction,    // (mint, destination, authority, signers?, programId?)
  createWithdrawWithheldTokensFromAccountsInstruction, // (mint, destination, authority, signers, sources, programId?)
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

// (A) Permissionless sweep: anyone can push withheld fees from holder accounts INTO the mint.
const harvestIx = createHarvestWithheldTokensToMintInstruction(mint, [acctA, acctB], TOKEN_2022_PROGRAM_ID);

// (B) The withdrawWithheldAuthority moves the mint's accumulated fees to a treasury ATA.
const withdrawFromMintIx = createWithdrawWithheldTokensFromMintInstruction(
  mint, treasuryAta, withdrawAuthority.publicKey, [], TOKEN_2022_PROGRAM_ID,
);

// (B') Or pull directly from holder accounts in one shot (authority required):
const withdrawFromAcctsIx = createWithdrawWithheldTokensFromAccountsInstruction(
  mint, treasuryAta, withdrawAuthority.publicKey, [], [acctA, acctB], TOKEN_2022_PROGRAM_ID,
);
```

To discover which accounts hold withheld fees, scan with `getProgramAccounts`/`getTokenAccountsByOwner`
and read each account's `TransferFeeAmount` (`getTransferFeeAmount(account)` → `withheldAmount`). Change
the live fee later with `createSetTransferFeeInstruction(mint, authority, signers, bps, maximumFee,
programId?)` — the new fee takes effect in **two epochs** (`olderTransferFee` vs `newerTransferFee`),
which is exactly why you read it via `getEpochFee`.

**Gotchas.**
- A **plain** `createTransferCheckedInstruction` on a fee mint succeeds but the protocol still withholds
  the fee on the destination — your "received" amount is `amount − fee`. Always quote net amounts to
  users, and use the `…WithFee` builder when you need to assert the exact fee.
- `maximumFee` is a flat **base-unit** cap, not a percentage. With 6 decimals, `5_000n` caps the fee at
  0.005 tokens regardless of transfer size.
- For a mint that has **both** fee and hook, use
  `createTransferCheckedWithFeeAndTransferHookInstruction` (async). See
  [`transfer-hooks.md`](./transfer-hooks.md).
- Full runnable lifecycle: [`../examples/transfer-fees/`](../examples/transfer-fees/).

## PermanentDelegate

> **Side** Mint · **Auto-pairs** none · **Reversibility** presence **and** behavior **permanent** —
> there is no off switch · **In SDK 0.4.14** yes

**Purpose.** A single authority that can `transferChecked` or `burnChecked` **from any token account of
this mint, without the holder's consent**. This is the compliance/clawback primitive: freeze-and-seize,
forced redemption, recovering tokens from a sanctioned address. Regulated stablecoins use it.

**Init signature.**

```ts
createInitializePermanentDelegateInstruction(
  mint: PublicKey,
  permanentDelegate: PublicKey | null,
  programId: PublicKey,                  // TOKEN_2022_PROGRAM_ID (required positional here)
): TransactionInstruction
```

```ts
import { createInitializePermanentDelegateInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
const ix = createInitializePermanentDelegateInstruction(mint, complianceAuthority, TOKEN_2022_PROGRAM_ID);
```

**Clawback in practice.** The permanent delegate signs a normal checked transfer/burn, passing **itself**
as the `owner`/authority argument — Token-2022 lets it move funds it doesn't own because it is the mint's
permanent delegate:

```ts
import { createTransferCheckedInstruction, createBurnCheckedInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// Seize from a holder ATA into a treasury ATA (delegate signs):
const seize = createTransferCheckedInstruction(
  victimAta, mint, treasuryAta, complianceAuthority.publicKey /* acts as authority */,
  amount, decimals, [], TOKEN_2022_PROGRAM_ID,
);
// ...or burn it outright:
const burn = createBurnCheckedInstruction(
  victimAta, mint, complianceAuthority.publicKey, amount, decimals, [], TOKEN_2022_PROGRAM_ID,
);
```

**Gotchas — read this twice.**
- **TRUST HAZARD.** Anyone holding this token is fully exposed to the delegate. Wallets and explorers
  display a prominent warning on permanent-delegate mints; many DeFi venues refuse them. Disclose it.
- **No revocation.** Unlike a normal SPL delegate (`approve`/`revoke`), the permanent delegate cannot be
  removed and the extension cannot be disabled. The only mitigation is to assign the delegate to a
  multisig/governance you can later point at a burn address — but the *capability* remains.
- Read whether a mint has one with `getPermanentDelegate(mint)` (returns the delegate or `null`).

## DefaultAccountState

> **Side** Mint · **Auto-pairs** none (acts on every new token account) · **Reversibility** default
> updatable by the **freeze authority**, presence permanent · **In SDK 0.4.14** yes

**Purpose.** Force every newly created token account of this mint to open in a chosen state — almost
always **`Frozen`**. A frozen account cannot send, receive, or be minted to until the **freeze authority
thaws it**. This is the canonical **allowlist / KYC gate**: users create an ATA, then your service thaws
it only after they pass checks.

**Init signature** (`AccountState` enum: `Uninitialized=0`, `Initialized=1`, `Frozen=2`):

```ts
createInitializeDefaultAccountStateInstruction(
  mint: PublicKey, accountState: AccountState, programId?: PublicKey,
): TransactionInstruction
```

```ts
import {
  AccountState, createInitializeDefaultAccountStateInstruction,
  createThawAccountInstruction, createUpdateDefaultAccountStateInstruction, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

// At mint creation — every ATA opens Frozen:
const ix = createInitializeDefaultAccountStateInstruction(mint, AccountState.Frozen, TOKEN_2022_PROGRAM_ID);
```

**Thaw flow (the part people forget).** A frozen destination **cannot receive a `MintTo` or transfer**.
After the user creates their ATA, the freeze authority thaws it:

```ts
// account = the user's ATA; authority = the mint's freeze authority
const thawIx = createThawAccountInstruction(userAta, mint, freezeAuthority.publicKey, [], TOKEN_2022_PROGRAM_ID);
```

Flip the default later (e.g. switch to permissionless once you exit beta) with:

```ts
const updateIx = createUpdateDefaultAccountStateInstruction(
  mint, AccountState.Initialized, freezeAuthority.publicKey, [], TOKEN_2022_PROGRAM_ID,
);
```

Existing accounts keep their current state — `update` only changes the default for **future** accounts.

**Gotchas.**
- Requires a **freeze authority** on the mint (set it in `createInitializeMintInstruction`). If the
  freeze authority is `null`, frozen accounts can never be thawed → permanently bricked.
- `MintTo` into a frozen ATA fails — thaw first, then mint.
- Read the current default with `getDefaultAccountState(mint)`.

## Pausable

> **Side** Mint · **Auto-pairs** `PausableAccount` · **Reversibility** pause/resume toggled by the
> pause authority, authority lockable, presence permanent · **In SDK 0.4.14** yes
> (JS name `PausableConfig`)

**Purpose.** A global kill switch. While paused, **all** transfers, mints, and burns of the mint are
rejected program-wide. The emergency-stop primitive for stablecoins/RWAs (distinct from
`DefaultAccountState`, which gates *individual* accounts).

**Init + management.**

```ts
createInitializePausableConfigInstruction(mint, authority: PublicKey | null, programId?): TransactionInstruction
createPauseInstruction(mint, authority, multiSigners?, programId?): TransactionInstruction
createResumeInstruction(mint, authority, multiSigners?, programId?): TransactionInstruction
```

```ts
import {
  createInitializePausableConfigInstruction, createPauseInstruction, createResumeInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const initIx   = createInitializePausableConfigInstruction(mint, pauseAuthority.publicKey, TOKEN_2022_PROGRAM_ID);
const pauseIx  = createPauseInstruction(mint, pauseAuthority.publicKey, [], TOKEN_2022_PROGRAM_ID);
const resumeIx = createResumeInstruction(mint, pauseAuthority.publicKey, [], TOKEN_2022_PROGRAM_ID);
```

**Gotchas.**
- Pausing is **global and immediate** — every integration that moves the token starts failing. Wire an
  alert and keep the pause authority on a fast-signing multisig.
- Account **creation** and **close** still work while paused; only value movement is blocked.
- Read state with `getPausableConfig(mint)` (`{ authority, paused }`).

## MintCloseAuthority

> **Side** Mint · **Auto-pairs** none · **Reversibility** authority can close the mint when supply is 0,
> presence permanent · **In SDK 0.4.14** yes

**Purpose.** Allow a designated authority to **close the mint account and reclaim its rent** once
**supply is 0**. Classic SPL Token mints can never be closed; this fixes that for short-lived or
test mints.

**Init signature.**

```ts
createInitializeMintCloseAuthorityInstruction(
  mint: PublicKey, closeAuthority: PublicKey | null, programId: PublicKey,
): TransactionInstruction
```

```ts
import {
  createInitializeMintCloseAuthorityInstruction, createCloseAccountInstruction, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const initIx = createInitializeMintCloseAuthorityInstruction(mint, closeAuthority.publicKey, TOKEN_2022_PROGRAM_ID);

// Later, when total supply == 0, close the mint and refund rent (same CloseAccount ix as for token accounts):
const closeIx = createCloseAccountInstruction(
  mint, rentRefundDest, closeAuthority.publicKey, [], TOKEN_2022_PROGRAM_ID,
);
```

**Gotchas.**
- **Supply must be exactly 0** (burn every token first), or the close fails with `MintHasSupply`.
- Closing a mint that other accounts still reference orphans those ATAs — only close mints you fully
  control.
- Read it with `getMintCloseAuthority(mint)`.

## NonTransferable

> **Side** Mint · **Auto-pairs** `NonTransferableAccount` · **Reversibility** **permanent** (no off
> switch) · **In SDK 0.4.14** yes

**Purpose.** Soul-bound tokens: holders can receive (via `MintTo`) and **burn/close**, but can **never
transfer**. Use for credentials, attestations, non-tradeable points, achievement badges.

**Init signature.**

```ts
createInitializeNonTransferableMintInstruction(mint: PublicKey, programId: PublicKey): TransactionInstruction
```

```ts
import { createInitializeNonTransferableMintInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
const ix = createInitializeNonTransferableMintInstruction(mint, TOKEN_2022_PROGRAM_ID);
```

**Behavior.** `MintTo` and `BurnChecked` succeed; `transferChecked` fails with `NonTransferable`. The
holder can still `closeAccount` (reclaiming the ATA rent) **after** burning to zero. The auto-paired
`NonTransferableAccount` marker is why these mints often pair with `ImmutableOwner` on ATAs (the SDK
sets that automatically for ATAs).

**Gotchas.**
- Permanent — there is no way to make a non-transferable mint transferable later. Decide up front.
- Combine with `MetadataPointer` + `TokenMetadata` to make self-describing credentials with no Metaplex
  account. Full demo: [`../examples/non-transferable/`](../examples/non-transferable/).

---

# Mint extensions: metadata & grouping

## MetadataPointer + TokenMetadata

> **MetadataPointer** — **Side** Mint · fixed-length, init **before** `initializeMint` · pointer
> updatable, lockable. **TokenMetadata** — **Side** Mint · variable-length interface data, init
> **AFTER** `initializeMint` · fields updatable, authority lockable. · **In SDK 0.4.14** yes (metadata
> via `@solana/spl-token-metadata`, re-exported)

**Purpose.** Put `name` / `symbol` / `uri` (and arbitrary `additionalMetadata` key/value pairs)
**inside the mint itself** — no Metaplex Token Metadata account required. `MetadataPointer` says *where*
the metadata lives; `TokenMetadata` is the actual data. The standard pattern points the mint **at
itself**, so one account holds both.

**The two-part flow.** `MetadataPointer` is fixed-length → initialized with the other mint extensions
**before** `initializeMint`. `TokenMetadata` is variable-length and written by the token-metadata
*interface* instruction **after** `initializeMint` (the mint must exist before metadata can be written
into it). This is the one extension whose init straddles `initializeMint`. See the full ordered tx in
[`../examples/create-mint-with-extensions/`](../examples/create-mint-with-extensions/).

**Pointer init (before initializeMint).**

```ts
createInitializeMetadataPointerInstruction(
  mint: PublicKey, authority: PublicKey | null, metadataAddress: PublicKey | null, programId: PublicKey,
): TransactionInstruction
```

```ts
import { createInitializeMetadataPointerInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
// metadata = self → pass `mint` as metadataAddress (the pointer-to-self pattern):
const pointerIx = createInitializeMetadataPointerInstruction(
  mint, payer.publicKey /* update authority */, mint /* metadata account = the mint */, TOKEN_2022_PROGRAM_ID,
);
```

**Metadata init (after initializeMint).** From `@solana/spl-token-metadata`:

```ts
createInitializeInstruction(args: {
  programId: PublicKey;   // TOKEN_2022_PROGRAM_ID
  metadata: PublicKey;    // the mint, for pointer-to-self
  updateAuthority: PublicKey;
  mint: PublicKey;
  mintAuthority: PublicKey;
  name: string; symbol: string; uri: string;
}): TransactionInstruction
```

`createInitializeInstruction` writes only `name`/`symbol`/`uri`. **`additionalMetadata` pairs are added
afterward**, one `createUpdateFieldInstruction` each (each grows the account → see rent gotcha):

```ts
import {
  createInitializeInstruction, createUpdateFieldInstruction,
  createRemoveKeyInstruction, createUpdateAuthorityInstruction, pack, type TokenMetadata,
} from '@solana/spl-token-metadata';

const initMetaIx = createInitializeInstruction({
  programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: payer.publicKey,
  mint, mintAuthority: payer.publicKey,
  name: 'Example Token', symbol: 'EXMPL', uri: 'https://example.com/token.json',
});
```

**Update / extend / remove / lock.**

```ts
// Add or overwrite a field. `field` is a Field enum (Name|Symbol|Uri) OR an arbitrary string key.
const addField = createUpdateFieldInstruction({
  programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: payer.publicKey,
  field: 'category', value: 'stablecoin',
});

// Remove a custom key (idempotent=true → no error if the key is absent).
const removeField = createRemoveKeyInstruction({
  programId: TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: payer.publicKey,
  key: 'category', idempotent: true,
});

// Lock metadata forever: set the update authority to null (one-way).
const lock = createUpdateAuthorityInstruction({
  programId: TOKEN_2022_PROGRAM_ID, metadata: mint, oldAuthority: payer.publicKey, newAuthority: null,
});
```

**Read it back.** `getTokenMetadata(connection, mint, commitment?, programId?)` returns the decoded
`{ name, symbol, uri, additionalMetadata, updateAuthority }`. `getMetadataPointerState(mint)` returns
the pointer (`{ authority, metadataAddress }`).

**Rent gotcha (the #1 metadata failure).** `getMintLen([…])` counts the **fixed** `MetadataPointer`
but **not** the variable `TokenMetadata`. Size the metadata bytes separately and fund both in the
initial `createAccount`:

```ts
import { getMintLen, ExtensionType, TYPE_SIZE, LENGTH_SIZE } from '@solana/spl-token';
const meta: TokenMetadata = { mint, name: 'Example Token', symbol: 'EXMPL',
  uri: 'https://example.com/token.json', additionalMetadata: [['category', 'stablecoin']] };
const mintLen     = getMintLen([ExtensionType.MetadataPointer]);          // fixed only
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(meta).length;          // 2 + 2 + packed bytes
const lamports    = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);
// createAccount space = mintLen; the metadata init reallocs the mint and the extra lamports cover it.
```

When you `createUpdateFieldInstruction` **later** (after creation), the mint must grow again — pre-fund
the new rent with a `SystemProgram.transfer(payer → mint)` of the rent delta **in the same tx, before
the update ix**, or the realloc fails for being non-rent-exempt. Full demo:
[`../examples/metadata/`](../examples/metadata/).

## GroupPointer + TokenGroup, GroupMemberPointer + TokenGroupMember

> **Pointers** (`GroupPointer`, `GroupMemberPointer`) — **Side** Mint · fixed-length, init **before**
> `initializeMint` · updatable, lockable. **`TokenGroup` / `TokenGroupMember`** — **Side** Mint ·
> interface data, init **AFTER** `initializeMint`. · **In SDK 0.4.14** yes (group via
> `@solana/spl-token-group`)

**Purpose.** On-chain **collections** with no Metaplex account: a "group" mint declares a `maxSize`, and
"member" mints point back at it. The royalty-NFT / fungible-collection analog of `MetadataPointer +
TokenMetadata`, using the same pointer-to-self pattern. A mint can be a group, a member, or both.

**Pointers (before initializeMint).**

```ts
createInitializeGroupPointerInstruction(mint, authority: PublicKey | null, groupAddress: PublicKey | null, programId?)
createInitializeGroupMemberPointerInstruction(mint, authority: PublicKey | null, memberAddress: PublicKey | null, programId?)
```

```ts
import {
  createInitializeGroupPointerInstruction, createInitializeGroupMemberPointerInstruction, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
// group config stored in the group mint itself:
const groupPtr  = createInitializeGroupPointerInstruction(groupMint, payer.publicKey, groupMint, TOKEN_2022_PROGRAM_ID);
// member config stored in each member mint itself:
const memberPtr = createInitializeGroupMemberPointerInstruction(memberMint, payer.publicKey, memberMint, TOKEN_2022_PROGRAM_ID);
```

**Group / member data (after initializeMint).** From `@solana/spl-token-group`:

```ts
import { createInitializeGroupInstruction, createInitializeMemberInstruction } from '@solana/spl-token-group';

// On the GROUP mint, after its initializeMint:
const initGroup = createInitializeGroupInstruction({
  programId: TOKEN_2022_PROGRAM_ID, group: groupMint, mint: groupMint, mintAuthority: payer.publicKey,
  updateAuthority: payer.publicKey, maxSize: 10_000n,
});

// On each MEMBER mint, after its initializeMint (increments the group's member count):
const initMember = createInitializeMemberInstruction({
  programId: TOKEN_2022_PROGRAM_ID, member: memberMint, memberMint, memberMintAuthority: payer.publicKey,
  group: groupMint, groupUpdateAuthority: payer.publicKey,
});
```

Manage with `createUpdateGroupMaxSizeInstruction` and `createUpdateGroupAuthorityInstruction`.

**Gotchas.**
- Like metadata, the in-mint group/member data is interface-initialized **after** `initializeMint` and
  reallocs the mint — pre-fund its TLV rent the same way (`TYPE_SIZE + LENGTH_SIZE + <state bytes>`;
  exact sizes in [`../resources/extensions-reference.md`](../resources/extensions-reference.md)).
- A member mint must reference an already-created group; `InitializeMember` fails if the group's member
  count would exceed `maxSize`.
- Group support is the least-rendered extension in wallets/explorers — verify display on your targets.

---

# Mint extensions: display-amount math

Both extensions below change the **UI amount only**. No tokens are minted or moved — the raw base-unit
balance (`amount`) is unchanged; only the human-readable `uiAmount` differs. Never use the UI amount for
on-chain accounting; always transfer/burn raw base units.

## InterestBearingConfig

> **Side** Mint · **Auto-pairs** none · **Reversibility** rate updatable by `rateAuthority`, authority
> lockable, presence permanent · **In SDK 0.4.14** yes

**Purpose.** A continuously-compounding interest **rate** (basis points per year, as an `i16` so it can
be negative) that grows the **displayed** UI amount over time. Purely cosmetic — useful for
rebasing/yield-bearing UX without minting new tokens.

**Init + update.**

```ts
createInitializeInterestBearingMintInstruction(mint, rateAuthority: PublicKey, rate: number, programId?)
createUpdateRateInterestBearingMintInstruction(mint, rateAuthority, rate: number, multiSigners?, programId?)
```

```ts
import {
  createInitializeInterestBearingMintInstruction, createUpdateRateInterestBearingMintInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const initIx   = createInitializeInterestBearingMintInstruction(mint, rateAuthority.publicKey, 500, TOKEN_2022_PROGRAM_ID); // +5%/yr
const repriceIx = createUpdateRateInterestBearingMintInstruction(mint, rateAuthority.publicKey, 250, [], TOKEN_2022_PROGRAM_ID); // → +2.5%/yr
```

**Raw ↔ UI conversion.** The accrued UI amount depends on the on-chain clock. The convenient helper
reads mint state + clock for you:

```ts
import {
  amountToUiAmountForMintWithoutSimulation,    // (connection, mint, amount: bigint) => Promise<string>
  uiAmountToAmountForMintWithoutSimulation,    // (connection, mint, uiAmount: string) => Promise<bigint>
} from '@solana/spl-token';

const ui  = await amountToUiAmountForMintWithoutSimulation(connection, mint, 1_000_000n); // e.g. "1.0273…"
const raw = await uiAmountToAmountForMintWithoutSimulation(connection, mint, '1.05');     // back to base units
```

A pure offline variant exists if you already have the config:
`amountToUiAmountForInterestBearingMintWithoutSimulation(amount, decimals, currentTimestamp,
lastUpdateTimestamp, initializationTimestamp, preUpdateAverageRate, currentRate)`. Read raw config with
`getInterestBearingMintConfigState(mint)`.

**Gotchas.**
- **No tokens are created.** Total raw supply is constant; a holder's `amount` never changes from
  interest. If you airdrop "earned interest," you must actually `mintTo` — the extension won't.
- Display every balance through the conversion helper, or your UI will under-report by the accrued
  amount. Full demo: [`../examples/interest-bearing/`](../examples/interest-bearing/).

## ScaledUiAmount

> **Side** Mint · **Auto-pairs** none · **Reversibility** multiplier updatable by authority, lockable,
> presence permanent · **In SDK 0.4.14** yes (JS name `ScaledUiAmountConfig`)

**Purpose.** A simple **multiplier** applied to the displayed amount. Unlike interest (which is
time-based and compounding), this is a flat factor you change at discrete moments — ideal for **stock
splits** and **discrete rebases** (e.g. a 2-for-1 split = multiplier 2.0).

**Init + update.**

```ts
createInitializeScaledUiAmountConfigInstruction(mint, authority: PublicKey | null, multiplier: number, programId?)
createUpdateMultiplierDataInstruction(mint, authority, multiplier: number, effectiveTimestamp: bigint, multiSigners?, programId?)
```

```ts
import {
  createInitializeScaledUiAmountConfigInstruction, createUpdateMultiplierDataInstruction, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const initIx = createInitializeScaledUiAmountConfigInstruction(mint, admin.publicKey, 1.0, TOKEN_2022_PROGRAM_ID);
// Schedule a 2-for-1 split at a unix timestamp:
const splitIx = createUpdateMultiplierDataInstruction(
  mint, admin.publicKey, 2.0, BigInt(Math.floor(Date.now() / 1000)), [], TOKEN_2022_PROGRAM_ID,
);
```

Convert with the same `amountToUiAmountForMintWithoutSimulation(connection, mint, amount)` helper, or
offline via `amountToUiAmountForScaledUiAmountMintWithoutSimulation(amount, decimals, multiplier)`. Read
config with `getScaledUiAmountConfig(mint)`.

**Gotchas.**
- The multiplier supports a **future `effectiveTimestamp`** so you can schedule a split; the SDK keeps
  the old multiplier until then.
- Like interest, this never moves base units — raw `amount` is unchanged. Display-only.

---

# Transfer-restriction extensions with their own docs

## TransferHook

> **Side** Mint · **Auto-pairs** `TransferHookAccount` · presence permanent, hook program updatable ·
> **In SDK 0.4.14** yes

CPI a custom program on **every** transfer (royalties, allow/block lists, KYC gating, counters). Init
with `createInitializeTransferHookInstruction(mint, authority, hookProgramId, programId)`; the client
**must** resolve the hook's extra accounts via
`createTransferCheckedWithTransferHookInstruction(...)` (async) or transfers fail with missing accounts.
Building the on-chain hook program (Anchor 1.x) and the `ExtraAccountMetaList` PDA, plus the full client
flow, is in **[`transfer-hooks.md`](./transfer-hooks.md)** and
[`../examples/transfer-hook/`](../examples/transfer-hook/).

## ConfidentialTransfer

> **Side** Mint (`ConfidentialTransferMint`) · **Auto-pairs** `ConfidentialTransferAccount` · presence
> permanent, config updatable · **NOT in `@solana/spl-token` 0.4.14** — kit + `@solana/zk-sdk` only

Encrypted balances via twisted-ElGamal + the ZK ElGamal Proof program, with an optional auditor key.
`@solana/spl-token` has **no** confidential module — use the kit `@solana-program/token-2022` client +
`@solana/zk-sdk`. The proof program was disabled (Jun 2025) and re-enabled on mainnet (~late Jun 2026);
**verify the feature gate per cluster before relying on it.** Full flow, key derivation, multi-tx proof
reality, and the availability caveat are in
**[`confidential-transfers.md`](./confidential-transfers.md)**.

---

# Account-side extensions (you initialize these per token account)

These three live on **token accounts**, not the mint, and are **not** auto-paired. You enable them on an
account after it exists (or, for `ImmutableOwner`, between `createAccount` and `initializeAccount3`).

## ImmutableOwner

> **Side** Account · **Reversibility** permanent · **In SDK 0.4.14** yes

**Purpose.** Prevent the account's owner from ever being reassigned (via `SetAuthority` /
`AccountOwner`). Blocks a class of phishing where a victim is tricked into transferring account
ownership. **Every ATA created under Token-2022 has this automatically** — you only init it manually for
**non-ATA** token accounts.

```ts
createInitializeImmutableOwnerInstruction(account: PublicKey, programId: PublicKey): TransactionInstruction
```

```ts
import {
  createInitializeImmutableOwnerInstruction, createInitializeAccount3Instruction,
  getAccountLen, ExtensionType, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
// Raw (non-ATA) account order: createAccount → initImmutableOwner → initializeAccount3
const space = getAccountLen([ExtensionType.ImmutableOwner]);
// ...SystemProgram.createAccount(space)...
const immutIx = createInitializeImmutableOwnerInstruction(tokenAccount, TOKEN_2022_PROGRAM_ID);
const initIx  = createInitializeAccount3Instruction(tokenAccount, mint, owner, TOKEN_2022_PROGRAM_ID);
```

**Gotcha.** For ATAs, do nothing — the ATA program sets `ImmutableOwner` for you. Manually trying to add
it to an ATA fails.

## MemoTransfer (required memo)

> **Side** Account · **Reversibility** toggleable by the account owner · **In SDK 0.4.14** yes

**Purpose.** Require that every **incoming** transfer to this account be immediately preceded by a memo
(SPL Memo program instruction). Exchanges enable it so deposits always carry a routing memo.

```ts
createEnableRequiredMemoTransfersInstruction(account, authority, multiSigners?, programId?)
createDisableRequiredMemoTransfersInstruction(account, authority, multiSigners?, programId?)
```

```ts
import { createEnableRequiredMemoTransfersInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
const enableIx = createEnableRequiredMemoTransfersInstruction(myAta, owner.publicKey, [], TOKEN_2022_PROGRAM_ID);
```

**Gotcha.** Senders must prepend a `@solana/spl-memo` `createMemoInstruction(...)` **in the same
transaction, before** the `transferChecked`, or the transfer is rejected. Document this for anyone
depositing to your account.

## CpiGuard

> **Side** Account · **Reversibility** toggleable by the account owner, **only via a top-level
> (non-CPI) instruction** · **In SDK 0.4.14** yes

**Purpose.** Protect users from malicious programs: while CpiGuard is enabled, certain privileged token
operations are **blocked when invoked through a CPI** — including transferring/burning with the
account's own authority, closing the account to a non-owner address, setting a close authority, and
approving a delegate. The user can still do these themselves at the top level.

```ts
createEnableCpiGuardInstruction(account, authority, multiSigners?, programId?)
createDisableCpiGuardInstruction(account, authority, multiSigners?, programId?)
```

```ts
import { createEnableCpiGuardInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
const guardIx = createEnableCpiGuardInstruction(myAta, owner.publicKey, [], TOKEN_2022_PROGRAM_ID);
```

**Gotcha.** CpiGuard can only be enabled/disabled by a **top-level** instruction signed by the owner —
a program cannot toggle it via CPI. If your dApp builds a flow that transfers from a user account inside
a CPI, it will fail for any user who has CpiGuard on; detect it and route through a top-level transfer
instead.

---

# Combining extensions

Most extensions stack on one mint — declare them all in the same `getMintLen([...])` and init each
before `initializeMint` (variable-length metadata/group after). Practical notes:

- **Fee + Hook** is common (royalty token with a protocol fee). Transfers need
  `createTransferCheckedWithFeeAndTransferHookInstruction`.
- **DefaultAccountState(Frozen) + PermanentDelegate + Pausable + ConfidentialTransfer** is the typical
  regulated-stablecoin stack (allowlist + clawback + kill switch + privacy).
- **MetadataPointer + TokenMetadata + NonTransferable** = self-describing soul-bound credential.
- `NonTransferable` makes a `TransferHook` pointless (nothing transfers) — don't combine them.
- `NonTransferable` + `TransferFeeConfig` is contradictory (no transfers means no fees) and wasteful.
- `ConfidentialTransfer` + plaintext `TransferFeeConfig` is **not** allowed together; the confidential
  path uses the separate `ConfidentialTransferFeeConfig` (extension 16), which is **not** in
  `@solana/spl-token` 0.4.14.

# Extensions NOT in `@solana/spl-token` 0.4.14

Four on-chain extensions have no web3.js SDK builder. Use the kit `@solana-program/token-2022` 0.12.0
client, Rust `spl-token-2022` 11.0.0, or the `spl-token` CLI:

| # | Extension | Why / where |
|---|---|---|
| 16 | `ConfidentialTransferFeeConfig` | Encrypted withheld fees — kit + `@solana/zk-sdk`; see [`confidential-transfers.md`](./confidential-transfers.md) |
| 17 | `ConfidentialTransferFeeAmount` | Auto-paired account marker for the above |
| 24 | `ConfidentialMintBurn` | Confidential mint/burn — kit / Rust / CLI |
| 28 | `PermissionedBurn` | Burns require a burn-authority co-signature — cutting-edge; kit / Rust / CLI; verify mainnet support |

The kit equivalents for every init function (`get…Instruction`) and the `ExtensionArgs` `__kind` tagged
union are mapped in [`../resources/sdk-reference.md`](../resources/sdk-reference.md).

## See also

- [`../SKILL.md`](../SKILL.md) — extension catalog table, mint-creation ordering, `transferChecked`
  variants, both-program detection.
- [`../resources/extensions-reference.md`](../resources/extensions-reference.md) — flat lookup: every
  `ExtensionType` 0–28 with sizes, params, and SDK init fns.
- [`./transfer-hooks.md`](./transfer-hooks.md) · [`./confidential-transfers.md`](./confidential-transfers.md)
  · [`./troubleshooting.md`](./troubleshooting.md)

## References

- Token-2022 extensions overview: https://www.solana-program.com/docs/token-2022/extensions
- `@solana/spl-token` (0.4.14): https://www.npmjs.com/package/@solana/spl-token
- Token Extensions guides (transfer fee, metadata, interest-bearing, default state, etc.):
  https://solana.com/developers/guides/token-extensions
- `@solana/spl-token-metadata` (0.1.6): https://www.npmjs.com/package/@solana/spl-token-metadata
- `@solana/spl-token-group` (0.0.7): https://www.npmjs.com/package/@solana/spl-token-group
- Token-2022 program source (`ExtensionType` enum, 11.0.0): https://github.com/solana-program/token-2022
