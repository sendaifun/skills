//! Anchor program starter template (Anchor 1.1.2, stable `v1` API, MSRV rustc 1.89.0).
//!
//! Copy this into `programs/<your_program>/src/lib.rs` and replace every `TODO`.
//! It demonstrates the everyday building blocks of an Anchor instruction:
//!   - `declare_id!` with the canonical placeholder (run `anchor keys sync` after the first build)
//!   - a `#[program]` module with one instruction (`initialize`)
//!   - a `#[derive(Accounts)]` struct that `init`s a PDA owned by an authority
//!   - a `#[account]` state struct sized with `#[derive(InitSpace)]`
//!   - a single `#[error_code]` enum (Anchor 1.x allows exactly one per program)
//!
//! Pair this with `templates/Cargo-program.toml` (program crate manifest),
//! `templates/Anchor.toml` (workspace config), and `templates/rust-toolchain.toml`.
//!
//! DO NOT add a separate `solana-program` dependency — use `anchor_lang::solana_program::*`.

use anchor_lang::prelude::*;

// TODO: Replace with your program's on-chain address. This is the canonical Anchor
// placeholder; after `anchor build` run `anchor keys sync` to write the address from
// `target/deploy/<name>-keypair.json` into this macro and `Anchor.toml`.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// PDA seed prefix. `#[constant]` exports it into the IDL so clients derive the same PDA.
// TODO: Rename to a value specific to your program's domain.
#[constant]
pub const SEED_STATE: &[u8] = b"state";

// TODO: Rename the module to your program name (snake_case). This name also becomes the
// PascalCase workspace key in tests: `anchor.workspace.MyProgram`.
#[program]
pub mod my_program {
    use super::*;

    /// Create the program's state PDA, owned by `authority`.
    ///
    /// TODO: Add real instruction parameters after the `Context` (they are
    /// borsh-deserialized from instruction data), e.g.
    /// `pub fn initialize(ctx: Context<Initialize>, threshold: u64) -> Result<()>`.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Read values we need before taking a mutable borrow of `state`
        // (avoids overlapping borrows of `ctx.accounts`).
        let authority = ctx.accounts.authority.key();
        let bump = ctx.bumps.state; // canonical bump Anchor resolved for the PDA

        let state = &mut ctx.accounts.state;
        state.authority = authority;
        state.value = 0;
        state.bump = bump; // store the bump so later instructions skip the 255-iteration re-derivation

        msg!("Initialized state for authority {}", authority);
        Ok(())
    }

    // TODO: Add more instructions. Pattern: define a `#[derive(Accounts)]` struct below,
    // then a handler here. Example skeleton:
    //
    // pub fn update(ctx: Context<Update>, value: u64) -> Result<()> {
    //     require!(value <= MAX_VALUE, MyError::ValueTooLarge);
    //     ctx.accounts.state.value = value;
    //     Ok(())
    // }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Funds rent and becomes the state's authority. `mut` because lamports leave it.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,                                              // create via System-Program CPI + write discriminator
        payer = authority,                                 // who pays the rent-exempt minimum
        space = 8 + State::INIT_SPACE,                     // 8-byte discriminator + InitSpace-derived data size
        seeds = [SEED_STATE, authority.key().as_ref()],    // domain-specific seeds: one state PDA per authority
        bump                                               // canonical bump (find_program_address)
    )]
    pub state: Account<'info, State>,

    // `init` requires a field literally named `system_program`.
    pub system_program: Program<'info, System>,
}

// TODO: Add account-validation structs for your other instructions. For an instruction
// that mutates the existing PDA, validate it like this:
//
// #[derive(Accounts)]
// pub struct Update<'info> {
//     pub authority: Signer<'info>,
//     #[account(
//         mut,
//         seeds = [SEED_STATE, authority.key().as_ref()],
//         bump = state.bump,                              // reuse the stored canonical bump
//         has_one = authority @ MyError::Unauthorized,    // state.authority == authority.key()
//     )]
//     pub state: Account<'info, State>,
// }

#[account]
#[derive(InitSpace)] // generates State::INIT_SPACE (sum of field sizes, EXCLUDING the discriminator)
pub struct State {
    pub authority: Pubkey, // 32 — who controls this account
    pub value: u64,        // 8  — TODO: replace with your state fields
    pub bump: u8,          // 1  — stored canonical PDA bump
    // TODO: For dynamically sized fields, annotate the max length so InitSpace can size them:
    //   #[max_len(50)]
    //   pub name: String,        // 4 + 50
    //   #[max_len(10)]
    //   pub items: Vec<u64>,     // 4 + 10*8
}

// Anchor 1.x allows exactly ONE `#[error_code]` enum per program. Custom codes start at 6000
// (0–5999 are reserved for framework/constraint errors). Raise with `require!`/`err!`/`error!`.
#[error_code]
pub enum MyError {
    #[msg("Only the state authority may perform this action")]
    Unauthorized, // 6000
    #[msg("Value exceeds the allowed maximum")]
    ValueTooLarge, // 6001
    // TODO: Add your program's error variants here.
}
