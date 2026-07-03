# Securing Anchor Programs — the Sealevel-Attacks Catalog

Most Solana exploits are not exotic — they are a handful of recurring account-validation mistakes catalogued in [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks) (11 numbered classes) plus a few audit-lore additions (`remaining_accounts`, rounding). This guide walks each class as an **insecure → secure** pair and gives the **exact Anchor constraint or type** that closes it. The headline insight: pick the right account *wrapper type* and most checks are free; reach for explicit constraints only for relationships the type cannot express.

All code targets `anchor-lang` **1.1.2** and returns `anchor_lang::Result<()>` (the `Result` brought in by `anchor_lang::prelude::*`). The constraint syntax below is **identical across 0.30 → 0.31 → 0.32 → 1.x**, so every mitigation is version-agnostic. The companion long-form writeups are the Solana Foundation [Program Security course](https://github.com/solana-foundation/developer-content/tree/main/content/courses/program-security); the exhaustive constraint reference is [docs/account-constraints.md](account-constraints.md).

## The foundation: account-type safety matrix

The biggest security decision in an Anchor program is which wrapper type you put on each field. The type runs checks *before your handler ever executes*.

| Type | Automatic checks |
|---|---|
| `Account<'info, T>` | **owner == declaring program** AND **8-byte discriminator** matches `T`, then deserializes. Fixes owner checks + type cosplay + data matching in one stroke — the single biggest defense. |
| `Signer<'info>` | the account **signed** the transaction (`is_signer == true`). |
| `SystemAccount<'info>` | owner == System Program (`11111111111111111111111111111111`). |
| `Program<'info, T>` | key == the program's declared ID **and** it is executable (e.g. `Program<'info, System>`, `Program<'info, Token>`). |
| `Sysvar<'info, T>` | the account is the real sysvar at its canonical address and deserializes it (`Rent`, `Clock`, …). |
| `InterfaceAccount<'info, T>` | like `Account<T>` but accepts **multiple** owning programs — the key to supporting SPL Token **and** Token-2022 (`token_interface::{Mint, TokenAccount}`). |
| `Interface<'info, T>` | the program account is **one of an allowed set** (e.g. `Interface<'info, TokenInterface>` = Token or Token-2022). |
| `AccountLoader<'info, T>` | zero-copy (`#[account(zero_copy)]`) on-demand deserialization for large accounts; checks owner + discriminator. |
| `UncheckedAccount<'info>` / `AccountInfo<'info>` | **NOTHING.** No owner, type, signer, or discriminator check. Anchor **forces a `/// CHECK: <reason>` doc comment** above the field or the program won't compile — a deliberate speed-bump so every unchecked account is justified. |

**Rule of thumb:** if you reach for `UncheckedAccount` / `AccountInfo`, you are opting out of all of Anchor's safety. Add explicit checks (`address`, `owner`, `constraint`, or a manual key comparison) and document *why* in the `/// CHECK:` comment.

## Helper macros for hand-written checks (`require!` family)

When a constraint isn't expressive enough, assert in the handler. Each aborts the transaction cleanly with your `#[error_code]` value:

```rust
require!(cond, MyError::X);              // generic boolean
require_eq!(a, b, MyError::X);           // a == b
require_neq!(a, b, MyError::X);          // a != b
require_keys_eq!(k1, k2, MyError::X);    // Pubkey ==
require_keys_neq!(k1, k2, MyError::X);   // Pubkey !=
require_gt!(a, b, MyError::X);           // a > b
require_gte!(a, b, MyError::X);          // a >= b
```

The shared error enum used across the examples below:

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum MyError {
    #[msg("Signer is not the stored authority")]
    Unauthorized,          // -> 6000
    #[msg("Arithmetic overflow")]
    Overflow,              // -> 6001
    #[msg("Duplicate account supplied")]
    DuplicateAccounts,     // -> 6002
    #[msg("Account already initialized")]
    AlreadyInitialized,    // -> 6003
    #[msg("Wrong account")]
    WrongAccount,          // -> 6004
}
```

---

## 1. Missing signer check  (`0-signer-authorization`)

**Exploit:** an instruction acts on behalf of `authority` but never checks it signed → anyone can pass someone else's pubkey and trigger privileged actions (drain, mutate, rotate authority).

```rust
// ❌ INSECURE — authority is never required to sign or to match stored state.
#[derive(Accounts)]
pub struct SetAdmin<'info> {
    #[account(mut)]
    pub state: Account<'info, State>,
    /// CHECK: unverified — the bug
    pub authority: UncheckedAccount<'info>,
}
pub fn set_admin(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.state.admin = new_admin; // anybody can call this
    Ok(())
}
```

**Fix:** type the field as **`Signer<'info>`** (auto-checks `is_signer`), and pair it with `has_one` so it must also be the *right* signer (a `Signer` only proves *someone* signed).

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct SetAdmin<'info> {
    #[account(mut, has_one = authority @ MyError::Unauthorized)]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>, // must have signed AND equal state.authority
}
```

> Manual equivalent: `require!(ctx.accounts.authority.is_signer, MyError::Unauthorized);`. The `#[account(signer)]` constraint adds the same check to an already-typed account.

