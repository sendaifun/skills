//! Minimal, idiomatic Anchor 1.x counter program.
//!
//! Demonstrates the everyday building blocks: a PDA account created with `init`,
//! `#[derive(InitSpace)]` + `space = 8 + T::INIT_SPACE` sizing, a stored canonical
//! bump, `has_one` authority checking, checked arithmetic, an emitted event, and a
//! single `#[error_code]` enum.
//!
//! Verified against anchor-lang 1.1.2 (stable `v1` API, MSRV rustc 1.89.0).
//!
//! Cargo.toml for this program:
//!   [dependencies]
//!   anchor-lang = "1.1.2"
//!   [features]
//!   idl-build = ["anchor-lang/idl-build"]
//!   [lib]
//!   crate-type = ["cdylib", "lib"]

use anchor_lang::prelude::*;

// The program's on-chain address. This is the canonical Anchor placeholder; after
// `anchor build`, run `anchor keys sync` to overwrite it with your deploy keypair.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// PDA seed prefix. `#[constant]` exports it into the IDL so clients derive the same PDA.
#[constant]
pub const SEED_COUNTER: &[u8] = b"counter";

#[program]
pub mod counter {
    use super::*;

    /// Create a counter PDA owned by `authority`, starting at zero.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Read the values we need before taking a mutable borrow of `counter`
        // (avoids overlapping borrows of `ctx.accounts`).
        let authority = ctx.accounts.authority.key();
        let bump = ctx.bumps.counter; // canonical bump Anchor resolved for the PDA

        let counter = &mut ctx.accounts.counter;
        counter.authority = authority;
        counter.count = 0;
        counter.bump = bump; // store the bump so later instructions skip re-derivation
        Ok(())
    }

    /// Increment the counter by one and emit a `CountChanged` event.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;

        // Checked math: abort with a clean program error instead of wrapping or
        // panicking. (The release profile also sets `overflow-checks = true`.)
        counter.count = counter
            .count
            .checked_add(1)
            .ok_or(CounterError::Overflow)?;

        // Emit via the `sol_log_data` syscall ("Program Data:" base64). Indexers and
        // tests parse this from the transaction logs.
        emit!(CountChanged {
            counter: counter.key(),
            authority: counter.authority,
            count: counter.count,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    // Funds rent and becomes the counter's authority. `mut` because lamports leave it.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,                                            // create via System-Program CPI + write discriminator
        payer = authority,                               // who pays the rent-exempt minimum
        space = 8 + Counter::INIT_SPACE,                 // 8-byte discriminator + InitSpace-derived data size
        seeds = [SEED_COUNTER, authority.key().as_ref()],// domain-specific seeds: one counter per authority
        bump                                             // canonical bump (find_program_address)
    )]
    pub counter: Account<'info, Counter>,

    // `init` requires a field literally named `system_program`.
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_COUNTER, authority.key().as_ref()],
        bump = counter.bump,                  // reuse the stored canonical bump (cheaper than re-searching)
        has_one = authority @ CounterError::Unauthorized, // counter.authority == authority.key()
    )]
    pub counter: Account<'info, Counter>,
}

#[account]
#[derive(InitSpace)] // generates Counter::INIT_SPACE = 32 + 8 + 1 (excludes the discriminator)
pub struct Counter {
    pub authority: Pubkey, // 32 — who may increment this counter
    pub count: u64,        // 8  — current value
    pub bump: u8,          // 1  — stored canonical PDA bump
}

#[event]
pub struct CountChanged {
    pub counter: Pubkey,
    pub authority: Pubkey,
    pub count: u64,
}

// Anchor 1.x allows exactly one `#[error_code]` enum per program. Custom codes start at 6000.
#[error_code]
pub enum CounterError {
    #[msg("Only the counter authority may modify it")]
    Unauthorized, // 6000
    #[msg("Counter overflowed u64::MAX")]
    Overflow, // 6001
}
