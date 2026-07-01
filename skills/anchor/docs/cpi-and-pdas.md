# Anchor CPI & PDA Patterns

Cross-Program Invocation (CPI) and Program Derived Address (PDA) design, in depth, for **Anchor 1.1.2** (`anchor-lang`/`anchor-spl` `1.1.2`). Covers `CpiContext::new` vs `new_with_signer`, anchor-spl `token_interface` transfers/mints/burns that serve **both** SPL Token and Token-2022, System-Program CPIs, CPI into an arbitrary program via `declare_program!`, return data, and the PDA patterns (signer seeds, stored bumps, seed-collision avoidance, `reload()`).

This expands the "CPI" and "PDAs" sections of [../SKILL.md](../SKILL.md). For the constraint surface (`seeds`/`bump`, `token::*`, `InterfaceAccount`) see [account-constraints.md](account-constraints.md); for the attack/mitigation framing see [security.md](security.md).

> **1.0 API change — read this first.** In Anchor 1.0+, `CpiContext::new` takes the **program id** (`Pubkey`), not the program's `AccountInfo` as in 0.3x. The verified 1.1.2 signatures are:
> ```rust
> CpiContext::new(program_id: Pubkey, accounts: T) -> CpiContext
> CpiContext::new_with_signer(program_id: Pubkey, accounts: T, signer_seeds: &[&[&[u8]]]) -> CpiContext
> ctx.with_signer(signer_seeds)   // builder form on an existing CpiContext
> ```
> Pass `ctx.accounts.token_program.key()` (a `Pubkey`), **not** `.to_account_info()`. Code or tutorials using `CpiContext::new(program.to_account_info(), …)` are pre-1.0 and will not compile on 1.1.2.

---

## Overview

A CPI is one program calling an instruction of another within the same transaction. Anchor wraps it in a typed `CpiContext<T>` whose `accounts: T` struct names the callee's accounts and whose `program_id` names the callee. Two cases:

- **Plain CPI** (`CpiContext::new`) — the program invokes with the signatures already present on the transaction. Use when the authority is a wallet `Signer` you already have.
- **PDA-signed CPI** (`CpiContext::new_with_signer`) — the program signs *on behalf of a PDA it controls* by supplying the PDA's seeds + bump. The runtime re-derives the PDA from those seeds under the **calling** program and grants it signer authority for the inner instruction. This is `invoke_signed` under the hood. A PDA can only be signed for by the program that owns its derivation — you cannot forge another program's PDA signature.

CPIs made through Anchor's generated CPI helpers (`anchor_spl::token_interface::transfer_checked`, a `declare_program!` `cpi` module, etc.) verify the **target program id** for you, which closes the arbitrary-CPI attack class.

---

## 1. anchor-spl token CPIs (`token_interface`) — SPL Token + Token-2022

Use **`anchor_spl::token_interface`** (not `anchor_spl::token`) so one code path serves both programs. Always use `transfer_checked` (never `transfer`) — Token-2022 requires the mint + decimals for hooks/fees, and `transfer_checked` is correct for both programs. Thread the runtime token program through the `*::token_program` constraints and pass `token_program.key()` as the CPI program id.

### `transfer_checked` with a wallet authority (`CpiContext::new`)

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = user, token::token_program = token_program)]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),          // Pubkey, not to_account_info()
        TransferChecked {
            from:      ctx.accounts.from.to_account_info(),
            mint:      ctx.accounts.mint.to_account_info(),
            to:        ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;
    Ok(())
}
```

### `transfer_checked` signed by a PDA authority (`CpiContext::new_with_signer`)

Withdraw from a vault whose authority is a `config` PDA. The signer seeds **must exactly match** the PDA's derivation, with the stored bump appended as the final `&[bump]` element. Bind any `to_le_bytes()` to a local first — it is a temporary that the seeds slice borrows.

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [b"config", config.owner.as_ref(), &config.seed.to_le_bytes()], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = config, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let owner = ctx.accounts.config.owner;
    let seed_bytes = ctx.accounts.config.seed.to_le_bytes();           // bind the temporary
    let bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"config", owner.as_ref(), &seed_bytes, &[bump]]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from:      ctx.accounts.vault.to_account_info(),
            mint:      ctx.accounts.mint.to_account_info(),
            to:        ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),         // the PDA signs
        },
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct Config { pub owner: Pubkey, pub seed: u64, pub bump: u8 }
```