## 2. Missing owner check  (`2-owner-checks`)

**Exploit:** the program reads a struct out of an account it does not own. The attacker supplies a look-alike account they fully control (or one owned by a different program) with forged fields → fake balances, bypassed auth.

```rust
// ❌ INSECURE — deserializes data without checking who owns the account.
#[derive(Accounts)]
pub struct ReadConfig<'info> {
    /// CHECK: manually unpacked below, owner never verified
    pub config: UncheckedAccount<'info>,
}
pub fn read_config(ctx: Context<ReadConfig>) -> Result<()> {
    let data = Config::try_from_slice(&ctx.accounts.config.data.borrow())?; // trusts attacker bytes
    msg!("admin = {}", data.admin);
    Ok(())
}
```

**Fix:** use **`Account<'info, T>`** — it asserts `account.owner == declaring_program_id` before deserializing. For accounts owned by an *external* program (an SPL token account), use the typed wrapper or the explicit **`owner`** constraint.

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct ReadConfig<'info> {
    pub config: Account<'info, Config>,                         // owner == this program (free)
    pub token_acct: InterfaceAccount<'info, TokenAccount>,      // owner ∈ {Token, Token-2022} (free)
    #[account(owner = some_program.key())]                      // explicit external-owner pin
    pub raw: UncheckedAccount<'info>,
    pub some_program: Program<'info, System>,
}
```

> Manual equivalent: `require_keys_eq!(*ctx.accounts.config.owner, crate::ID, MyError::WrongAccount);` before unpacking.

## 3. Account data matching & type cosplay  (`1-account-data-matching`, `3-type-cosplay`)

**Exploit (type cosplay):** two account types with identical byte layouts (e.g. `User { Pubkey }` and `Metadata { Pubkey }`) are interchangeable — pass a `Metadata` where a `User` is expected because nothing distinguishes the *type*. **Exploit (data matching):** the program trusts a field without checking it relates to the signer.

```rust
// ❌ INSECURE — no discriminator, no relationship check.
#[derive(Accounts)]
pub struct UpdateUser<'info> {
    /// CHECK: raw, deserialized by hand
    #[account(mut)]
    pub user: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}
// Attacker passes ANY 32-byte account; no proof it is a User or belongs to `authority`.
```

**Fix:** `#[account]` automatically prepends a unique **8-byte discriminator** (`sha256("account:<StructName>")[..8]`); `Account<'info, T>` verifies it, so a `Metadata` can never pose as a `User`. Tie the data to the caller with **`has_one`** (or a `constraint`).

```rust
// ✅ SECURE
#[account]                 // injects the 8-byte discriminator
pub struct User { pub authority: Pubkey, pub points: u64 }

#[derive(Accounts)]
pub struct UpdateUser<'info> {
    #[account(mut, has_one = authority @ MyError::Unauthorized)] // type + relationship enforced
    pub user: Account<'info, User>,
    pub authority: Signer<'info>,
}
```

