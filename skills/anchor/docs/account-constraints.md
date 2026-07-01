# Anchor Account Constraints — Exhaustive Reference

The complete `#[account(..)]` constraint catalog for **Anchor 1.1.2** (`anchor-lang`/`anchor-spl` `1.1.2`): every constraint with exact syntax, what it checks, the error it raises, and a copy-paste snippet — plus the `anchor-spl` token/mint/ATA/extension constraints and the `InterfaceAccount` pattern that makes one program serve **both** SPL Token and Token-2022.

This is the lookup companion to the "Accounts & the constraint system" section of [../SKILL.md](../SKILL.md), which shows only the everyday subset. For CPI and PDA-signing patterns see [cpi-and-pdas.md](cpi-and-pdas.md); for the attack/mitigation framing see [security.md](security.md).

> Version note: the constraint **syntax** below is stable across 0.30 → 1.1.2. The two parser additions exclusive to **Anchor 1.0+** are the custom account `discriminator = …` macro argument and the runtime duplicate-mutable-account default. Error-code numbers and the `CpiContext` signature in this doc are verified against `anchor-lang 1.1.2` source.

---

## How to read this reference

- A constraint is written inside `#[account(..)]` on a field of a `#[derive(Accounts)]` struct. Multiple constraints are comma-separated in one attribute.
- `<expr>` is any Rust expression of the expected type, e.g. `owner = token_program.key()`.
- `<target>` is the **name of another field in the same struct**; `.key()` is implicit, so `payer = authority` means `payer = authority.key()`.
- Most check-style constraints accept a **custom error** via `@`: `constraint = expr @ MyError::X`. The custom error replaces Anchor's built-in constraint error in client logs.
- `#[instruction(...)]` (placed **after** `#[derive(Accounts)]`) pulls the handler's instruction args into scope so `seeds`/`space`/`constraint` can reference them. List args in handler order; you may drop trailing args but not skip a middle one.

**Pick the wrapper type first.** Most checks are free with the right type (`Account<T>` = owner + discriminator; `Signer` = signed; `Program<T>` = program id + executable; `InterfaceAccount<T>` = one of several owners). Constraints add the relationships the type cannot express. The account-type table lives in [../SKILL.md](../SKILL.md).

### Constraint → built-in error (verified against `anchor-lang 1.1.2`)

Error groups: `>= 1000` IDL, `>= 2000` constraint, `>= 2500` `require!`, `>= 3000` account, `>= 4100` misc. A `@ MyError::X` overrides the built-in.

| Constraint | Checks / effect | Built-in error (code) |
|---|---|---|
| `mut` | writable; serialize changes on exit | `ConstraintMut` (2000) / `AccountNotMutable` (3006) |
| `has_one = x` | `account.x == x.key()` | `ConstraintHasOne` (2001) |
| `signer` | account signed the tx | `ConstraintSigner` (2002) / `AccountNotSigner` (3010) |
| `constraint = expr` | arbitrary boolean | `ConstraintRaw` (2003) |
| `owner = expr` | on-chain owner program == expr | `ConstraintOwner` (2004) / `AccountOwnedByWrongProgram` (3007) |
| `rent_exempt = enforce` | account is rent-exempt | `ConstraintRentExempt` (2005) |
| `seeds = [..], bump` | PDA matches derivation | `ConstraintSeeds` (2006) |
| `executable` | account is a program | `ConstraintExecutable` (2007) / `InvalidProgramExecutable` (3009) |
| `associated_token::*` | ATA matches mint/authority | `ConstraintAssociated` (2009) / `ConstraintAssociatedInit` (2010) |
| `close = dest` | safe close (see below) | `ConstraintClose` (2011) |
| `address = expr` | account key == expr | `ConstraintAddress` (2012) |
| `zero` | discriminator is all-zero | `ConstraintZero` (2013) |
| `token::mint` | token account's mint matches | `ConstraintTokenMint` (2014) |
| `token::authority` | token account's owner matches | `ConstraintTokenOwner` (2015) |
| `mint::authority` | mint authority matches | `ConstraintMintMintAuthority` (2016) |
| `mint::freeze_authority` | freeze authority matches | `ConstraintMintFreezeAuthority` (2017) |
| `mint::decimals` | mint decimals match | `ConstraintMintDecimals` (2018) |
| `space` / `init` size | sufficient byte length | `ConstraintSpace` (2019) |
| `token::token_program` | token account owner program | `ConstraintTokenTokenProgram` (2021) |
| `mint::token_program` | mint owner program | `ConstraintMintTokenProgram` (2022) |
| `associated_token::token_program` | ATA owner program | `ConstraintAssociatedTokenTokenProgram` (2023) |
| `extensions::group_pointer::*` | Token-2022 group pointer | 2024–2026 |
| `extensions::group_member_pointer::*` | Token-2022 group member pointer | 2027–2029 |
| `extensions::metadata_pointer::*` | Token-2022 metadata pointer | 2030–2032 |
| `extensions::close_authority::*` | Token-2022 mint close authority | 2033–2034 |
| `extensions::permanent_delegate::*` | Token-2022 permanent delegate | 2035–2036 |
| `extensions::transfer_hook::*` | Token-2022 transfer hook | 2037–2039 |
| duplicate `mut` accounts (default) | same `mut` account passed twice | `ConstraintDuplicateMutableAccount` (2040) |
| `realloc` over cap | grow ≤ 10,240 bytes/ix | `AccountReallocExceedsLimit` (3016) |
| `Account<T>` deserialize | owner + 8-byte discriminator | `AccountDiscriminatorMismatch` (3002) / `AccountNotInitialized` (3012) |

