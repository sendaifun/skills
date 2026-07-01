// examples/token-vault/lib.rs
//
// A per-owner token vault that works with BOTH classic SPL Token and Token-2022
// (Token Extensions) from a SINGLE code path. This is the canonical "dual token
// program" pattern in Anchor 1.x.
//
// ── The dual-program-support pattern (read this first) ───────────────────────
// Classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) and Token-2022
// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) are two *different programs* that
// own mints and token accounts. They share the same base account layout, so one
// deserializer reads both — what differs is the OWNER program. A program that
// hard-codes `Account<'info, TokenAccount>` / `Program<'info, Token>` is locked to
// classic SPL Token and will reject every Token-2022 account with
// `AccountOwnedByWrongProgram` (3007).
//
// To accept either, use the `anchor_spl::token_interface` types:
//   • `InterfaceAccount<'info, Mint>` / `InterfaceAccount<'info, TokenAccount>`
//        — like `Account<T>`, but the owner may be SPL Token *or* Token-2022.
//   • `Interface<'info, TokenInterface>` for the program field
//        — validates the passed program is one of the two token programs.
// Then THREAD the runtime token program through every token/mint/ATA constraint
// (`token::token_program = token_program`, `mint::token_program = ...`,
// `associated_token::token_program = ...`) and pass that same account as the CPI
// program. Anchor verifies the mint and the token accounts are all owned by the
// program you threaded, so a caller cannot mix a Token-2022 mint with a classic
// token account. Detect a mint's program off-chain via its account `.owner`.
//
// Always use `transfer_checked` (never `transfer`): Token-2022 mints can carry a
// transfer-fee extension, and `transfer_checked` enforces the mint+decimals so the
// fee math is applied correctly. The same call works for classic SPL Token.
//
// ── Cargo.toml for this example ──────────────────────────────────────────────
//   [dependencies]
//   anchor-lang = "1.1.2"
//   anchor-spl  = "1.1.2"   # default features include token, token_2022,
//                           # token_2022_extensions, associated_token
//   [features]
//   idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
//   # The workspace release profile should keep `overflow-checks = true`.
//
// Build: `anchor build` then `anchor keys sync` (rewrites declare_id! below).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

// Placeholder program ID — `anchor keys sync` rewrites this from the program keypair.
declare_id!("8zb6cSEHYkMUaZ6mz4o3b848pSrisZbtcDuvYpqZ41pK");

#[program]
pub mod token_vault {
    use super::*;

    /// Create the vault for `(owner, mint)`: a PDA state account plus an
    /// Associated Token Account whose authority is that same PDA. Works for a
    /// classic SPL Token mint or a Token-2022 mint — the caller decides by which
    /// `token_program` they pass.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        state.owner = ctx.accounts.owner.key();
        state.mint = ctx.accounts.mint.key();
        state.bump = ctx.bumps.vault_state; // store the canonical bump for cheap re-derivation
        Ok(())
    }

    /// Move `amount` from the owner's token account into the vault. The OWNER
    /// signs this transfer directly (a normal `CpiContext::new`).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);

        // One CPI call for both token programs: pass the threaded `token_program`
        // as the CPI program, and `transfer_checked` enforces mint + decimals.
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.owner_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

        emit!(Deposited {
            owner: ctx.accounts.owner.key(),
            mint: ctx.accounts.mint.key(),
            amount,
        });
        Ok(())
    }

    /// Move `amount` from the vault back to the owner. The VAULT STATE PDA is the
    /// token-account authority, so the program signs the transfer on its behalf
    /// with `CpiContext::new_with_signer` and the PDA's seeds.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.vault.amount >= amount,
            VaultError::InsufficientFunds
        );

        // Bind the seed components to locals so the slice borrows live long enough.
        let owner_key = ctx.accounts.owner.key();
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            owner_key.as_ref(),
            mint_key.as_ref(),
            &[ctx.accounts.vault_state.bump],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.owner_ata.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        );
        transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

        emit!(Withdrawn {
            owner: ctx.accounts.owner.key(),
            mint: ctx.accounts.mint.key(),
            amount,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    // `InterfaceAccount<Mint>` accepts a mint owned by EITHER token program.
    // `mint::token_program` asserts the mint's owner equals the program the caller
    // threaded, so the whole instruction is consistent (no mixing the two).
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    // Vault state PDA: domain-specific seeds (owner + mint) so each owner's vault
    // for each mint is isolated — never a single shared PDA authority.
    #[account(
        init,
        payer = owner,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", owner.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    // The vault's token account: an ATA whose AUTHORITY is the state PDA above.
    // Because the authority is a PDA, the program can sign withdrawals for it.
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>, // SPL Token OR Token-2022
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), mint.key().as_ref()],
        bump = vault_state.bump,        // reuse the stored canonical bump
        has_one = owner,                // vault_state.owner  == owner.key()
        has_one = mint,                 // vault_state.mint   == mint.key()
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref(), mint.key().as_ref()],
        bump = vault_state.bump,
        has_one = owner,
        has_one = mint,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub owner: Pubkey, // 32
    pub mint: Pubkey,  // 32
    pub bump: u8,      // 1
}

#[event]
pub struct Deposited {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount, // 6000
    #[msg("Insufficient funds in the vault")]
    InsufficientFunds, // 6001
}