> Anchor 0.31+ allows a **custom discriminator** via the type-macro argument `#[account(discriminator = N)]` (e.g. a 1-byte tag to match a native layout). This is a *type-macro* argument, not a field constraint — don't confuse it with `#[account(...)]` field constraints. Default stays 8 bytes.

## 4. Arbitrary CPI / unchecked program ID  (`5-arbitrary-cpi`)

**Exploit:** the program `invoke`s whatever program account the caller passes. The attacker passes a malicious program that mimics the expected interface → your PDA/authority signs a call into attacker code (a "confused deputy").

```rust
// ❌ INSECURE — invokes whatever token_program was supplied.
pub fn transfer(ctx: Context<Cpi>, amount: u64) -> Result<()> {
    let ix = spl_token::instruction::transfer(
        ctx.accounts.token_program.key,            // attacker-controlled program id
        ctx.accounts.from.key, ctx.accounts.to.key,
        ctx.accounts.authority.key, &[], amount,
    )?;
    anchor_lang::solana_program::program::invoke(&ix, &[/* ... */])?;
    Ok(())
}
```

**Fix:** type the program as **`Program<'info, Token>`** (checks key == `spl_token::ID`) or, for dual SPL/Token-2022 support, **`Interface<'info, TokenInterface>`** + the **`token::token_program`** constraint, and make the call through Anchor's generated CPI module (`token_interface::transfer_checked(...)`), which pins the target program ID.

```rust
// ✅ SECURE
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

#[derive(Accounts)]
pub struct Cpi<'info> {
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::token_program = token_program)]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>, // validated set: Token or Token-2022
}

pub fn transfer(ctx: Context<Cpi>, amount: u64) -> Result<()> {
    let cpi = CpiContext::new(
        ctx.accounts.token_program.key(),          // 1.x: program id (Pubkey), NOT to_account_info()
        TransferChecked {
            from: ctx.accounts.from.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi, amount, ctx.accounts.mint.decimals)?;
    Ok(())
}
```

> Never `invoke_signed` with your PDA seeds into a caller-chosen program. Statically pin every CPI target. See [docs/cpi-and-pdas.md](cpi-and-pdas.md).

## 5. Authority confusion / missing `has_one`  (`1-account-data-matching`, course: account-data-matching)

**Exploit:** the program never verifies the `authority` signer matches the authority **stored in** the state account → any holder of the right account *type* can act on someone else's account.

```rust
// ❌ INSECURE — Account<State> + Signer, but no link between them.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,   // any signer is accepted
}
```

**Fix:** **`#[account(has_one = authority)]`** asserts `vault.authority == authority.key()`. `has_one = x` is exactly shorthand for `constraint = vault.x == x.key()`; chain several and attach custom errors with `@`.

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = authority @ MyError::Unauthorized)]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}
// arbitrary relationships: #[account(constraint = vault.mint == mint.key() @ MyError::WrongAccount)]
```

> `has_one` only checks that a stored field equals the *passed account's key* — it does **not** require that account to have signed. Combine it with `Signer` (or `signer`) for true authorization.

## 6. PDA bump non-canonicalization & PDA sharing  (`7-bump-seed-canonicalization`, `8-pda-sharing`)

**Exploit (non-canonical bump):** `create_program_address` accepts *any* bump that lands off-curve. If the program lets the user supply a bump and only checks the PDA is valid, an attacker uses a non-canonical bump to derive a *second* valid PDA for the same logical seeds → duplicate/parallel state. **Exploit (PDA sharing):** using one global PDA as the signing authority for every user lets user A's instruction sign a transfer out of user B's vault.

```rust
// ❌ INSECURE — trusts a user-supplied bump and shares one global authority seed.
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Withdraw<'info> {
    /// CHECK: derived with create_program_address from a user-supplied bump
    #[account(seeds = [b"vault"], bump = bump)]   // global seed → one authority for everyone
    pub vault_authority: UncheckedAccount<'info>,
}
```

**Fix:** use **`#[account(seeds = [...], bump)]`** — Anchor derives with `find_program_address` (the **canonical**, highest bump) and rejects anything else; it will not even *initialize* a PDA on a non-canonical bump. Make seeds **domain-specific** so authority domains can't collide.

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"vault", owner.key().as_ref()],  // domain-specific seeds, not a global PDA
        bump = vault.bump,                          // reuse the stored canonical bump (cheaper)
        has_one = owner,
    )]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}