---

## 1. Lifecycle constraints

### `init`

Creates the account via CPI to the System Program and writes its 8-byte discriminator. **Implies `mut`** and is **mutually exclusive with `mut`** (adding both is a compile error). Makes the account rent-exempt unless `rent_exempt = skip`. Cannot create accounts larger than **10 KiB** (the CPI allocation ceiling) — use [`zero`](#zero) for those.

On the same struct, `init` requires:
- `payer = <target>` — funds account creation,
- a field literally named `system_program` of type `Program<'info, System>`,
- `space = <num_bytes>` — for Anchor-owned accounts **add 8** for the discriminator (see [§5](#5-sizing-space-initspace-max_len)).

```rust
#[account(init, payer = payer, space = 8 + MyData::INIT_SPACE)]
```

```rust
#[account]
#[derive(InitSpace)]
pub struct MyData { pub data: u64 }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + MyData::INIT_SPACE)]
    pub data_account: Account<'info, MyData>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

`init` combinations:
- Add `seeds = [..], bump` to make the new account a **PDA** (the program signs its own PDA's creation; Anchor uses the canonical bump).
- Add `owner = <expr>` to assign a **non-default program owner** to the new raw account.
- **`seeds::program` cannot be combined with `init`** — only the executing program can sign for creating its own PDA.

```rust
#[derive(Accounts)]
pub struct InitPda<'info> {
    #[account(
        init, payer = payer, space = 8 + MyData::INIT_SPACE,
        seeds = [b"data", payer.key().as_ref()], bump
    )]
    pub pda_data: Account<'info, MyData>,
    // raw account owned by another program:
    #[account(init, payer = payer, space = 8 + 8, owner = other_program.key())]
    pub for_other: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub other_program: Program<'info, OtherProgram>,
}
```

> Re-running `init` against an already-created address fails (`AccountDiscriminatorAlreadySet`, 3000, or a System "account already in use" error) — reinitialization is structurally impossible. That is exactly why `init` is the safe default and `init_if_needed` is not.

### `init_if_needed`

Same as `init`, but creation runs only if the account does not yet exist. **Feature-gated** — enable `init-if-needed` on `anchor-lang`:

```toml
anchor-lang = { version = "1.1.2", features = ["init-if-needed"] }
```

Two footguns, both verified from the macro doc-comment:

1. **The handler body still runs when the account already exists.** Anchor only skips *creation*, never your instruction logic. Without an explicit guard an attacker re-calls the instruction to reset authority/balances to attacker-chosen values — the classic re-initialization attack. Add an `is_initialized` flag check, only write fields that are safe to overwrite, or (preferred) split into two instructions.
2. **`extensions::*` checks are skipped under `init_if_needed`.** Token-2022 mint-extension constraints are *not* validated in this path.

```rust
#[derive(Accounts)]
pub struct InitIfNeeded<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + MyData::INIT_SPACE)]
    pub data_account: Account<'info, MyData>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