### `mint_to` and `burn`

Same shape — pick the accounts struct and helper. `MintTo { mint, to, authority }`, `Burn { mint, from, authority }`. A PDA mint-authority signs with `new_with_signer`; a wallet authority uses `new`.

```rust
use anchor_spl::token_interface::{self, MintTo, Burn};

// Mint signed by a PDA mint-authority:
let signer_seeds: &[&[&[u8]]] = &[&[b"mint_auth", &[ctx.accounts.config.bump]]];
let cpi = CpiContext::new_with_signer(
    ctx.accounts.token_program.key(),
    MintTo {
        mint:      ctx.accounts.mint.to_account_info(),
        to:        ctx.accounts.recipient.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),     // PDA
    },
    signer_seeds,
);
token_interface::mint_to(cpi, amount)?;

// Burn from a user-owned token account (wallet authority):
let cpi = CpiContext::new(
    ctx.accounts.token_program.key(),
    Burn {
        mint:      ctx.accounts.mint.to_account_info(),
        from:      ctx.accounts.from.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    },
);
token_interface::burn(cpi, amount)?;
```

### Re-read after CPI: `reload()`

Anchor deserializes account data **once, at instruction entry**. After a CPI mutates an account you also hold (e.g. `mint_to` changes `mint.supply`, `transfer_checked` changes `token.amount`), the in-memory struct is **stale**. Call `reload()?` before using the new value:

```rust
token_interface::mint_to(cpi, amount)?;
ctx.accounts.mint.reload()?;                       // re-read post-CPI state
let new_supply = ctx.accounts.mint.supply;         // now correct
```

Forgetting `reload()` causes accounting based on pre-CPI numbers — a subtle, common bug.

---

## 2. System Program CPI

Import the System-Program helpers from `anchor_lang::system_program` — never add a separate `solana-program` dependency. `Transfer { from, to }` moves SOL; `CreateAccount`, `Allocate`, and `Assign` exist for manual account creation.

```rust
use anchor_lang::system_program::{self, Transfer};

// Move SOL from a user wallet into another account (wallet authority):
let cpi = CpiContext::new(
    ctx.accounts.system_program.key(),               // program id (Pubkey); or anchor_lang::system_program::ID
    Transfer {
        from: ctx.accounts.payer.to_account_info(),
        to:   ctx.accounts.vault.to_account_info(),
    },
);
system_program::transfer(cpi, lamports)?;
```

> To send SOL **out of a PDA the program owns**, use `new_with_signer` with the PDA's seeds (the PDA must be a System-owned account holding lamports). To move lamports out of a *program-owned data* account, adjust `try_borrow_mut_lamports()` directly rather than a System CPI — the System Program can only move lamports out of accounts it owns.

---

## 3. CPI to an arbitrary program (`declare_program!`)

To call another Anchor program, drop its IDL into `idls/<dep>.json` and generate a typed CPI module with `declare_program!`. The generated `<dep>::cpi` module verifies the callee's program id and exposes typed account structs.

```rust
use anchor_lang::prelude::*;
use callee::{self, program::Callee, cpi::accounts::SetData};

declare_program!(callee);          // reads idls/callee.json → generates cpi/accounts/program modules

#[program]
pub mod caller {
    use super::*;

    // Plain CPI:
    pub fn do_cpi(ctx: Context<DoCpi>, data: u64) -> Result<()> {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.callee_program.key(),
            SetData {
                data_acc:  ctx.accounts.data_acc.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        callee::cpi::set_data(cpi_ctx, data)
    }

    // PDA-signed CPI into the callee:
    pub fn do_cpi_signed(ctx: Context<DoCpi>, data: u64) -> Result<()> {
        let signer_seeds: &[&[&[u8]]] = &[&[b"authority", &[ctx.bumps.authority]]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.callee_program.key(),
            SetData {
                data_acc:  ctx.accounts.data_acc.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            signer_seeds,
        );
        callee::cpi::set_data(cpi_ctx, data)
    }
}

#[derive(Accounts)]
pub struct DoCpi<'info> {
    /// CHECK: validated by the callee program.
    #[account(mut)]
    pub data_acc: UncheckedAccount<'info>,
    #[account(seeds = [b"authority"], bump)]
    pub authority: SystemAccount<'info>,
    pub callee_program: Program<'info, Callee>,   // pins the callee id → no arbitrary CPI
}
```