// On init: vault.bump = ctx.bumps.vault;  (store the canonical bump Anchor found)
```

> **Seed-collision pitfall (Zellic):** concatenated variable-length seeds can be ambiguous — `[b"product", b"abc"]` and `[b"pr", b"oductabc"]` hash to the **same** PDA. Use fixed-length seeds, length prefixes, or constant separators between user-controlled parts. `ctx.bumps.<field>` (a struct field, not the pre-0.29 `.get("name")` HashMap) exposes the canonical bump.

## 7. Account reinitialization  (`4-initialization`)

**Exploit:** an init path that doesn't guard against re-running lets an attacker re-initialize an existing (funded) account — resetting authority/state/balances to attacker-chosen values.

```rust
// ❌ INSECURE — init_if_needed with no guard; the body runs even when the account already exists.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = payer, space = 8 + User::INIT_SPACE)]
    pub user: Account<'info, User>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.user.authority = ctx.accounts.payer.key(); // re-callable → resets authority
    Ok(())
}
```

**Fix (preferred):** plain **`#[account(init, payer, space)]`** creates the account via System CPI and writes the discriminator; a second `init` on the same address **fails** — reinitialization is structurally impossible.

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = payer, space = 8 + User::INIT_SPACE)]
    pub user: Account<'info, User>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

> **`init_if_needed` is the danger** (feature-gated: `anchor-lang = { version = "1.1.2", features = ["init-if-needed"] }`). When the account already exists, Anchor skips *creation* but **still runs your handler** — so you MUST guard (`require!(!user.is_initialized, MyError::AlreadyInitialized)`) or only overwrite fields that are safe to reset. Anchor put it behind a feature flag specifically to force deliberate opt-in. Prefer two distinct instructions. Note: `extensions::*` token constraints are skipped under `init_if_needed`.

## 8. Integer overflow / underflow  (Anchor/Rust idiom; not in repo)

**Exploit:** `balance = balance + amount` silently *wraps* in release builds when overflow checks are off → mint infinite tokens, underflow a balance to `u64::MAX`, bypass caps.

```rust
// ❌ INSECURE — wraps on overflow in --release if overflow-checks is disabled.
ctx.accounts.vault.balance = ctx.accounts.vault.balance + amount;
```

**Fix (two layers):** keep `overflow-checks = true` in the release profile (Anchor writes this — *keep it*) **and** use checked math in the handler so overflow is a clean program error, not a panic.

```toml
# workspace Cargo.toml — written by `anchor init`; do not remove.
[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
```

```rust
// ✅ SECURE
ctx.accounts.vault.balance = ctx.accounts.vault.balance
    .checked_add(amount)
    .ok_or(MyError::Overflow)?;
// Use checked_add/sub/mul/div. For casts use u64::try_from(x)?, never `as`.
// saturating_* only when clamping is the intended semantics.
```

> Auditors flag programs that disable `overflow-checks` for CU savings without compensating `checked_*` math. This is one of two classes Anchor **cannot** fix declaratively — cover it with boundary-value tests (0, `u64::MAX`, off-by-one).

## 9. Closing accounts / revival  (`9-closing-accounts`)

**Exploit:** "closing" by only zeroing lamports leaves the account's *data* intact for the rest of the transaction (garbage collection happens after the tx). An attacker tops the lamports back up in a later instruction of the **same tx** → the account is "revived" with all its data and the program still owns it → double-spend of a supposedly-consumed account.