```rust
// Guard pattern inside the handler:
let acc = &mut ctx.accounts.data_account;
require!(!acc.is_initialized, MyError::AlreadyInitialized); // only set state once
acc.is_initialized = true;
acc.authority = ctx.accounts.payer.key();
```

### `zero`

Checks the account discriminator is all-zero — a freshly created, not-yet-initialized account. **Implies `mut`** and enforces rent exemption unless `rent_exempt = skip`. Use this for accounts **larger than 10 KiB**, which `init` cannot create via CPI: create the account in a prior instruction/transaction (e.g. `SystemProgram.createAccount` client-side, or a `createAccountWithSeed`), then pass it here.

```rust
#[account(zero)]
pub big_account: Account<'info, LargeState>,
```

### `close`

Closes the account safely after the instruction. **Requires `mut`** on the closed account (and, best practice, a `mut` `SystemAccount` destination). Modern Anchor (0.30+) close performs three steps:

1. transfers **all** lamports to `<dest>`,
2. **reassigns the owner to the System Program** (`assign(&system_program::ID)`),
3. **reallocs data length to 0**.

There is **no** `CLOSED_ACCOUNT_DISCRIMINATOR` sentinel anymore. A "revived" (re-funded) account is then System-owned with empty data, so re-passing it as `Account<T>` fails the owner + discriminator check — closing is revival-safe by construction. Never hand-roll closing by zeroing lamports; that leaves data intact within the transaction and is exploitable.

```rust
#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, close = receiver)]   // drain → receiver, assign System, realloc(0)
    pub data_account: Account<'info, MyData>,
    #[account(mut)]
    pub receiver: SystemAccount<'info>,
}
```

### `realloc` (`realloc::payer`, `realloc::zero`)

Reallocates an existing program account's data length at the **start** of the instruction. The account must be `mut` and an `Account` or `AccountLoader`. Prefer this over manual `AccountInfo::realloc` — it enforces the `MAX_PERMITTED_DATA_INCREASE` cap of **10,240 bytes per instruction** (`AccountReallocExceedsLimit`, 3016) and keeps the account rent-exempt.

- **Additive** change: lamports move from `realloc::payer` into the account to keep it rent-exempt.
- **Subtractive** change: lamports above the new rent-exempt minimum move **back** to `realloc::payer`. ⚠️ This sweeps **all** surplus lamports, not just rent savings — never use subtractive `realloc` on an account that intentionally holds extra lamports (e.g. a vault), or you drain it to the payer.
- `realloc::zero = <bool>`: whether newly grown bytes are zero-initialized. `true` costs more CU; set `false` only when you will fully overwrite the new region.

```rust
#[derive(Accounts)]
pub struct Resize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"example"], bump,
        realloc = 8 + MyData::INIT_SPACE + 100,
        realloc::payer = payer,
        realloc::zero = false,
    )]
    pub acc: Account<'info, MyData>,
    pub system_program: Program<'info, System>,
}
```

To grow by more than 10,240 bytes, call the resize instruction repeatedly across multiple transactions.

---

## 2. Access & relationship constraints

### `mut`

Marks the account writable **and** makes Anchor persist (serialize) state changes on exit. Without `mut`, in-memory mutations are silently discarded. Custom errors via `@`.

```rust
#[account(mut)]
pub data_account: Account<'info, MyData>,
#[account(mut @ MyError::NotWritable)]
pub other: Account<'info, MyData>,
```

