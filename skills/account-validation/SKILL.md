---
name: account-validation
description: Secure account validation and constraint patterns for Solana programs. Covers the three mandatory checks every account needs (owner, signer, type/discriminator), Anchor account types and the core #[account(...)] constraint set (has_one, owner, address, constraint, seeds/bump, token::*, init, close), and equivalent manual validation for native/Pinocchio programs. Maps each pattern to the real exploit class it prevents — missing-owner account substitution, missing-signer authority bypass, account confusion, unvalidated PDAs, bump-seed canonicalization, reinitialization, and revival attacks. Use this when writing, reviewing, or auditing Solana program account checks.
---

# Solana Account Validation & Constraint Patterns

A guide to validating accounts safely in Solana programs. **Missing or incorrect account validation is the single largest source of real exploits on Solana** — the program receives a list of accounts chosen entirely by the caller, and *nothing is trusted until the program checks it*. This skill covers the mandatory checks, how Anchor enforces them declaratively, how to do the same by hand in native/Pinocchio programs, and an audit checklist that maps each pattern to the vulnerability it closes.

## The core threat model

A Solana instruction handler receives `accounts: &[AccountInfo]` — an **attacker-controlled** array. The runtime guarantees almost nothing about them. It does **not** check that an account is the "right" one, that it belongs to your program, that the expected signer actually signed, or that a PDA was derived correctly. Every one of those is the *program's* job.

There are exactly **three checks** that nearly every account needs. Most Solana exploits are one of these three being absent:

| Check | Question it answers | Exploit if missing |
|-------|--------------------|--------------------|
| **Owner check** | Is this account owned by the program I expect? | **Account substitution / type confusion** — attacker passes a fake account they control with crafted bytes. |
| **Signer check** | Did the required authority actually sign? | **Authority bypass** — anyone invokes a privileged action. |
| **Type / discriminator check** | Is this the *kind* of account I think it is? | **Account confusion ("type cosplay")** — a `Vault` is read as a `Config`, etc. |

Beyond the three, relational checks (`has_one`, address match, PDA derivation, custom constraints) bind accounts together so an attacker can't mix a valid-but-unrelated account into the call.

> **Key rule:** the caller picks the accounts; the program decides which ones are *acceptable*. If you didn't validate it, assume the attacker controls it.

## The safe path: Anchor account types

Anchor closes the three core checks **automatically through the account type you choose**. Picking the right type is the first and most important validation decision.

| Type | Owner check | Discriminator check | Signer check | Notes |
|------|:-----------:|:-------------------:|:------------:|-------|
| `Account<'info, T>` | ✅ owned by declaring program | ✅ `T::DISCRIMINATOR` (8 bytes by default) | — | The default for your own program's state. |
| `Signer<'info>` | — | — | ✅ must have signed | Use whenever you only need "did X sign". |
| `Program<'info, T>` | ✅ executable + address match | — | — | Validates a program account (e.g. `Program<'info, System>`). |
| `InterfaceAccount<'info, T>` | ✅ (Token **or** Token-2022) | ✅ layout/length | — | Use for `Mint`/`TokenAccount` so both token programs work. SPL token accounts have no Anchor discriminator — validated by owning program + data layout. |
| `SystemAccount<'info>` | ✅ owned by System Program | — | — | A plain wallet/PDA owned by System. |
| `UncheckedAccount<'info>` / `AccountInfo<'info>` | ❌ **none** | ❌ **none** | ❌ **none** | **No checks at all.** Requires a `/// CHECK:` comment justifying why it's safe. Every audit finding lives here. |

```rust
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    // owner + discriminator checked automatically; has_one binds authority
    #[account(mut, has_one = authority)]
    pub config: Account<'info, Config>,

    // signer checked automatically
    pub authority: Signer<'info>,
}
```

