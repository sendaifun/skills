// Token-2022 Transfer Hook — minimal Anchor 1.x program (transfer counter + "only during transfer" guard)
// =====================================================================================================
//
// A transfer-hook program is CPI-invoked by Token-2022 on EVERY `transferChecked` of a mint that
// carries the `TransferHook` extension and points at this program. Use it for royalty enforcement,
// allow/deny lists, KYC gating, or — as here — counting transfers.
//
// This program demonstrates the three pieces every hook needs:
//   1. `initialize_extra_account_meta_list` — writes the `ExtraAccountMetaList` validation PDA that
//      tells Token-2022 which EXTRA accounts to pass into the hook (here: a `Counter` PDA). The client
//      and Token-2022 read this account to resolve and append those accounts at transfer time.
//   2. `transfer_hook` — the `Execute` handler. Token-2022 routes its CPI here via the SPL
//      `Execute` discriminator (NOT a normal Anchor discriminator), so we override it with
//      `#[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]`.
//   3. (optional) `initialize` — create the hook mint on-chain via the `extensions::transfer_hook`
//      mint constraint. The companion `client.ts` instead creates the mint with `@solana/spl-token`;
//      either path produces the same mint.
//
// -----------------------------------------------------------------------------------------------------
// Cargo.toml (programs/transfer-hook/Cargo.toml)
// -----------------------------------------------------------------------------------------------------
//   [package]
//   name = "transfer-hook"
//   version = "0.1.0"
//   edition = "2021"
//
//   [lib]
//   crate-type = ["cdylib", "lib"]
//   name = "transfer_hook"
//
//   [features]
//   default = []
//   cpi = ["no-entrypoint"]
//   no-entrypoint = []
//   idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
//
//   [dependencies]
//   anchor-lang                  = { version = "1.1.2", features = ["init-if-needed"] }
//   anchor-spl                   = "1.1.2"
//   spl-transfer-hook-interface  = "2.1.0"
//   spl-tlv-account-resolution   = "0.11.1"
//   spl-discriminator            = "0.5.2"   // NOTE: must resolve to the SAME version that
//                                            //         spl-transfer-hook-interface 2.1.0 pulls in
//                                            //         (run `cargo tree -i spl-discriminator`; a split
//                                            //         version makes `SPL_DISCRIMINATOR_SLICE` mismatch).
//
// Toolchain: anchor-lang/anchor-spl 1.1.2, Solana CLI 3.1.10, rustc 1.89.0 (MSRV).
//
// -----------------------------------------------------------------------------------------------------
// Build / deploy
// -----------------------------------------------------------------------------------------------------
//   anchor build
//   anchor keys sync                 # rewrites declare_id! + Anchor.toml with your program keypair
//   anchor deploy --provider.cluster devnet
//   # then run the client:  npx ts-node client.ts
//
// NOTE on Anchor versions:
//   * Anchor 0.31+/1.x: use `#[instruction(discriminator = ...)]` (shown here).
//   * Anchor <= 0.30:   use `#[interface(spl_transfer_hook_interface::execute)]` on `transfer_hook`
//                       PLUS a hand-written `fallback` that routes the raw `Execute` discriminator.
//   * The SPL crates use `solana-program-error` 2.x while anchor-lang 1.x uses 3.x. They share the
//     same shape but a different semver, so wrap SPL `Result`s with `.map_err(|_| ProgramError::...)`
//     before `?` (done below).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, Token2022, TokenAccount},
};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensionsMut, PodStateWithExtensionsMut,
    },
    pod::PodAccount,
};
use spl_discriminator::SplDiscriminate;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{
    ExecuteInstruction, InitializeExtraAccountMetaListInstruction,
};