> Anchor 1.0+ **rejects duplicate mutable accounts by default**: passing the same account as two `mut` `Account<T>` fields raises `ConstraintDuplicateMutableAccount` (2040). This only covers types that serialize on exit; `UncheckedAccount`, `Signer`, `SystemAccount`, `AccountLoader`, `Program`, and `Interface` do not serialize and so are *not* covered. For those — and as a self-documenting guard everywhere — add an explicit inequality `constraint` (see [duplicate-mutable mitigation](#duplicate-mutable-accounts)).

### `signer`

Checks the account signed the transaction. Prefer the `Signer<'info>` type when signing is the only requirement; use the constraint to add signing to an already-typed account.

```rust
#[account(signer)]
pub authority: AccountInfo<'info>,
#[account(signer @ MyError::Unauthorized)]
pub payer: AccountInfo<'info>,
```

A signer only proves *someone* signed — pair it with `has_one`/`constraint` to prove it is the *right* signer.

### `has_one`

Checks that the field named `<target>` stored **on** the deserialized account equals the key of the same-named field in the Accounts struct: `account.target == target.key()`. The field names must match. Chain multiple `has_one`s. Custom errors via `@`.

```rust
#[account(mut, has_one = authority @ MyError::Unauthorized)]
pub state: Account<'info, State>,
pub authority: Signer<'info>,   // has_one checks state.authority == authority.key()
```

`has_one = x` is shorthand for `constraint = account.x == x.key()`. It does **not** require that account to be a signer — combine with `Signer`/`signer` for real authorization.

### `address`

Checks the account key equals a specific pubkey. Use for fixed admins, config singletons, a specific mint, or sysvars. Custom errors via `@`.

```rust
#[account(address = crate::ADMIN @ MyError::WrongAdmin)]
pub admin: Signer<'info>,
#[account(address = anchor_lang::solana_program::sysvar::rent::ID)]
pub rent: UncheckedAccount<'info>,   // requires a /// CHECK comment
```

### `owner`

Checks the account's on-chain **owner program** matches `<expr>`. Distinct from `has_one` (a stored data field) — this is the Solana account `owner`. Use it for accounts owned by an external program when you can't use a typed wrapper.

```rust
#[account(owner = token_program.key())]
pub raw_token_acct: UncheckedAccount<'info>,   // requires a /// CHECK comment
pub token_program: Program<'info, Token>,
```

Idiomatically, prefer the typed wrapper (`Account<T>` checks `owner == this program`; `InterfaceAccount<TokenAccount>` checks owner ∈ {Token, Token-2022}) over a raw `owner` constraint.

### `constraint = <expr>`

Arbitrary boolean check — the escape hatch when no built-in constraint fits. Raises `ConstraintRaw` (2003) or your `@` error.

```rust
#[account(constraint = vault.mint == mint.key() @ MyError::MintMismatch)]
pub vault: Account<'info, Vault>,
pub mint: InterfaceAccount<'info, Mint>,
```

### `executable`

Checks the account is a program. Prefer the `Program<'info, T>` type, which also pins the program ID.

```rust
#[account(executable)]
pub some_program: AccountInfo<'info>,
```

### `rent_exempt`

`= enforce` forces a rent-exemption check; `= skip` skips the rent-exemption check that `init`/`zero` would otherwise imply.

```rust
#[account(zero, rent_exempt = skip)]
pub skipped: Account<'info, MyData>,
#[account(rent_exempt = enforce)]
pub enforced: AccountInfo<'info>,
```

---

## 3. PDA constraints — `seeds`, `bump`, `seeds::program`

Checks the account is a PDA derived from the executing program, the `seeds`, and (optionally) the `bump`. **`bump` with no value uses the canonical bump** (what `find_program_address` returns — the highest valid off-curve bump); Anchor rejects every non-canonical bump, closing the bump-canonicalization attack. `seeds::program = <expr>` derives the PDA from a **different** program (cannot combine with `init`).

Four valid shapes:

```rust
#[account(seeds = <seeds>, bump)]                                   // canonical
#[account(seeds = <seeds>, bump, seeds::program = <expr>)]          // canonical, foreign program
#[account(seeds = <seeds>, bump = <expr>)]                          // explicit (stored) bump
#[account(seeds = <seeds>, bump = <expr>, seeds::program = <expr>)] // explicit bump, foreign program
```

```rust
#[derive(Accounts)]
pub struct Example<'info> {
    #[account(seeds = [b"example_seed"], bump)]
    pub canonical_pda: AccountInfo<'info>,
    #[account(seeds = [b"example_seed"], bump, seeds::program = other_program.key())]
    pub foreign_pda: AccountInfo<'info>,
    pub other_program: Program<'info, OtherProgram>,
}
```

### Canonical bump: store it, then reuse it

When Anchor resolves a `bump`, it exposes the value on the generated struct field **`ctx.bumps.<account_name>`** (the pre-0.29 `ctx.bumps.get("name")` HashMap API is gone). Best practice: store the canonical bump on `init`, then pass it back with `bump = <stored>` on later instructions to skip the 255-iteration `find_program_address` search.

```rust
pub fn initialize(ctx: Context<Initialize>, input: u64) -> Result<()> {
    ctx.accounts.new_account.data = input;
    ctx.accounts.new_account.bump = ctx.bumps.new_account; // store the canonical bump
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init, payer = signer, space = 8 + DataAccount::INIT_SPACE,
        seeds = [b"seed", signer.key().as_ref()], bump
    )]
    pub new_account: Account<'info, DataAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Update<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"seed", signer.key().as_ref()],
        bump = existing_account.bump   // reuse the stored canonical bump (cheaper)
    )]
    pub existing_account: Account<'info, DataAccount>,
}

#[account]
#[derive(InitSpace)]
pub struct DataAccount { pub data: u64, pub bump: u8 }
```

Store only the **canonical** bump (`ctx.bumps.<field>`), never an attacker- or client-supplied bump — passing a non-canonical bump to `bump = stored` reopens the non-canonical-PDA attack.

PDA design (signer seeds for CPI, seed-collision avoidance, domain-specific seeds) is covered in depth in [cpi-and-pdas.md](cpi-and-pdas.md).

---

## 4. Custom discriminator (Anchor 1.0+)

Overrides the default 8-byte account discriminator (`SHA256("account:<StructName>")[..8]`). Any const expression works; **all-zero discriminators are rejected** (pre-1.0, a zeroed discriminator let program-owned accounts be taken over via IDL instructions — 1.0 closes that). Non-8-byte discriminators are allowed, which is how you match a native/legacy on-chain layout.

```rust
#[account(discriminator = 12)]
#[account(discriminator = [1, 2, 3, 4])]
#[account(discriminator = MY_CONST_DISCRIMINATOR)]
```

This is a **type-macro argument** (on `#[account(...)]` over the *struct*), not a field constraint. When a custom discriminator length differs from 8, size `init` with `T::DISCRIMINATOR.len() + T::INIT_SPACE` ([§5](#5-sizing-space-initspace-max_len)). Not available on 0.32.1 (it parses there as part of `#[account]` differently — treat as 1.0+).

---

## 5. Sizing: `space`, `InitSpace`, `#[max_len]`

For Anchor-owned accounts, **always add 8** to `space` for the discriminator. `#[derive(InitSpace)]` generates `T::INIT_SPACE` (the byte size of all fields, **excluding** the discriminator), so the canonical form is `space = 8 + T::INIT_SPACE`. Use `T::DISCRIMINATOR.len() + T::INIT_SPACE` when the account has a custom, non-8-byte discriminator.

Per-type byte sizes:

| Type | Bytes |
|---|---|
| `bool`, `u8`, `i8` | 1 |
| `u16`, `i16` | 2 |
| `u32`, `i32`, `f32` | 4 |
| `u64`, `i64`, `f64` | 8 |
| `u128`, `i128` | 16 |
| `Pubkey` | 32 |
| `[T; n]` | `n * size(T)` |
| `Vec<T>` | `4 + max_len * size(T)` |
| `String` | `4 + max_len` (bytes) |
| `Option<T>` | `1 + size(T)` |
| `enum` | `1 + largest_variant` |

`#[max_len(N)]` is **required** on every `String`/`Vec<T>` field (it counts elements, not bytes); use `#[max_len(outer, inner)]` for nested `Vec<Vec<_>>` / `Vec<String>`. Account size is fixed at creation — size for the maximum you will ever need (or use [`realloc`](#realloc-reallocpayer-realloczero) to grow later).

```rust
#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub authority: Pubkey,        // 32
    #[max_len(50)]
    pub name: String,             // 4 + 50
    #[max_len(10)]
    pub tags: Vec<u32>,           // 4 + 10*4
    #[max_len(10, 5)]
    pub matrix: Vec<Vec<u8>>,     // 4 + 10*(4 + 5*1)
    pub bump: u8,                 // 1
}
// init constraint: space = 8 + Profile::INIT_SPACE
```

---

## 6. anchor-spl constraints — token / mint / associated_token / extensions

These `init`-create or validate SPL Token and Token-2022 accounts declaratively. Bring the types in from `anchor_spl::token` (legacy SPL Token only) or, to support **both** programs, `anchor_spl::token_interface` (with `InterfaceAccount`). When used as a pure check (no `init`), you may specify a subset of the sub-constraints.

Add `"anchor-spl/idl-build"` to the program's `idl-build` feature when you use any of these:

```toml
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

### `token::{mint, authority, token_program}`

Create (with `init`) or validate a **token account** with the given mint and authority. `token::token_program` overrides which token program owns it.

```rust
#[account(
    init, payer = payer,
    token::mint = mint,
    token::authority = payer,
    token::token_program = token_program,
)]
pub token: InterfaceAccount<'info, TokenAccount>,
```

### `mint::{authority, decimals, freeze_authority, token_program}`

Create (with `init`) or validate a **mint** with the given decimals and authority. `mint::freeze_authority` and `mint::token_program` are optional.

```rust
#[account(
    init, payer = payer,
    mint::decimals = 9,
    mint::authority = payer,
    mint::freeze_authority = payer,
    mint::token_program = token_program,
)]
pub mint: InterfaceAccount<'info, Mint>,
```

### `associated_token::{mint, authority, token_program}`

Create (with `init`) or validate an **Associated Token Account (ATA)** for the given mint and authority. Creating one requires an `associated_token_program: Program<'info, AssociatedToken>` field. The ATA address is deterministic from `(authority, token_program, mint)` — the token program id is a seed, so the same wallet+mint resolves to a *different* ATA under Token vs Token-2022.

```rust
#[account(
    init, payer = payer,
    associated_token::mint = mint,
    associated_token::authority = payer,
    associated_token::token_program = token_program,
)]
pub ata: InterfaceAccount<'info, TokenAccount>,
```

### `extensions::*` — Token-2022 mint extensions

Create/validate Token-2022 **mint extensions** with `init` on an `InterfaceAccount<'info, Mint>`. Present in both 0.32.1 and 1.1.2. ⚠️ These checks are **skipped under `init_if_needed`**.

```rust
#[account(extensions::close_authority::authority = <target>)]
#[account(extensions::permanent_delegate::delegate = <target>)]
#[account(
    extensions::transfer_hook::authority = <target>,
    extensions::transfer_hook::program_id = <target>,
)]
#[account(
    extensions::metadata_pointer::authority = <target>,
    extensions::metadata_pointer::metadata_address = <target>,
)]
#[account(
    extensions::group_pointer::authority = <target>,
    extensions::group_pointer::group_address = <target>,
)]
#[account(
    extensions::group_member_pointer::authority = <target>,
    extensions::group_member_pointer::member_address = <target>,
)]
```

The exhaustive Token-2022 extension catalog (sizes, irreversibility, init ordering) lives in the **`token-2022`** skill; here we only cover the Anchor constraint surface.

---

## 7. Dual-program support — `InterfaceAccount` + `Interface<TokenInterface>`

`Account<'info, T>` validates the account is owned by exactly **one** program. `InterfaceAccount<'info, T>` accepts **multiple** valid owner programs — this is the mechanism that makes a program token-program-agnostic.

- `InterfaceAccount<'info, Mint>` — a mint owned by SPL Token **or** Token-2022.
- `InterfaceAccount<'info, TokenAccount>` — a token account owned by either.
- `Interface<'info, TokenInterface>` — the token-program field; accepts either program id. Thread it into every `*::token_program` constraint and use it as the CPI program.

Token-2022 keeps SPL Token's base account layout, so one `TokenAccount`/`Mint` wrapper deserializes both; `InterfaceAccount` only verifies the owner is one of the two token programs. Because the actual program differs at runtime, you **must** pass it through `token::token_program` / `mint::token_program` / `associated_token::token_program` and use it as the CPI program in `transfer_checked` etc.

**Contrast:** `Account<'info, TokenAccount>` + `Program<'info, Token>` (from `anchor_spl::token`) hard-locks the instruction to legacy SPL Token (`Tokenkeg…`) and **rejects** every Token-2022 (`Tokenz…`) account. Use it only when you deliberately want to exclude Token-2022.

Idiomatic dual-program transfer struct (compile-ready on anchor-spl 1.1.2):

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct Transfer<'info> {
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = authority,
        token::token_program = token_program,
    )]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,   // Token OR Token-2022
}
```

A runnable dual-program vault is in [../examples/token-vault/](../examples/token-vault/); the matching `transfer_checked` CPI is in [cpi-and-pdas.md](cpi-and-pdas.md).

Program ids these constraints bind to:

| Program | ID | Anchor const |
|---|---|---|
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `anchor_spl::token::ID` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `anchor_spl::token_2022::ID` |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | `anchor_spl::associated_token::ID` |

---

## 8. Full multi-account example

A vault-config initialization that exercises most constraints in one struct — `init` + PDA, `mut`, `Signer`, `has_one`, `address`, dual-program ATA creation, an inequality `constraint`, and a closed-on-this-ix account. `#[instruction(..)]` brings the handler arg into seed/constraint scope.