```rust
// ❌ INSECURE — hand-rolled close: data survives, owner unchanged, revivable within the tx.
let dest = &ctx.accounts.receiver;
let acct = ctx.accounts.data_account.to_account_info();
**dest.lamports.borrow_mut() += **acct.lamports.borrow();
**acct.lamports.borrow_mut() = 0; // data + owner still intact → revival
```

**Fix:** **`#[account(mut, close = destination)]`**. Verified modern behavior (`anchor-lang` `common.rs::close`): it (1) transfers **all** lamports to `destination`, (2) **reassigns the owner to the System Program** (`assign(&system_program::ID)`), and (3) **reallocs data length to 0** (`realloc(0, false)`). A revived account is then System-owned with empty data, so re-passing it as `Account<T>` fails the owner + discriminator checks.

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, close = receiver, has_one = authority @ MyError::Unauthorized)]
    pub data_account: Account<'info, MyData>,
    #[account(mut)]
    pub receiver: SystemAccount<'info>,   // gets the rent lamports
    pub authority: Signer<'info>,
}
```

> **Modern note:** older Anchor wrote a sentinel `CLOSED_ACCOUNT_DISCRIMINATOR` (`[255; 8]`) instead of reassigning to System; that constant is **gone** in current Anchor (0.30+). The legacy `force_defund` manual pattern is no longer needed. Do **not** hand-roll closing — use the `close` constraint.

## 10. Duplicate mutable accounts  (`6-duplicate-mutable-accounts`)

**Exploit:** an instruction takes two mutable accounts of the same type (`user_a`, `user_b`) and the attacker passes the **same** account for both. Anchor deserializes each into a separate in-memory copy; the last write wins, so a "transfer a→b" can double or zero a balance.

```rust
// ❌ INSECURE — nothing stops user_a and user_b from being the same account.
#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(mut)] pub user_a: Account<'info, User>,
    #[account(mut)] pub user_b: Account<'info, User>,
}
```

**Fix:** Anchor 1.0+ already **rejects** two mutable `Account<T>` that resolve to the same key (`ConstraintDuplicateMutableAccount`, 2040) — pass distinct accounts, or add `#[account(mut, dup)]` if a duplicate is genuinely intended. The default check covers only **serializing** types, so for non-serializing ones (`Signer`/`SystemAccount`/`UncheckedAccount`/`Program`/`Interface`) add an explicit inequality **`constraint`**:

```rust
// ✅ SECURE
#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(mut, constraint = user_a.key() != user_b.key() @ MyError::DuplicateAccounts)]
    pub user_a: Account<'info, User>,
    #[account(mut)]
    pub user_b: Account<'info, User>,
}
```

> Manual equivalent: `require_keys_neq!(ctx.accounts.user_a.key(), ctx.accounts.user_b.key(), MyError::DuplicateAccounts);`.

## 11. Sysvar / account substitution  (`10-sysvar-address-checking`)

**Exploit:** the program takes a sysvar (Rent, Clock) as a raw `AccountInfo` and trusts its contents. The attacker substitutes a fake account with forged rent/clock values → bypass time locks, mis-price rent.

```rust
// ❌ INSECURE — reads a clock from an attacker-supplied account.
#[derive(Accounts)]
pub struct Unlock<'info> {
    /// CHECK: trusted blindly — the bug
    pub clock: UncheckedAccount<'info>,
}
```

**Fix (preferred):** don't pass sysvars as accounts at all — read them via syscall: `Clock::get()?`, `Rent::get()?`. There is nothing to substitute. Otherwise use the typed **`Sysvar<'info, T>`** or pin any account with the **`address`** constraint.

```rust
// ✅ SECURE
pub fn unlock(ctx: Context<Unlock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;          // syscall — unspoofable
    require_gte!(now, ctx.accounts.lock.unlock_at, MyError::WrongAccount);
    Ok(())
}

// or typed:        pub rent: Sysvar<'info, Rent>,
// or address pin:  #[account(address = anchor_lang::solana_program::sysvar::rent::ID)]
//                  pub rent: UncheckedAccount<'info>,
```

> **Generalize the `address` constraint** to any account that must be one specific known pubkey (a fixed admin, a specific mint, a config singleton): `#[account(address = EXPECTED @ MyError::WrongAccount)]`.

