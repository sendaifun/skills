# Worked Example: Audit of a Solana Escrow Program

> This example shows the `program-security-audit` skill applied to a real-world style escrow program.
> The source code below is intentionally written with common vulnerabilities to demonstrate detection.

---

## Program Under Review

**Name**: `simple-escrow`
**Type**: Anchor program
**Purpose**: Allows a maker to deposit SPL tokens into escrow, and a taker to fulfill the trade by sending a different token in return.

### Source Code (`programs/simple-escrow/src/lib.rs`)

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Esc1111111111111111111111111111111111111111");

#[program]
pub mod simple_escrow {
    use super::*;

    pub fn make(
        ctx: Context<Make>,
        seed: u64,
        receive_amount: u64,
        deposit_amount: u64,
    ) -> Result<()> {
        // Store escrow state
        ctx.accounts.escrow.maker = ctx.accounts.maker.key();
        ctx.accounts.escrow.mint_a = ctx.accounts.maker_ata_a.mint;
        ctx.accounts.escrow.mint_b = ctx.accounts.maker_ata_b.mint;
        ctx.accounts.escrow.receive_amount = receive_amount;
        ctx.accounts.escrow.seed = seed;

        // Transfer tokens from maker to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.maker_ata_a.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, deposit_amount)?;

        Ok(())
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;

        // Transfer token B from taker to maker
        let transfer_b_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.taker_ata_b.to_account_info(),
                to: ctx.accounts.maker_ata_b.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            },
        );
        token::transfer(transfer_b_ctx, escrow.receive_amount)?;

        // Transfer token A from vault to taker
        let seeds = &[
            b"vault",
            ctx.accounts.escrow.key().as_ref(),
        ];
        let signer_seeds = &[&seeds[..]]; // BUG: missing bump seed

        let transfer_a_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.taker_ata_a.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_a_ctx, ctx.accounts.vault.amount)?;

        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        // Return tokens from vault back to maker
        let vault_amount = ctx.accounts.vault.amount;

        let seeds = &[b"vault", ctx.accounts.escrow.key().as_ref()];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.maker_ata_a.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, vault_amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Make<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(mut)]
    pub maker_ata_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub maker_ata_b: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = maker,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = maker,
        token::mint = maker_ata_a.mint,
        token::authority = vault_authority,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: This is the vault PDA authority
    pub vault_authority: AccountInfo<'info>,  // BUG: unchecked, not validated

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Take<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    #[account(mut)]
    pub taker_ata_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub taker_ata_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        has_one = maker,
    )]  // BUG: no seeds/bump constraint — any account with maker field passes
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub maker: SystemAccount<'info>,

    #[account(mut)]
    pub maker_ata_b: Account<'info, TokenAccount>,  // BUG: no constraint linking to escrow.mint_b

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,  // BUG: not verified to be the correct vault PDA

    /// CHECK: vault PDA authority
    pub vault_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        has_one = maker,
        close = maker,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub maker_ata_a: Account<'info, TokenAccount>,  // BUG: no constraint, wrong ATA accepted

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: vault PDA authority
    pub vault_authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub maker: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub receive_amount: u64,
    pub seed: u64,
    pub bump: u8,   // BUG: bump stored but never saved in make() instruction
}
```

---

## Audit Report

**Program**: simple-escrow
**Commit**: `main` (illustrative)
**Auditor**: `program-security-audit` skill
**Date**: 2026-06-24

---

### Executive Summary

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 3 |
| Medium | 2 |
| Low | 1 |
| Informational | 1 |
| **Total** | **9** |

**Verdict**: 🔴 **DO NOT DEPLOY** — Two critical vulnerabilities allow complete theft of vault funds.

---

### Threat Model

**Assets at Risk**
- Token A deposited by maker into vault (direct loss)
- Token B sent by taker during fulfillment (direct loss)

**Entry Points**

| Instruction | Caller | Risk |
|---|---|---|
| `make` | Any user | Deposits tokens, creates escrow state |
| `take` | Any user | Fulfills escrow, transfers both tokens |
| `refund` | Maker only | Returns deposited tokens to maker |

**Threat Actors**
- Malicious taker: can steal vault tokens without sending token B
- Attacker with no prior interaction: can construct fake accounts to redirect funds

---

### Findings

---

#### [CRITICAL-01] Vault Account Not Verified in `take` — Attacker Drains Vault to Arbitrary Address

**Location**: `Take` struct, `vault` field (line ~74)

**Description**: The `vault` account in the `take` instruction has no seeds/bump constraint and no check that it is the vault PDA derived from this specific escrow. An attacker can:
1. Create a legitimate-looking escrow as a maker
2. Call `take` with a **different vault** account (their own token account)
3. The program transfers tokens from the wrong vault, stealing funds deposited by other makers

**Vulnerable Code**:
```rust
#[account(mut)]
pub vault: Account<'info, TokenAccount>,  // no seeds constraint
```

**Impact**: Complete theft of any maker's deposited tokens.

**Fix**:
```rust
#[account(
    mut,
    seeds = [b"vault", escrow.key().as_ref()],
    bump,
)]
pub vault: Account<'info, TokenAccount>,
```

---

#### [CRITICAL-02] `maker_ata_b` in `take` Not Constrained to `escrow.mint_b`

**Location**: `Take` struct, `maker_ata_b` field (line ~79)

**Description**: The instruction that sends token B to the maker accepts any `maker_ata_b` account without verifying it holds `escrow.mint_b`. An attacker acting as taker can:
1. Pass a worthless token ATA as `maker_ata_b`
2. Send zero-value tokens to the maker
3. Receive the escrowed token A from the vault for free

**Vulnerable Code**:
```rust
#[account(mut)]
pub maker_ata_b: Account<'info, TokenAccount>,  // accepts any token account
```

**Impact**: Taker receives escrowed tokens without paying. Maker receives worthless tokens.

**Fix**:
```rust
#[account(
    mut,
    associated_token::mint = escrow.mint_b,
    associated_token::authority = maker,
)]
pub maker_ata_b: Account<'info, TokenAccount>,
```

---

#### [HIGH-01] Bump Seed Missing in `invoke_signed` — CPI Will Always Fail

**Location**: `take` instruction, line ~47

**Description**: The `signer_seeds` array does not include the bump byte. `invoke_signed` with seeds that don't match the canonical PDA derivation will always fail with `InvalidSeeds`. This means the `take` instruction is permanently broken.

**Vulnerable Code**:
```rust
let seeds = &[
    b"vault",
    ctx.accounts.escrow.key().as_ref(),
];
// Missing: &[bump]
let signer_seeds = &[&seeds[..]];
```

**Impact**: No taker can ever fulfill an escrow — all escrowed funds are permanently locked.

**Fix**:
```rust
let bump = ctx.bumps.vault; // canonical bump from Anchor
let seeds = &[
    b"vault",
    ctx.accounts.escrow.key().as_ref(),
    &[bump],
];
let signer_seeds = &[&seeds[..]];
```

---

#### [HIGH-02] `vault_authority` is Unchecked `AccountInfo` — Can Be Spoofed

**Location**: `Make`, `Take`, `Refund` structs, `vault_authority` field

**Description**: `vault_authority` is declared as `/// CHECK:` `AccountInfo` with no validation. Any pubkey can be passed. The vault's authority is set at init time from this account, meaning whoever controls the `vault_authority` account controls the vault — not necessarily the program.