```rust
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // Must be the protocol admin (fixed pubkey) AND must sign.
    #[account(address = crate::ADMIN @ VaultError::WrongAdmin)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    // New config PDA, seeded with the instruction arg + payer (domain-specific seeds).
    #[account(
        init,
        payer = payer,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [b"vault", payer.key().as_ref(), &seed.to_le_bytes()],
        bump,
        constraint = mint.key() != crate::BANNED_MINT @ VaultError::BannedMint,
    )]
    pub config: Account<'info, VaultConfig>,

    // Vault ATA owned by the config PDA; works for SPL Token AND Token-2022.
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = config,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    // A prior temp account closed as part of this instruction; rent → payer.
    #[account(mut, has_one = payer, close = payer)]
    pub temp: Account<'info, TempState>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_vault(ctx: Context<CreateVault>, seed: u64) -> Result<()> {
    let cfg = &mut ctx.accounts.config;
    cfg.authority = ctx.accounts.payer.key();
    cfg.mint = ctx.accounts.mint.key();
    cfg.seed = seed;
    cfg.bump = ctx.bumps.config;          // store the canonical bump for later CPI signing
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub seed: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TempState { pub payer: Pubkey }

#[error_code]
pub enum VaultError {
    #[msg("Signer is not the protocol admin")]
    WrongAdmin,
    #[msg("This mint is not allowed")]
    BannedMint,
}
```