> **Audit hot spot:** every `UncheckedAccount`, `AccountInfo`, and `/// CHECK:` is a place where validation was *turned off*. Treat each one as guilty until the comment proves the bytes are never trusted (e.g. it's only used as a CPI target with its own internal checks, or only its `key()` is read).

## The core constraint set

Constraints in `#[account(...)]` add relational and value checks on top of the type. Most of these accept an optional `@ CustomError` to return a specific error (verify per constraint). These are the validation constraints you'll reach for most, verified against the Anchor account-constraints docs — see the docs for the full list, including `realloc`, `zero`, `executable`, `seeds::program`, and the `mint::*` set:

```rust
#[account(mut)]                          // marks account mutable; required to write or change lamports
#[account(signer)]                       // must have signed (prefer the Signer type if it's the only check)
#[account(owner = <expr>)]               // account.owner == <expr> (e.g. owner = token_program.key())
#[account(address = <expr>)]             // account.key() == <expr> (pin to an exact address)
#[account(has_one = authority)]          // account.authority == authority.key() (field-to-account binding)
#[account(constraint = <bool expr>)]     // arbitrary custom predicate must be true
#[account(seeds = [...], bump)]          // PDA derived from program + seeds, canonical bump
#[account(seeds = [...], bump = vault.bump)] // PDA pinned to a bump stored in an account field
#[account(close = recipient)]            // close: send lamports to recipient, zero data, reassign to System
```

Token / ATA constraints (use with `Account<TokenAccount>` for the classic Token program, or `InterfaceAccount` for Token **or** Token-2022):

```rust
#[account(token::mint = mint, token::authority = owner)]
#[account(
    init_if_needed,
    payer = payer,
    associated_token::mint = mint,
    associated_token::authority = owner,
    associated_token::token_program = token_program,
)]
```

### `has_one` — the binding most people forget

`Account<'info, T>` proves `config` is a real `Config` owned by your program — but **not that it's the *caller's* config**. `has_one = authority` adds the link: it checks the `authority` *field stored in* `config` equals the `authority` account in the struct. Combined with `authority: Signer`, that proves "the owner of this specific config signed."

```rust
// VULNERABLE — any valid Config + any signer passes. Attacker passes the
// victim's config and their own signature, then mutates someone else's data.
#[account(mut)]
pub config: Account<'info, Config>,
pub authority: Signer<'info>,

// FIXED — the signer must be the authority recorded inside this config.
#[account(mut, has_one = authority @ MyError::WrongAuthority)]
pub config: Account<'info, Config>,
pub authority: Signer<'info>,
```

### PDAs: derivation and the bump-canonicalization trap

`seeds` + `bump` re-derives the PDA and rejects any account whose key doesn't match. Using bare `bump` makes Anchor use the **canonical** bump (the one `find_program_address` returns). Letting the caller supply the bump (`bump = user_supplied`) without storing and pinning a single canonical value enables the **bump-seed canonicalization attack**: multiple valid bumps derive multiple distinct PDAs for the "same" logical seeds, so an attacker creates a shadow account.

```rust
// FIXED — canonical bump on derivation; persist it and reuse the stored value later.
#[account(
    init, payer = payer, space = 8 + Vault::INIT_SPACE,
    seeds = [b"vault", owner.key().as_ref()], bump
)]
pub vault: Account<'info, Vault>,

// Later instruction: pin to the stored canonical bump, never a passed-in one.
#[account(seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
pub vault: Account<'info, Vault>,
```

### `init_if_needed` and the reinitialization attack

`init_if_needed` (behind the `init-if-needed` feature) runs init only if the account doesn't exist yet. Anchor already prevents the raw *reinitialization* case: if the account exists, it verifies the discriminator matches the expected type and skips init rather than re-running it. The danger that remains is **logical replay** — your own post-init business logic running twice (e.g. re-granting a bonus, resetting a counter). So: Anchor guards discriminator replay; **you must still ensure your instruction logic isn't replayable against a live account** — and prefer plain `init` unless you genuinely need create-or-use.

### `close` and the revival attack

Closing an account safely means more than refunding its rent. If you only transfer lamports out, the account data survives in the same slot and can be **revived** (re-funded) by an attacker before garbage collection, replaying stale state. Anchor's `close = recipient` does it correctly: it transfers all lamports to the recipient, **zeroes the account's data, and reassigns the account to the System Program** so it can no longer be deserialized as its type. (Historically Anchor wrote a `CLOSED_ACCOUNT_DISCRIMINATOR` sentinel; current versions reset the data and reassign ownership.) Never hand-roll a close that only moves lamports.

## The manual path: native / Pinocchio programs

Without Anchor you enforce the same checks explicitly. This is exactly what Anchor's macros expand to, and what you reconstruct mentally when auditing a native program.

```rust
use solana_program::{
    account_info::{AccountInfo, next_account_info}, entrypoint::ProgramResult,
    program_error::ProgramError, pubkey::Pubkey, msg,
};

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], _data: &[u8]) -> ProgramResult {
    let acc_iter = &mut accounts.iter();
    let config = next_account_info(acc_iter)?;
    let authority = next_account_info(acc_iter)?;

    // 1. OWNER CHECK — is this account ours?
    if config.owner != program_id {
        msg!("config not owned by this program");
        return Err(ProgramError::IllegalOwner);
    }

    // 2. SIGNER CHECK — did the authority actually sign?
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // 3. TYPE CHECK — Borsh's try_from_slice does LAYOUT/length deserialization
    //    ONLY. It does NOT verify a discriminator: native programs have none
    //    unless you add one. Without a manual type tag, an attacker can pass a
    //    different account whose bytes happen to fit (type confusion). Anchor's
    //    Account<T> adds the 8-byte discriminator for you; native code must not.
    let data = ConfigState::try_from_slice(&config.data.borrow())?; // layout check only
    if data.tag != ConfigState::TAG {                // manual discriminator/type tag
        return Err(ProgramError::InvalidAccountData);
    }
    if data.authority != *authority.key {            // has_one equivalent
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. PDA CHECK — re-derive with the CANONICAL bump and compare.
    let (expected, _bump) =
        Pubkey::find_program_address(&[b"config", authority.key.as_ref()], program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    Ok(())
}
```

> **For SPL token accounts, keep two different "owners" straight:** the **`AccountInfo.owner`** (the on-chain owner) is always the **Token program** — checking `account_info.owner == user` is a classic mistake, it's never true. The user/authority is a separate **`owner` field stored *inside* the deserialized `TokenAccount` data**. So: first validate `account_info.owner == spl_token::ID` (or Token-2022), then deserialize and check the in-data `owner` field equals the expected authority, and confirm the in-data `mint` is the expected mint.

## Audit checklist

Run this against every instruction. (This is the account-validation core of the broader Solana audit pipeline.)

- [ ] **Owner check** on every account whose *data* is read or trusted (skip only if just the `key()` is used).
- [ ] **Signer check** on every authority, payer, or anyone authorizing a state change.
- [ ] **Type/discriminator check** — every state account deserialized through a checked type (`Account<T>`), not raw `AccountInfo`.
- [ ] **`has_one` / relational binding** — authorities and linked accounts tied back to the state account, not accepted standalone.
- [ ] **PDA derivation** re-checked with **canonical** bump; stored bump pinned on later use; no caller-supplied bump trusted.
- [ ] **Every `UncheckedAccount` / `AccountInfo` / `/// CHECK:`** justified — its data is never trusted, or it's only a CPI target with its own validation.
- [ ] **`mut`** present only where mutation is intended, and on the right accounts (a missing `mut` fails; a stray one widens write surface).
- [ ] **`init` vs `init_if_needed`** — reinitialization can't reset a live account.
- [ ] **Close** zeroes data + reassigns to System Program (use Anchor `close`); no lamport-only close (revival).
- [ ] **Token accounts** — validated by program owner (`spl_token`/Token-2022) *and* the in-data `mint`/`owner` fields, never `account.owner == user`.
- [ ] **CPI targets** — the invoked program's address is pinned (`address =` or a `Program<T>` type), so an attacker can't substitute a malicious program.
- [ ] **Duplicate-account / aliasing** — where two accounts must differ (e.g. `from != to`), it's explicitly checked.

## Common vulnerability patterns (quick reference)

| Pattern | Root cause | Fix |
|---------|-----------|-----|
| Account substitution | No owner check; raw `AccountInfo` | `Account<T>` / `owner =` |
| Authority bypass | No signer check | `Signer` / `#[account(signer)]` |
| Account confusion / type cosplay | No discriminator check | `Account<T>` (never raw deserialize untyped) |
| Unrelated-account injection | No `has_one` binding | `has_one = authority` |
| Shadow PDA | Non-canonical / caller bump | bare `bump` on init, `bump = stored` after |
| Reinitialization | `init_if_needed` w/ replayable logic | prefer `init`; guard live accounts |
| Revival | Lamport-only close | Anchor `close =` |
| Arbitrary CPI | Unpinned program account | `address =` / `Program<T>` |
| Token-owner confusion | `token_account.owner == user` | check program owner + in-data `owner`/`mint` |

## References

- Anchor account constraints: https://www.anchor-lang.com/docs/references/account-constraints
- Anchor PDAs: https://www.anchor-lang.com/docs/basics/pda
- Anchor account types: https://www.anchor-lang.com/docs/references/account-types
- Solana program security — Sealevel attacks corpus: https://github.com/coral-xyz/sealevel-attacks (worked vulnerable/secure pairs for each check above)
