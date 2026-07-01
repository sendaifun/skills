# Transfer Hooks (Token-2022)

The `TransferHook` extension makes a mint **CPI-invoke a custom program on every transfer**
(`transferChecked` / `transferCheckedWithFee`). Use it for royalty enforcement, allow/block lists,
KYC gating, per-transfer side effects (counters, logs), or custom fees. This guide covers the
`spl-transfer-hook-interface`, the `ExtraAccountMetaList` validation account, building a hook program
in Anchor 1.x (and raw, no-Anchor), and resolving the extra accounts client-side so transfers
actually land.

This is the deep dive behind the `TransferHook` bullet in
[SKILL.md](../SKILL.md#key-extensions-tour) and the "transfer fails with missing accounts" entry in
its Common Errors. The runnable program + client live in [`../examples/transfer-hook/`](../examples/transfer-hook/).

---

## How a transfer hook works

```
transferChecked(source, mint, dest, owner, amount, decimals)
        │  Token-2022 sees the mint has the TransferHook extension
        ▼
  Token-2022 reads the hook program id from the mint extension
  Token-2022 reads the ExtraAccountMetaList PDA, resolves the extra accounts
        │
        ▼  CPI: Execute { amount }  (with source, mint, dest, authority, validation PDA, extra accounts)
  Hook program runs your logic → returns Ok or Err (Err aborts the whole transfer)
```

The hook is invoked **inside** the transfer CPI. While it runs, Token-2022 sets a `transferring`
flag on the source and destination accounts' `TransferHookAccount` extension, so a correct hook can
assert it is being called *from within a real transfer* and not directly. If the hook returns an
error, the transfer fails atomically.

> **The integration trap:** a plain `transferChecked` (or `createTransferCheckedInstruction`) on a
> hook mint **fails** — the required extra accounts are missing from the instruction. Clients **must**
> resolve and append them (see [Client side](#client-side-resolving-the-extra-accounts)).

---

## The interface: `spl-transfer-hook-interface` 2.1.0

A hook program implements three instructions, each identified by an **8-byte SPL discriminator** equal
to the first 8 bytes of `sha256("<namespace>")` (this is the SPL interface convention, *not* Anchor's
`sha256("global:<name>")[..8]`):

| Instruction | Hash input | 8-byte discriminator |
|---|---|---|
| `Execute { amount: u64 }` | `spl-transfer-hook-interface:execute` | `[105, 37, 101, 197, 75, 251, 102, 26]` |
| `InitializeExtraAccountMetaList { extra_account_metas: Vec<ExtraAccountMeta> }` | `spl-transfer-hook-interface:initialize-extra-account-metas` | `[43, 34, 13, 49, 167, 88, 235, 235]` |
| `UpdateExtraAccountMetaList { extra_account_metas: Vec<ExtraAccountMeta> }` | `spl-transfer-hook-interface:update-extra-account-metas` | `[157, 105, 42, 146, 102, 85, 241, 174]` |

```python
# Reproduce any discriminator:
import hashlib
list(hashlib.sha256(b"spl-transfer-hook-interface:execute").digest()[:8])
# -> [105, 37, 101, 197, 75, 251, 102, 26]
```

**`Execute` account ordering — fixed by the interface.** Token-2022 always passes these first, in this
exact order, then appends the resolved extra accounts:

```
0. []  Source token account
1. []  Token mint
2. []  Destination token account
3. []  Source account owner / delegate (authority)
4. []  Validation account = the ExtraAccountMetaList PDA
5..N   M extra accounts, described by the validation account's TLV data
```

Only `Execute` is called by Token-2022 during a transfer. `InitializeExtraAccountMetaList` /
`UpdateExtraAccountMetaList` are called by *you* (the mint admin) to set up / change the extra-account
list — and a program may implement them with any logic; the hello-world program below implements
`InitializeExtraAccountMetaList` itself.

---

## The `ExtraAccountMetaList` validation account

A hook can require **extra accounts** beyond the fixed five (an allowlist PDA, a counter, a config
account, a delegate, etc.). Those requirements are stored in a single **validation account**:

- A **PDA owned by the hook program** (not Token-2022), with seeds **`["extra-account-metas", mint]`**.
  - Rust helper: `spl_transfer_hook_interface::get_extra_account_metas_address(&mint, &hook_program_id)`.
  - **Common mistake:** deriving this PDA under `TOKEN_2022_PROGRAM_ID`. It is under the **hook**
    program id.
- It stores a TLV list of `ExtraAccountMeta` (`spl-tlv-account-resolution` 0.11.1). Each entry is one
  of:
  - a **literal pubkey**,
  - an **account already in the instruction**, referenced **by index**, or
  - a **PDA derived from seeds** that can reference other accounts' keys/data and the instruction data,
    resolved at transfer time.
- At transfer time Token-2022 reads this account, resolves each `ExtraAccountMeta` into a concrete
  account, and appends them to the `Execute` CPI.

Because PDA entries are resolved dynamically, the same validation list works for every transfer of the
mint without the client hard-coding addresses — but the client still has to **read** the list and
recompute the accounts (the SDK does this).

---

## Building a hook — Option A: raw interface (no Anchor)

The minimal correct hook validates the `Execute` instruction against the on-chain metas. From
`transfer-hook/interface/README.md`:

```rust
use {
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult, program_error::ProgramError, pubkey::Pubkey,
    },
    spl_tlv_account_resolution::state::ExtraAccountMetaList,
    spl_transfer_hook_interface::{
        get_extra_account_metas_address,
        instruction::{ExecuteInstruction, TransferHookInstruction},
    },
};

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let TransferHookInstruction::Execute { amount } = TransferHookInstruction::unpack(input)? else {
        return Err(ProgramError::InvalidInstructionData);
    };
    let it = &mut accounts.iter();
    let _source = next_account_info(it)?;
    let mint    = next_account_info(it)?;
    let _dest   = next_account_info(it)?;
    let _auth   = next_account_info(it)?;
    let extra   = next_account_info(it)?;

    // 1. The validation PDA must be the canonical one for this mint + this program.
    if get_extra_account_metas_address(mint.key, program_id) != *extra.key {
        return Err(ProgramError::InvalidSeeds);
    }
    // 2. Every required extra account must be present, in order, with correct flags.
    let data = extra.try_borrow_data()?;
    ExtraAccountMetaList::check_account_infos::<ExecuteInstruction>(
        accounts,
        &TransferHookInstruction::Execute { amount }.pack(),
        program_id,
        &data,
    )?;
    // 3. ... your custom logic here (allowlist check, counter increment, etc.) ...
    Ok(())
}
```

Use the raw form when you want zero framework overhead. For most teams, Anchor is more ergonomic.

---

## Building a hook — Option B: Anchor 1.x (recommended)

Modern Anchor (**1.x** / 0.31+) supports the SPL interface directly with the
**`#[instruction(discriminator = ...)]`** attribute and **`extensions::transfer_hook`** mint
constraints. This is the form used by `solana-developers/program-examples`
(`tokens/token-2022/transfer-hook/hello-world/anchor`).

### `Cargo.toml`

```toml
[dependencies]
anchor-lang = "1.1.2"
anchor-spl  = "1.1.2"
spl-transfer-hook-interface = "2.1.0"
spl-tlv-account-resolution  = "0.11.1"
spl-discriminator           = "0.4"        # provides SplDiscriminate / SPL_DISCRIMINATOR_SLICE

[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

### `lib.rs`

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, Token2022, TokenAccount},
};
use spl_discriminator::SplDiscriminate;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::{
    ExecuteInstruction, InitializeExtraAccountMetaListInstruction,
};

declare_id!("HookExampLe1111111111111111111111111111111"); // replace with your program id

#[program]
pub mod transfer_hook {
    use super::*;

    /// Helper that creates a mint with the transfer-hook extension pointing at THIS program.
    pub fn initialize(_ctx: Context<Initialize>, _decimals: u8) -> Result<()> {
        Ok(())
    }

    /// Build the ExtraAccountMetaList PDA. Discriminator matches the SPL interface, so Token-2022's
    /// `InitializeExtraAccountMetaList` CPI routes here.
    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let metas = InitializeExtraAccountMetaList::extra_account_metas()?; // Vec<ExtraAccountMeta>
        // spl crates use solana-program-error 2.x; anchor-lang 1.x uses 3.x (same shape, different
        // semver) -> wrap the spl Result so the error types line up.
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &metas,
        )
        .map_err(|_| ProgramError::InvalidAccountData)?;
        Ok(())
    }

    /// Called by Token-2022 on EVERY transfer. Discriminator matches `spl-transfer-hook-interface:execute`.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // Optional but recommended: prove we are inside a real transfer (see "transferring flag" below).
        // Your custom logic goes here, e.g. allowlist check, royalty, counter increment.
        msg!("transfer hook fired for amount {}", amount);
        let _ = &ctx.accounts.mint;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(_decimals: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        mint::decimals = _decimals,
        mint::authority = payer,
        extensions::transfer_hook::authority = payer,     // who can update the hook program id
        extensions::transfer_hook::program_id = crate::ID, // this program is the hook
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: validation PDA — must use these EXACT seeds, owned by this hook program.
    #[account(
        init,
        payer = payer,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas_count()
        ).unwrap(),
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    // hello-world: no extra accounts. See "Adding extra accounts" below to require some.
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(vec![])
    }
    pub fn extra_account_metas_count() -> usize {
        0
    }
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source owner (SystemAccount or PDA)
    pub owner: UncheckedAccount<'info>,
    /// CHECK: validation PDA
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
}
```

### Asserting "only inside a transfer" (the `transferring` flag)

Token-2022 sets `transferring == true` on the source account's `TransferHookAccount` extension **only
during** the CPI. Check it to reject anyone who calls your `transfer_hook` instruction directly:

```rust
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
    },
    pod::PodAccount,
};

let info = ctx.accounts.source_token.to_account_info();
let mut data = info.try_borrow_mut_data()?;
let mut acc = PodStateWithExtensionsMut::<PodAccount>::unpack(*data)
    .map_err(|_| ProgramError::InvalidAccountData)?;
let ext = acc.get_extension_mut::<TransferHookAccount>()
    .map_err(|_| ProgramError::InvalidAccountData)?;
require!(bool::from(ext.transferring), MyError::NotTransferring);
```

### Legacy Anchor (≤ 0.30)

Older guides use a different idiom: annotate `transfer_hook` with
**`#[interface(spl_transfer_hook_interface::execute)]`** **and** hand-write a `fallback` function that
inspects the raw 8-byte discriminator and dispatches the `Execute` instruction manually (Anchor ≤ 0.30
could not match the SPL discriminator otherwise). Prefer the **1.x `#[instruction(discriminator = ...)]`**
form above; only reach for `#[interface]` + `fallback` if you are pinned to 0.30 or earlier.

> **Version gotcha:** the spl crates compile against `solana-program-error` **2.x**, while
> `anchor-lang` 1.x pulls **3.x**. They are the same shape but different semver, so spl `Result`s do
> not auto-convert into Anchor's `Result` — wrap them with `.map_err(|_| ProgramError::...)` as shown.

---

## Adding extra accounts

To require accounts beyond the fixed five, return them from `extra_account_metas()` and update the
count. `ExtraAccountMeta` supports literal pubkeys, by-index references, and PDAs resolved from seeds:

```rust
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed};

pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
    Ok(vec![
        // (a) a fixed, known account (e.g. a config/allowlist authority):
        ExtraAccountMeta::new_with_pubkey(&CONFIG_PUBKEY, false /*signer*/, false /*writable*/)
            .map_err(|_| ProgramError::InvalidAccountData)?,

        // (b) a PDA derived at transfer time from a literal + the mint (account index 1 in Execute):
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"counter".to_vec() },
                Seed::AccountKey { index: 1 }, // 1 = the mint, per the fixed Execute ordering
            ],
            false, // is_signer
            true,  // is_writable (a counter we mutate)
        ).map_err(|_| ProgramError::InvalidAccountData)?,
    ])
}
pub fn extra_account_metas_count() -> usize { 2 }
```

> `Seed::{Literal, AccountKey, AccountData}` and `ExtraAccountMeta::{new_with_pubkey, new_with_seeds}` are verified against `spl-tlv-account-resolution` 0.11.1.

The indexes available to seeds are: `0` source, `1` mint, `2` destination, `3` authority, `4`
validation PDA, then `5..` previously-resolved extra accounts. The matching `TransferHook` accounts
struct must list these extra accounts (after the fixed five) so your handler can read them, and the
**client resolves them automatically** — that is the entire point of storing them on-chain.

---

## Client side: resolving the extra accounts

### One step before transfers: initialize the validation PDA

After creating the hook mint, call your program's `initialize_extra_account_meta_list` once per mint to
build the validation PDA. With the Anchor 1.x TS client (`@anchor-lang/core` 1.1.2):

```ts
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

// PDA is under the HOOK program id, NOT Token-2022:
const [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('extra-account-metas'), mint.toBuffer()],
  program.programId, // the hook program
);

await program.methods
  .initializeExtraAccountMetaList()
  .accounts({
    payer: payer.publicKey,
    extraAccountMetaList: extraAccountMetaListPda,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

### Transfers: resolve + append the extra accounts (`@solana/spl-token` 0.4.14)

A plain checked transfer on a hook mint fails. Use
**`createTransferCheckedWithTransferHookInstruction`** — it reads the validation PDA over RPC,
resolves every extra account, and appends them:

```ts
import {
  TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createTransferCheckedWithTransferHookInstruction,
} from '@solana/spl-token';

const source = getAssociatedTokenAddressSync(mint, sender.publicKey, false, TOKEN_2022_PROGRAM_ID);
const dest   = getAssociatedTokenAddressSync(mint, recipient,        false, TOKEN_2022_PROGRAM_ID);

// async: resolves the ExtraAccountMetaList PDA + all extra accounts off-chain via RPC.
// signature: (connection, source, mint, destination, owner, amount, decimals,
//             multiSigners?, commitment?, programId?)
const ix = await createTransferCheckedWithTransferHookInstruction(
  connection, source, mint, dest, sender.publicKey,
  1_000_000n /* amount */, 6 /* decimals */, [], 'confirmed', TOKEN_2022_PROGRAM_ID,
);
```

Related builders in `@solana/spl-token`:

```ts
// Lower-level: mutate an existing transferChecked ix to append the resolved extra accounts.
// (programId here is the HOOK program id.)
addExtraAccountMetasForExecute(connection, instruction, hookProgramId, source, mint, destination, owner, amount, commitment?)

// Fee + hook combined (mint has both TransferFeeConfig and TransferHook):
createTransferCheckedWithFeeAndTransferHookInstruction(connection, source, mint, destination, owner, amount, decimals, fee, multiSigners?, commitment?, programId?)

// Mint-side extension config (set/update which program is the hook):
createInitializeTransferHookInstruction(mint, authority, transferHookProgramId, programId)         // run BEFORE initializeMint
createUpdateTransferHookInstruction(mint, authority, transferHookProgramId, multiSigners?, programId?)
```

One-shot high-level helpers (build + sign + send + confirm) also exist:
`transferCheckedWithTransferHook(...)`, `transferCheckedWithFeeAndTransferHook(...)`,
`initializeTransferHook(...)`, `updateTransferHook(...)`.

### kit equivalent

The kit `@solana-program/token-2022` 0.12.0 client exposes the hook config builders
(`getInitializeTransferHookInstruction`, `getUpdateTransferHookInstruction`) and resolves extra
accounts for transfers via its `getTransferCheckedInstruction` + the hook-resolution helpers in
`transferToATA`. Don't mix `PublicKey` (web3.js) and `Address` (kit) types in the same path.

---

## Guidelines

- **DO** use `createTransferCheckedWithTransferHookInstruction` (or `addExtraAccountMetasForExecute`)
  for every transfer of a hook mint — a plain `transferChecked` fails with missing accounts.
- **DO** derive the validation PDA with seeds `["extra-account-metas", mint]` **under the hook program
  id**, never under Token-2022.
- **DO** call `initialize_extra_account_meta_list` once per mint before anyone transfers.
- **DO** validate the `Execute` accounts with `ExtraAccountMetaList::check_account_infos` (raw) or rely
  on Anchor's account constraints; assert the `transferring` flag to reject direct calls.
- **DO** keep hook logic cheap and deterministic — it runs on **every** transfer and adds compute to
  each one; an expensive or failing hook makes the token un-transferable.
- **DON'T** assume wallets/DEXs/AMMs handle hook mints — many call plain `transferChecked` and will
  break. Test integration on your target venues before launch.
- **DON'T** mutate the source/destination token account data inside the hook in ways that conflict with
  Token-2022's own writes; treat the fixed five as read-mostly.
- **DON'T** forget to update `extra_account_metas_count()` (and the PDA `space`) when you add extra
  accounts, or `init` will allocate too little and fail.

---

## Common Errors

### Error: transfer fails with "insufficient account keys" / missing accounts
**Cause** A plain `createTransferCheckedInstruction` was used on a `TransferHook` mint; the hook's
extra accounts (validation PDA + resolved metas) were never appended.
**Solution** Use `createTransferCheckedWithTransferHookInstruction` (async) or
`addExtraAccountMetasForExecute`. For fee+hook mints use
`createTransferCheckedWithFeeAndTransferHookInstruction`.

### Error: `InvalidSeeds` / validation account not found in the hook
**Cause** The `ExtraAccountMetaList` PDA was derived under the wrong program (e.g. Token-2022) or with
the wrong seed string.
**Solution** Seeds are exactly `[b"extra-account-metas", mint]` under the **hook** program id. Use
`get_extra_account_metas_address(&mint, &hook_program_id)` (Rust) or
`findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], hookProgramId)` (TS).

### Error: hook program panics / `AccountNotInitialized` for the validation account
**Cause** `initialize_extra_account_meta_list` was never called for this mint, so the validation PDA
doesn't exist yet.
**Solution** Call it once after creating the mint (and before any transfer).

### Error: Anchor build — mismatched `ProgramError` / `solana-program-error` types
**Cause** The spl crates use `solana-program-error` 2.x while `anchor-lang` 1.x uses 3.x.
**Solution** Wrap spl `Result`s with `.map_err(|_| ProgramError::InvalidAccountData)` (or similar) so
the error types align. Keep `anchor-lang`/`anchor-spl` at matching `1.1.2`.

### Error: discriminator mismatch / `Execute` not routed to your handler
**Cause** On Anchor ≤ 0.30 the SPL `Execute` discriminator can't be matched by the normal dispatch.
**Solution** Use Anchor 1.x with `#[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]`,
or on legacy Anchor add `#[interface(spl_transfer_hook_interface::execute)]` + a `fallback` function.

---

## References

- Transfer Hook interface (source + README): https://github.com/solana-program/transfer-hook
- `spl-transfer-hook-interface` (crate, 2.1.0): https://crates.io/crates/spl-transfer-hook-interface
- `spl-tlv-account-resolution` (crate, 0.11.1): https://crates.io/crates/spl-tlv-account-resolution
- Anchor transfer-hook example (1.x idioms): https://github.com/solana-developers/program-examples/tree/main/tokens/token-2022/transfer-hook/hello-world/anchor
- Transfer Hook extension guide: https://www.solana-program.com/docs/token-2022/extensions#transfer-hook
- `@solana/spl-token` transfer-hook helpers (0.4.14): https://www.npmjs.com/package/@solana/spl-token
- Anchor (program framework, `anchor-lang`/`anchor-spl` 1.1.2): https://www.anchor-lang.com
- Runnable program + client: [`../examples/transfer-hook/`](../examples/transfer-hook/) · SDK mapping: [`../resources/sdk-reference.md`](../resources/sdk-reference.md)