### Duplicate mutable accounts

Anchor 1.0+ **rejects two mutable `Account<T>` that resolve to the same key by default** (`ConstraintDuplicateMutableAccount`, 2040). Use `#[account(mut, dup)]` to *intentionally* allow a duplicate. That default check covers only **serializing** account types, so for non-serializing types (`Signer`, `SystemAccount`, `UncheckedAccount`, `Program`, `Interface`, `AccountLoader`) add an explicit inequality `constraint` — also good self-documenting practice everywhere:

```rust
#[derive(Accounts)]
pub struct TransferBetween<'info> {
    #[account(mut, constraint = from.key() != to.key() @ MyError::SameAccount)]
    pub from: Account<'info, User>,
    #[account(mut)]
    pub to: Account<'info, User>,
}
```

---

## 9. Version notes (0.32.1 ↔ 1.x parser deltas)

The constraint **syntax** is identical from 0.30 through 1.1.2, so every example above compiles on the older line if you only change the crate version. The constraint-layer differences when moving to 1.x:

| Item | 0.32.1 | 1.0+ |
|---|---|---|
| Custom account `discriminator = …` | not a stable macro arg | available (`#[account(discriminator = …)]`); all-zero rejected |
| Duplicate `mut` accounts | allowed (silent footgun) | **rejected by default** (`ConstraintDuplicateMutableAccount`, 2040); opt in with `#[account(mut, dup)]` |
| `close` revival sentinel | already assign-to-System + realloc(0) (0.30+) | same (no `CLOSED_ACCOUNT_DISCRIMINATOR`) |
| `ctx.bumps` | struct field `ctx.bumps.name` (since 0.29) | same |
| Discriminator access | `DISCRIMINATOR` const (method removed in 0.31) | same |