For a non-Anchor (native) program with no IDL, build the `Instruction` by hand and call `anchor_lang::solana_program::program::{invoke, invoke_signed}` — and **pin the target program id yourself** with `Program<'info, T>` or an `address` constraint. Never `invoke_signed` your PDA seeds into a caller-chosen program: it inherits your PDA's signing authority (the "confused deputy" attack).

---

## 4. Return data: `set_return_data` / `get_return_data`

A program can return up to **1024 bytes** to its caller within a transaction. The callee sets it; the caller reads it after the CPI.

```rust
use anchor_lang::solana_program::program::{set_return_data, get_return_data};

// In the callee instruction:
let result: u64 = 42;
set_return_data(&result.to_le_bytes());

// In the caller, after the CPI returns:
if let Some((program_id, data)) = get_return_data() {
    // 1.1 best practice: verify WHICH program produced the data before trusting it.
    require_keys_eq!(program_id, ctx.accounts.callee_program.key(), MyError::BadReturnProgram);
    let value = u64::from_le_bytes(data[..8].try_into().unwrap());
    msg!("callee returned {}", value);
}
```

`get_return_data()` returns `Option<(Pubkey, Vec<u8>)>` where the `Pubkey` is the program that set the data. Anchor 1.1 added program-id verification on CPI return values in the generated client; on-chain you should still check the returning program id yourself, as above, before acting on the bytes. Return data is overwritten by each CPI, so read it immediately after the call that set it.

---

## 5. PDA design patterns

### Deriving — on-chain and on the client must agree

Anchor's `seeds = [..], bump` derives with `find_program_address` (the canonical bump). The client must derive identically:

```rust
// On-chain (constraint): seeds = [b"vault", owner.key().as_ref(), &seed.to_le_bytes()], bump
```

```ts
// Client (@anchor-lang/core / @solana/web3.js v1):
import { PublicKey } from "@solana/web3.js";
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), owner.toBuffer(), new BN(seed).toArrayLike(Buffer, "le", 8)],
  program.programId,
);
```

Mismatched seed bytes/order/encoding is the #1 cause of `ConstraintSeeds` (2006). `u64` seeds must use the same little-endian 8-byte encoding on both sides.

### Store the bump, then reuse it

`find_program_address` searches up to 255 bumps. Store the canonical bump on `init` (`ctx.bumps.<field>`, a generated struct field — **not** the pre-0.29 `ctx.bumps.get("name")` HashMap), then pass `bump = stored` on later instructions to skip the search:

```rust
// init handler:
ctx.accounts.config.bump = ctx.bumps.config;
// later: #[account(seeds = [...], bump = config.bump)]
```

Only ever store the **canonical** bump — never a client- or attacker-supplied one, or you reopen the non-canonical-PDA attack.

### Signer seeds arrays

`signer_seeds` has type `&[&[&[u8]]]` — a slice of "one PDA's seeds", each PDA's seeds being a slice of byte-slices, with the bump as the final element:

```rust
let signer_seeds: &[&[&[u8]]] = &[&[b"vault", owner.as_ref(), &[bump]]];
//                                ^ outer: list of PDAs (usually one)
//                                  ^ this PDA's seed list
//                                    ^ each seed is &[u8]; last is the 1-byte bump
```

To sign for **two** PDAs in one CPI, add a second inner array: `&[&[seeds_a, &[bump_a]], &[seeds_b, &[bump_b]]]`. Bind any `to_le_bytes()`/`as_ref()` temporaries to locals before building the slice, or the borrow checker rejects them.

### Domain-specific seeds — avoid PDA sharing

Seed PDAs with the user/owner/mint they belong to so authority domains can't collide. A single global PDA used as everyone's vault authority lets user A's instruction sign a withdrawal from user B's vault.

```rust
// GOOD — per-owner authority:
#[account(seeds = [b"vault", owner.key().as_ref()], bump)]
pub vault: Account<'info, Vault>,
// BAD — one shared authority for all users:
#[account(seeds = [b"vault"], bump)]
pub vault: Account<'info, Vault>,
```

### Avoid seed collisions — fixed-layout seeds

