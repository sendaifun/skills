//! Canonical PDA escrow (SPL Token + Token-2022) in Anchor 1.x.
//!
//! Flow:
//!   make(seed, deposit, receive) — the maker locks `deposit` of `mint_a` in a vault
//!                                  (an ATA owned by an escrow PDA) and records the
//!                                  `receive` amount of `mint_b` they want in return.
//!   take()                       — a taker pays the maker `receive` of `mint_b`, the
//!                                  escrow PDA releases the vaulted `mint_a` to the taker,
//!                                  and the vault + escrow state are closed to the maker.
//!   refund()                     — the maker reclaims the vaulted `mint_a` and closes
//!                                  the vault + escrow state.
//!
//! Key techniques:
//!   * `anchor_spl::token_interface` + `InterfaceAccount`/`Interface<TokenInterface>` so
//!     ONE code path serves both SPL Token (`Tokenkeg…`) and Token-2022 (`Tokenz…`). The
//!     runtime token program is threaded through every `*::token_program` constraint and
//!     used as the CPI program id.
//!   * `transfer_checked` (never `transfer`) — required for Token-2022 correctness.
//!   * PDA-signed CPI via `CpiContext::new_with_signer` to move funds OUT of the vault.
//!   * `close = maker` to reclaim the escrow-state rent safely.
//!
//! Verified against anchor-lang / anchor-spl 1.1.2 (stable `v1` API, MSRV rustc 1.89.0).
//!
//! Cargo.toml for this program:
//!   [dependencies]
//!   anchor-lang = { version = "1.1.2", features = ["init-if-needed"] }
//!   anchor-spl  = "1.1.2"
//!   [features]
//!   idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
//!   [lib]
//!   crate-type = ["cdylib", "lib"]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
        TransferChecked,
    },
};

// Canonical Anchor placeholder ID. Run `anchor keys sync` to replace it with your deploy keypair.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// PDA seed prefix, shared by the `seeds = [...]` constraints and the manual signer seeds
// so the two derivations can never drift apart.
#[constant]
pub const ESCROW_SEED: &[u8] = b"escrow";

#[program]
pub mod escrow {
    use super::*;

    /// Open an escrow: record the terms and move `deposit` of `mint_a` into the vault.
    pub fn make(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        require!(deposit > 0 && receive > 0, EscrowError::InvalidAmount);

        // Persist the escrow terms and store the canonical bump for cheap re-derivation later.
        ctx.accounts.escrow.set_inner(Escrow {
            seed,
            maker: ctx.accounts.maker.key(),
            mint_a: ctx.accounts.mint_a.key(),
            mint_b: ctx.accounts.mint_b.key(),
            receive,
            bump: ctx.bumps.escrow,
        });

        // maker_ata_a -> vault. The maker signs as the source-account authority.
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.maker_ata_a.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.maker.to_account_info(),
        };
        transfer_checked(
            CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts),
            deposit,
            ctx.accounts.mint_a.decimals, // transfer_checked re-validates decimals on-chain
        )?;
        Ok(())
    }

    /// Complete the swap: taker pays `mint_b`, escrow releases `mint_a`, accounts close.
    pub fn take(ctx: Context<Take>) -> Result<()> {
        // 1. Taker -> maker: pay the agreed `receive` amount of mint_b. Taker signs.
        let pay = TransferChecked {
            from: ctx.accounts.taker_ata_b.to_account_info(),
            mint: ctx.accounts.mint_b.to_account_info(),
            to: ctx.accounts.maker_ata_b.to_account_info(),
            authority: ctx.accounts.taker.to_account_info(),
        };
        transfer_checked(
            CpiContext::new(ctx.accounts.token_program.key(), pay),
            ctx.accounts.escrow.receive,
            ctx.accounts.mint_b.decimals,
        )?;

        // 2. Escrow PDA -> taker: release the full vault balance of mint_a. The PDA is the
        //    vault authority, so the program signs on its behalf with `new_with_signer`.
        //    Bind every seed component to a local so the `&[&[&[u8]]]` references stay valid.
        let maker_key = ctx.accounts.maker.key();
        let seed_bytes = ctx.accounts.escrow.seed.to_le_bytes();
        let bump_bytes = [ctx.accounts.escrow.bump];
        let seeds: &[&[u8]] = &[
            ESCROW_SEED,
            maker_key.as_ref(),
            seed_bytes.as_ref(),
            bump_bytes.as_ref(),
        ];
        let signer: &[&[&[u8]]] = &[seeds];

        let vault_amount = ctx.accounts.vault.amount; // full deposited amount (read before the CPI)
        let release = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            to: ctx.accounts.taker_ata_a.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                release,
                signer,
            ),
            vault_amount,
            ctx.accounts.mint_a.decimals,
        )?;

        // 3. Close the now-empty vault, returning its rent to the maker. The escrow STATE
        //    account is closed by the `close = maker` constraint on exit.
        let close = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            close,
            signer,
        ))?;
        Ok(())
    }

    /// Cancel an open escrow: return the vaulted `mint_a` to the maker and close accounts.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        // Bind the maker key to a local first: `.key()` returns an owned Pubkey, so passing
        // `&...key()` straight into the helper would drop the temporary at the end of this
        // statement while `signer_seeds` still borrows it (E0716). take() does the same.
        let maker_key = ctx.accounts.maker.key();
        let signer_seeds = escrow_signer_seeds(&ctx.accounts.escrow, &maker_key);
        let seeds: &[&[u8]] = &[
            signer_seeds.0,
            signer_seeds.1.as_ref(),
            signer_seeds.2.as_ref(),
            signer_seeds.3.as_ref(),
        ];
        let signer: &[&[&[u8]]] = &[seeds];

        let vault_amount = ctx.accounts.vault.amount;
        let back = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            to: ctx.accounts.maker_ata_a.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), back, signer),
            vault_amount,
            ctx.accounts.mint_a.decimals,
        )?;

        let close = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            close,
            signer,
        ))?;
        Ok(())
    }
}