Full crate/toolchain matrix and the 0.3x → 1.x migration guide: [../resources/version-compatibility.md](../resources/version-compatibility.md).

---

## Guidelines

**DO**

- DO pick the wrapper **type** first (`Account`, `Signer`, `Program`, `InterfaceAccount`, `Sysvar`); add constraints only for relationships the type can't encode.
- DO use `space = 8 + T::INIT_SPACE` with `#[derive(InitSpace)]` and `#[max_len]` — never hand-count bytes you can derive.
- DO use `seeds = [..], bump` for canonical PDAs, store `ctx.bumps.<field>` on init, and reuse it with `bump = stored`.
- DO use `InterfaceAccount` + `Interface<TokenInterface>` + `*::token_program` to serve SPL Token and Token-2022 from one struct.
- DO add `@ MyError::X` custom errors to `has_one`/`constraint`/`address` so client logs are actionable.
- DO add `"anchor-spl/idl-build"` to `idl-build` whenever you use anchor-spl constraints.

**DON'T**

- DON'T use `init_if_needed` without a re-initialization guard, and remember the handler body still runs when the account exists (and `extensions::*` checks are skipped).
- DON'T add both `init` and `mut` (mutually exclusive), and don't forget the `system_program` field that `init`/`init_if_needed` require.
- DON'T combine `seeds::program` with `init`.
- DON'T use subtractive `realloc` on an account that holds surplus lamports (vaults) — it sweeps the surplus to `realloc::payer`.
- DON'T pass the same account for two mutable `Account<T>` params (1.0+ rejects it, 2040) — use `#[account(mut, dup)]` to allow it intentionally, and `constraint = a.key() != b.key()` for non-serializing types.
- DON'T use `Account<TokenAccount>`/`Program<Token>` if you want Token-2022 support — that locks you to legacy SPL Token.
- DON'T pass a sysvar as a raw `AccountInfo` and trust it — read it via `Clock::get()`/`Rent::get()`, type it as `Sysvar<T>`, or pin it with `address`.