Concatenated variable-length seeds can be ambiguous: `[b"product", b"abc"]` and `[b"pr", b"oductabc"]` hash to the **same** PDA. Use fixed-length seeds, length prefixes, or constant separators between user-controlled parts:

```rust
// Risky: two variable-length, adjacent user seeds can alias.
seeds = [collection.as_bytes(), item_name.as_bytes()]
// Safer: fixed-size key seeds + a constant tag; or hash variable input to 32 bytes.
seeds = [b"item", collection_mint.as_ref(), &item_id.to_le_bytes()]
```

A PDA seed array also has at most **16 seeds**, each ≤ 32 bytes — hash longer/variable input (e.g. a name) to a fixed 32-byte digest and seed with that.

---

## Guidelines

**DO**

- DO use `anchor_spl::token_interface` + `InterfaceAccount` + `transfer_checked` so one CPI path serves SPL Token and Token-2022; pass `token_program.key()` as the CPI program id.
- DO use `CpiContext::new` for wallet authorities and `new_with_signer` for PDA authorities, with seeds that exactly match the PDA derivation + the stored bump.
- DO `reload()?` an account after a CPI mutates it before reading the new value.
- DO pin every CPI target with `Program<'info, T>` / `Interface<TokenInterface>` / `declare_program!` so the program id is verified.
- DO verify the returning program id from `get_return_data()` before trusting the bytes.
- DO seed PDAs with domain-specific, fixed-layout seeds and store the canonical bump.

**DON'T**

- DON'T pass `program.to_account_info()` to `CpiContext::new` — 1.0+ wants the program **id** (`Pubkey`).
- DON'T `invoke_signed` your PDA seeds into a caller-supplied program (confused-deputy).
- DON'T use the plain `transfer` token CPI — use `transfer_checked` for Token-2022 correctness.
- DON'T build signer seeds from un-bound temporaries (`&seed.to_le_bytes()` inline) — bind them to locals first.
- DON'T reuse one global PDA as authority for many users; don't concatenate adjacent variable-length seeds.
- DON'T read `supply`/`amount` after a CPI without `reload()`.

---

## Common Errors

### Error: "expected `Pubkey`, found `AccountInfo`" on `CpiContext::new`
**Cause** Pre-1.0 CPI form: `CpiContext::new(program.to_account_info(), accounts)`.
**Solution** Pass the program id: `CpiContext::new(ctx.accounts.token_program.key(), accounts)`.

### Error: `ConstraintSeeds` (2006) when signing a PDA CPI
**Cause** The `signer_seeds` passed to `new_with_signer` don't match the PDA's derivation — wrong order, missing a seed, wrong bump, or a `to_le_bytes()` encoding mismatch.
**Solution** Use the exact seeds from the account's `seeds = [..]` plus `&[bump]` as the final element; reuse the stored canonical bump.

### Error: `Cross-program invocation with unauthorized signer or writable account`
**Cause** The PDA you tried to sign for isn't derived from the **calling** program, the target account isn't marked writable, or the seeds/bump don't reproduce the PDA.
**Solution** Sign only for PDAs your program derives; mark mutated accounts `mut`; verify the seeds reproduce the exact PDA pubkey being signed for.

### Error: stale `supply`/`amount`/balance after a CPI
**Cause** Reading the in-memory struct after a CPI mutated the on-chain account without re-reading.
**Solution** Call `ctx.accounts.<acct>.reload()?` before using the post-CPI value.

For a broader error catalog see [troubleshooting.md](troubleshooting.md).

---

## References

- CPI guide: https://www.anchor-lang.com/docs/basics/cpi
- `CpiContext` (docs.rs): https://docs.rs/anchor-lang/latest/anchor_lang/context/struct.CpiContext.html
- `anchor_spl::token_interface`: https://docs.rs/anchor-spl/latest/anchor_spl/token_interface/index.html
- PDA basics: https://www.anchor-lang.com/docs/basics/pda
- `declare_program!`: https://www.anchor-lang.com/docs/basics/cpi#declare-program
- Solana CPI / `invoke_signed`: https://solana.com/docs/core/cpi
- Return data (`set_return_data`/`get_return_data`): https://docs.rs/solana-program/latest/solana_program/program/fn.set_return_data.html
- 1.0.0 release notes (CPI context change): https://www.anchor-lang.com/docs/updates/release-notes/1-0-0