/// Build the four escrow PDA seed components as owned values so the caller can hold
/// references to them while constructing the `&[&[&[u8]]]` signer seeds. Seeds are all
/// fixed-length (prefix + 32-byte maker + 8-byte seed + 1-byte bump), so they cannot
/// collide with a different (maker, seed) pair.
fn escrow_signer_seeds<'a>(
    escrow: &Account<Escrow>,
    maker: &'a Pubkey,
) -> (&'static [u8], &'a [u8], [u8; 8], [u8; 1]) {
    (
        ESCROW_SEED,
        maker.as_ref(),
        escrow.seed.to_le_bytes(),
        [escrow.bump],
    )
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Make<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    // Both mints accept SPL Token OR Token-2022; pin each to the passed token program.
    #[account(mint::token_program = token_program)]
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub mint_b: InterfaceAccount<'info, Mint>,

    // Maker's existing source account for mint_a (must hold the deposit).
    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_ata_a: InterfaceAccount<'info, TokenAccount>,

    // Escrow STATE PDA, created here. Seeds bind it to (maker, seed) so a maker can run
    // many escrows in parallel.
    #[account(
        init,
        payer = maker,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [ESCROW_SEED, maker.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    // Vault = ATA owned by the escrow PDA. A PDA can own an ATA; the program signs vault
    // withdrawals with the escrow seeds (see `take`/`refund`).
    #[account(
        init,
        payer = maker,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>, // SPL Token OR Token-2022
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Take<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

    // The maker does not sign `take`; `has_one = maker` on the escrow proves this is the
    // right wallet, and `mut` lets it receive the closed accounts' rent.
    #[account(mut)]
    pub maker: SystemAccount<'info>,

    #[account(mint::token_program = token_program)]
    pub mint_a: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub mint_b: InterfaceAccount<'info, Mint>,

    // Escrow STATE — re-derived from its PDA seeds + stored bump, with the recorded
    // maker/mints cross-checked, then closed to the maker on success.
    #[account(
        mut,
        close = maker,
        has_one = maker @ EscrowError::InvalidMaker,
        has_one = mint_a @ EscrowError::InvalidMint,
        has_one = mint_b @ EscrowError::InvalidMint,
        seeds = [ESCROW_SEED, maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    // Taker receives mint_a. `init_if_needed` creates the ATA if the taker has none.
    // (Re-init is not a risk here: the token program, not this program, owns ATAs.)
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_a,
        associated_token::authority = taker,
        associated_token::token_program = token_program,
    )]
    pub taker_ata_a: InterfaceAccount<'info, TokenAccount>,

    // Taker's source of mint_b (the payment).
    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program,
    )]
    pub taker_ata_b: InterfaceAccount<'info, TokenAccount>,

    // Maker receives mint_b; create the ATA if needed (taker pays for it).
    #[account(
        init_if_needed,
        payer = taker,
        associated_token::mint = mint_b,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_ata_b: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint_a: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        close = maker,
        has_one = maker @ EscrowError::InvalidMaker,
        has_one = mint_a @ EscrowError::InvalidMint,
        seeds = [ESCROW_SEED, maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = escrow,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_ata_a: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)] // INIT_SPACE = 8 + 32 + 32 + 32 + 8 + 1 = 113 (discriminator added separately)
pub struct Escrow {
    pub seed: u64,      // maker-chosen nonce; lets one maker open many escrows
    pub maker: Pubkey,  // who opened the escrow (and reclaims on refund)
    pub mint_a: Pubkey, // the deposited token
    pub mint_b: Pubkey, // the requested token
    pub receive: u64,   // amount of mint_b the maker wants
    pub bump: u8,       // stored canonical PDA bump
}

#[error_code]
pub enum EscrowError {
    #[msg("Deposit and receive amounts must be greater than zero")]
    InvalidAmount, // 6000
    #[msg("Escrow maker does not match the provided account")]
    InvalidMaker, // 6001
    #[msg("Escrow mint does not match the provided mint")]
    InvalidMint, // 6002
}