## 12. `remaining_accounts` trust  (Zellic; not in repo)

**Exploit:** `ctx.remaining_accounts` is a raw `&[AccountInfo]`. **None** of Anchor's protections apply — no owner, discriminator, signer, or PDA validation. Code that loops over them and reads/mutates without checks is fully exploitable.

```rust
// ❌ INSECURE — mutates arbitrary attacker-supplied accounts.
for acc in ctx.remaining_accounts {
    let mut user = User::try_from_slice(&acc.data.borrow())?; // no owner/discriminator/relationship check
    user.points += 100;
    user.serialize(&mut *acc.data.borrow_mut())?;
}
```

**Fix:** validate **every** remaining account before use — owner + discriminator (via `Account::try_from`, which re-runs both checks), address (if it should be a known key), and for PDAs, re-derive and compare.

```rust
// ✅ SECURE
for acc in ctx.remaining_accounts {
    let typed = Account::<User>::try_from(acc)?;                 // owner + 8-byte discriminator checks
    require_keys_eq!(typed.authority, ctx.accounts.signer.key(), MyError::Unauthorized);
    // for a PDA: let (expected, _) = Pubkey::find_program_address(&[...], ctx.program_id);
    //            require_keys_eq!(*acc.key, expected, MyError::WrongAccount);
}
```

> Zellic: *"absolutely none of the protections that Anchor typically provides are present on the accounts in `ctx.remaining_accounts`."* Treat each as hostile; check liveness (initialized, discriminator ≠ all-zero) and PDA correctness manually.

## 13. Rounding / precision in math  (audit lore; not in repo)

**Exploit:** in DeFi math (shares↔assets, fees, exchange rates), rounding the wrong direction lets an attacker extract value — rounding deposits/shares **up** for the user and withdrawals **down** lets repeated tiny ops siphon dust; first-depositor share inflation; fees truncating to 0.

```rust
// ❌ INSECURE — narrow types, truncating divide, rounds in the user's favor.
let shares = (amount * total_shares) / total_assets;   // u64 overflow + floor favors caller
```

**Fix:** there is no constraint — this is arithmetic discipline:

```rust
// ✅ SECURE — wide intermediates, deliberate rounding direction, checked ops.
let shares = (amount as u128)
    .checked_mul(total_shares as u128).ok_or(MyError::Overflow)?
    .checked_div(total_assets as u128).ok_or(MyError::Overflow)?;   // floor when paying the user
let shares = u64::try_from(shares).map_err(|_| MyError::Overflow)?;
// Amounts owed TO the protocol: round up (e.g. a.div_ceil(b)). Never round in the user's favor.
```

- Round **toward the protocol/pool**, never the user; choose ceil vs. floor deliberately.
- Do intermediate math in a **wider type** (`u128`), then narrow with `try_from`. Multiply before dividing.
- Guard the zero / first-deposit edge (seed the pool or enforce a minimum). **Floats are forbidden** on-chain (non-determinism + CU cost).