// Placeholder id — run `anchor keys sync` after `anchor build` to replace it with YOUR program id.
// The same id must be set as `HOOK_PROGRAM_ID` in client.ts.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod transfer_hook {
    use super::*;

    /// OPTIONAL: create the hook mint on-chain. The `extensions::transfer_hook` constraint sets the
    /// `TransferHook` extension's authority + program id during `init`. (client.ts builds the mint
    /// off-chain with @solana/spl-token instead — both yield an identical mint.)
    pub fn initialize(_ctx: Context<Initialize>, _decimals: u8) -> Result<()> {
        Ok(())
    }

    /// Write the `ExtraAccountMetaList` validation PDA and create the transfer `Counter`.
    /// Called once per mint by the client BEFORE any transfer. The client sends this with the SPL
    /// `InitializeExtraAccountMetaList` discriminator `[43,34,13,49,167,88,235,235]`, matched here.
    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        // Describe the EXTRA accounts Token-2022 must resolve and append to every `Execute` CPI.
        // Here: one PDA at seeds `[b"counter"]` (under THIS program), writable, not a signer.
        let extra_account_metas = InitializeExtraAccountMetaList::extra_account_metas()?;

        // Serialize the TLV list into the validation account, keyed by the `Execute` discriminator.
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_account_metas,
        )
        .map_err(|_| ProgramError::InvalidAccountData)?;

        ctx.accounts.counter.count = 0;
        Ok(())
    }

    /// The `Execute` handler. Token-2022 CPIs into this on every `transferChecked` of the hook mint,
    /// passing the fixed accounts (source, mint, destination, authority, validation PDA) plus the
    /// resolved extra accounts (our `counter`). `amount` is the transfer amount in base units.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        // SECURITY: a hook is just a program — anyone can call it directly with spoofed accounts.
        // Token-2022 sets the source account's `TransferHookAccount.transferring` flag ONLY while it
        // is mid-transfer, so assert it here to reject calls made outside a real transfer CPI.
        {
            let source_info = ctx.accounts.source_token.to_account_info();
            let mut data = source_info.try_borrow_mut_data()?;
            let mut state = PodStateWithExtensionsMut::<PodAccount>::unpack(*data)
                .map_err(|_| ProgramError::InvalidAccountData)?;
            let hook_ext = state
                .get_extension_mut::<TransferHookAccount>()
                .map_err(|_| ProgramError::InvalidAccountData)?;
            require!(
                bool::from(hook_ext.transferring),
                TransferHookError::IsNotCurrentlyTransferring
            );
        }

        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_add(1).ok_or(TransferHookError::Overflow)?;
        msg!("transfer #{} for {} base units", counter.count, amount);

        // --- Allowlist variant (sketch) -------------------------------------------------------------
        // To gate transfers instead of counting them, add an allowlist PDA to `extra_account_metas`
        // (e.g. `ExtraAccountMeta::new_with_seeds(&[Seed::Literal{bytes:b"allow".to_vec()},
        // Seed::AccountKey{index:2 /* destination */}], false, false)`), require it as an account on
        // `TransferHook`, and `require!(allow_pda.is_initialized, ...)` / check its data here. A failed
        // `require!` aborts the whole transfer atomically.
        // --------------------------------------------------------------------------------------------
        Ok(())
    }
}

/// Optional on-chain mint creation (see `initialize` above).
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
        extensions::transfer_hook::authority = payer,
        extensions::transfer_hook::program_id = crate::ID,
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: validation PDA owned by this program; seeds are fixed by the transfer-hook interface.
    #[account(
        init,
        payer = payer,
        // `size_of(N)` = TLV header + N * ExtraAccountMeta. `.unwrap()` is safe for a constant count.
        space = ExtraAccountMetaList::size_of(InitializeExtraAccountMetaList::extra_account_metas_count()).unwrap(),
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + Counter::INIT_SPACE,
        seeds = [b"counter"],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetaList<'info> {
    /// The extra accounts Token-2022 appends to every `Execute` CPI for this mint.
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(vec![ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal { bytes: b"counter".to_vec() }],
            false, // is_signer
            true,  // is_writable (the hook increments it)
        )
        .map_err(|_| ProgramError::InvalidAccountData)?])
    }

    pub fn extra_account_metas_count() -> usize {
        1
    }
}

/// Account ordering is FIXED by `spl-transfer-hook-interface`:
///   0 source_token  1 mint  2 destination_token  3 owner/authority  4 validation PDA  5.. extra accounts
/// Anchor binds struct fields positionally, so this order must match exactly.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source owner — a SystemAccount or PDA; Token-2022 already authorized the transfer.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: validation PDA — re-derived to bind it to this mint.
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"counter"], bump)]
    pub counter: Account<'info, Counter>,
}

#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub count: u64,
}

#[error_code]
pub enum TransferHookError {
    #[msg("The token is not currently being transferred (hook invoked outside a transfer)")]
    IsNotCurrentlyTransferring,
    #[msg("Transfer counter overflow")]
    Overflow,
}