---

## Common Errors

### Error: `ConstraintSeeds` — "A seeds constraint was violated" (2006)
**Cause** The passed account doesn't match the PDA derived from your `seeds`/`bump`: wrong seed bytes/order, a stale or non-canonical stored bump, or the client derived the PDA differently than the program.
**Solution** Derive on the client with identical seeds via `findProgramAddressSync`. If you use `bump = stored`, ensure the stored value is the canonical bump (`ctx.bumps.<field>`).

### Error: `ConstraintHasOne` — "A has one constraint was violated" (2001)
**Cause** The `account.<field>` stored on-chain does not equal the key of the passed `<field>` account (wrong authority/owner account supplied).
**Solution** Pass the account whose key matches the stored field; if intentional, the stored field is wrong — fix the data or the accounts.

### Error: `AccountDidNotSerialize` — "Failed to serialize the account" (3004) / space too small
**Cause** `space` is too small — usually a forgotten `+ 8` discriminator, a `String`/`Vec` exceeding its `#[max_len]`, or a struct that grew without bumping `space`.
**Solution** Use `space = 8 + T::INIT_SPACE`; raise `#[max_len(N)]`; for deployed accounts that must grow, add `realloc`.

### Error: `AccountOwnedByWrongProgram` (3007)
**Cause** A typed wrapper (`Account<T>`, `InterfaceAccount<TokenAccount>`) received an account owned by a different program — e.g. a Token-2022 account where an `Account<TokenAccount>` (legacy-only) was declared.
**Solution** Use `InterfaceAccount` + `Interface<TokenInterface>` for dual-program support, or fix the account you pass.

### Error: `ConstraintTokenTokenProgram` (2021) / `ConstraintMintTokenProgram` (2022)
**Cause** The `*::token_program` you threaded does not own the passed token account/mint (e.g. you passed the Token-2022 program but a legacy SPL Token account).
**Solution** Detect the mint's program from its account `.owner` and pass the matching `Interface<TokenInterface>` field for all related accounts.

### Error: `AccountReallocExceedsLimit` (3016)
**Cause** A single `realloc` grew the account by more than `MAX_PERMITTED_DATA_INCREASE` (10,240 bytes).
**Solution** Grow in ≤ 10,240-byte steps across multiple instructions/transactions.

For a broader build/test/deploy catalog see [troubleshooting.md](troubleshooting.md).

---

## References

- Account constraints reference: https://www.anchor-lang.com/docs/references/account-constraints
- Account types reference: https://www.anchor-lang.com/docs/references/account-types
- `#[derive(Accounts)]` macro (docs.rs): https://docs.rs/anchor-lang/latest/anchor_lang/derive.Accounts.html
- `InterfaceAccount`: https://docs.rs/anchor-lang/latest/anchor_lang/accounts/interface_account/struct.InterfaceAccount.html
- `anchor_spl::token_interface` (SPL Token + Token-2022): https://docs.rs/anchor-spl/latest/anchor_spl/token_interface/index.html
- Space reference (`InitSpace`/`#[max_len]`): https://www.anchor-lang.com/docs/references/space
- Anchor error codes (source): https://github.com/solana-foundation/anchor/blob/v1.1.2/lang/error/src/lib.rs
- 1.0.0 release notes (breaking changes): https://www.anchor-lang.com/docs/updates/release-notes/1-0-0