> Like overflow (#8), this is one of two classes Anchor cannot fix declaratively — it needs code review and extreme-value tests (see [docs/testing.md](testing.md), parameterized tests).

---

## Bonus Anchor-specific gotchas (audit-relevant)

- **Reload after CPI.** Anchor deserializes account data **once, at instruction entry**. After a CPI mutates an account (`mint_to`, `transfer`), the in-memory struct is **stale** — `mint.supply` / `token.amount` still show old values. Call **`ctx.accounts.<acct>.reload()?`** before using the post-CPI value. Forgetting this causes accounting on pre-CPI numbers.
- **Confused deputy via CPI.** A `Signer` / PDA-signer's authority flows into CPIs (`invoke_signed`). If you CPI into a caller-chosen program, it inherits your PDA's signing authority. Statically pin the target (see #4).
- **`/// CHECK:` is mandatory.** The macro refuses to compile `UncheckedAccount` / `AccountInfo` without it. Treat each as a documented, justified hole.
- **`has_one` ≠ signer.** It only proves a stored field equals a passed key; pair with `Signer` / `signer` to authorize.
- **`init_if_needed` body still runs** when the account pre-exists — the most common reinit footgun (#7).

## Security checklist

| # | Class | Anchor mitigation |
|---|---|---|
| 1 | Missing signer | `Signer<'info>` / `#[account(signer)]` |
| 2 | Missing owner | `Account<'info, T>` / `#[account(owner = …)]` / typed token wrapper |
| 3 | Type cosplay / data match | `#[account]` 8-byte discriminator via `Account<T>`; `has_one` / `constraint` |
| 4 | Arbitrary CPI | `Program<'info, T>` / `Interface<TokenInterface>` + `token::token_program`; Anchor CPI modules |
| 5 | Authority confusion | `#[account(has_one = authority)]` + `Signer` |
| 6 | Non-canonical bump / PDA share | `#[account(seeds = […], bump)]` (canonical) + domain-specific seeds; `bump = acct.bump` |
| 7 | Reinitialization | `#[account(init, …)]`; avoid `init_if_needed` or guard with `is_initialized` |
| 8 | Integer overflow | `overflow-checks = true` **and** `checked_add/sub/mul/div` |
| 9 | Close / revival | `#[account(mut, close = dest)]` (drain + realloc(0) + assign to System) |
| 10 | Duplicate mutable | Rejected by default (2040) for mutable `Account<T>`; `#[account(mut, dup)]` to allow; `constraint = a.key() != b.key()` for non-serializing types |
| 11 | Sysvar / account substitution | `Clock::get()` / `Rent::get()`; `Sysvar<T>`; `#[account(address = …)]` |
| 12 | `remaining_accounts` trust | manual owner + discriminator + address + PDA checks per account |
| 13 | Rounding / precision | round toward protocol; `u128` intermediates; `checked_div` / `div_ceil`; no floats |

## Guidelines

**DO**

- DO let the **type** do the work: `Account`, `Signer`, `Program`, `InterfaceAccount`, `Sysvar`. Most checks are free.
- DO pair `Signer` with `has_one` (or `constraint`) so the *right* party signed.
- DO derive PDAs with `seeds = [...]` + `bump` (canonical), store `ctx.bumps.<field>`, and reuse it with `bump = stored`.
- DO use `#[account(init, …)]` for one-time creation; use checked math + keep `overflow-checks = true`.
- DO close accounts with `close = <dest>`; `reload()?` an account after a CPI mutates it.
- DO validate every `ctx.remaining_accounts` entry (owner + discriminator + address/PDA) and justify every `/// CHECK:`.

**DON'T**

- DON'T deserialize `UncheckedAccount` / `AccountInfo` without explicit `owner` / `address` / `constraint` checks.
- DON'T assume duplicates are ignored — 1.0+ rejects duplicate mutable `Account<T>` (2040); use `#[account(mut, dup)]` to allow one intentionally, and `constraint = a.key() != b.key()` for non-serializing types.
- DON'T hand-roll account closing by zeroing lamports (data survives → revival); use `close`.
- DON'T trust a user-supplied bump, a global authority PDA, or a sysvar passed as an account.
- DON'T use `init_if_needed` without a re-initialization guard.
- DON'T round in the user's favor or do value-bearing math in narrow types or floats.

## References

- Sealevel attacks (canonical repo): https://github.com/coral-xyz/sealevel-attacks
- Solana Foundation Program Security course: https://github.com/solana-foundation/developer-content/tree/main/content/courses/program-security
- Anchor account constraints reference: https://www.anchor-lang.com/docs/references/account-constraints
- Anchor account types reference: https://www.anchor-lang.com/docs/references/account-types
- Anchor PDA basics: https://www.anchor-lang.com/docs/basics/pda
- Zellic — "The Vulnerabilities You'll Write With Anchor": https://www.zellic.io/blog/the-vulnerabilities-youll-write-with-anchor/
- RareSkills — `init_if_needed` & the reinitialization attack: https://rareskills.io/post/init-if-needed-anchor