**Fix**: The vault authority should be a PDA derived by the program, validated with seeds:
```rust
/// CHECK: PDA validated by seeds
#[account(
    seeds = [b"authority", escrow.key().as_ref()],
    bump,
)]
pub vault_authority: AccountInfo<'info>,
```

---

#### [HIGH-03] Escrow Bump Never Saved

**Location**: `make` instruction, `Escrow` struct

**Description**: The `Escrow` struct has a `bump: u8` field, but the `make` instruction never saves `ctx.bumps.escrow` to it. This means future instructions cannot re-derive the escrow PDA using a stored canonical bump, forcing them to call `find_program_address` on every use or use a non-canonical bump.

**Fix**:
```rust
pub fn make(...) -> Result<()> {
    ctx.accounts.escrow.bump = ctx.bumps.escrow; // save canonical bump
    // ...
}
```

---

#### [MEDIUM-01] `escrow` in `take` Has No Seeds Constraint

**Location**: `Take` struct, `escrow` field (line ~68)

**Description**: The escrow account in `take` is only validated via `has_one = maker`. An attacker could craft a fake `Escrow` account with a legitimate maker pubkey and pass it as the escrow, causing the program to use attacker-controlled `receive_amount` and `mint_b` values.

**Fix**:
```rust
#[account(
    mut,
    has_one = maker,
    seeds = [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
    bump = escrow.bump,
    close = maker,
)]
pub escrow: Account<'info, Escrow>,
```

---

#### [MEDIUM-02] `maker_ata_a` in `refund` Not Verified

**Location**: `Refund` struct, `maker_ata_a` field

**Description**: The refund destination is not verified to be the maker's ATA for `mint_a`. The maker could redirect the refund to a different account (e.g., accidentally), or an attacker who controls the transaction could redirect funds.

**Fix**:
```rust
#[account(
    mut,
    associated_token::mint = escrow.mint_a,
    associated_token::authority = maker,
)]
pub maker_ata_a: Account<'info, TokenAccount>,
```

---

#### [LOW-01] No Events Emitted

**Description**: No `emit!()` calls on any instruction. Off-chain indexers and monitoring tools cannot track escrow creation, fulfillment, or refunds without parsing raw transaction logs.

**Fix**: Add events for each state change:
```rust
#[event]
pub struct EscrowCreated { pub maker: Pubkey, pub seed: u64, pub deposit: u64 }

#[event]
pub struct EscrowFulfilled { pub taker: Pubkey, pub escrow: Pubkey }

#[event]
pub struct EscrowRefunded { pub maker: Pubkey, pub escrow: Pubkey }
```

---

#### [INFO-01] `Rent` Sysvar Passed Unnecessarily

**Description**: The `Make` struct includes `pub rent: Sysvar<'info, Rent>`, but Anchor handles rent exemption automatically for `init` accounts. This adds unnecessary transaction size.

**Fix**: Remove `pub rent: Sysvar<'info, Rent>` from the `Make` struct.

---

### Remediation Priority

| # | Finding | Priority |
|---|---|---|
| 1 | CRITICAL-01: Vault not verified in `take` | Fix immediately |
| 2 | CRITICAL-02: `maker_ata_b` unconstrained | Fix immediately |
| 3 | HIGH-01: Missing bump in `invoke_signed` | Fix before any testing |
| 4 | HIGH-02: Unchecked vault authority | Fix before testnet |
| 5 | HIGH-03: Bump never saved | Fix before testnet |
| 6 | MEDIUM-01: Escrow no seeds constraint | Fix before testnet |
| 7 | MEDIUM-02: Refund destination unverified | Fix before mainnet |
| 8 | LOW-01: No events | Fix before mainnet |
| 9 | INFO-01: Unnecessary sysvar | Optional |

---

*Generated by `program-security-audit` skill — [Solana Skills Marketplace](https://github.com/sendaifun/skills)*
