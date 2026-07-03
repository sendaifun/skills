//! examples/tests/mollusk.rs
//!
//! Mollusk unit test (Rust) for the `counter` example program.
//!
//! Mollusk is a lightweight SVM harness that invokes a single instruction directly
//! against the loaded program `.so` — no validator, no banks, microsecond runs. It is
//! the fastest way to unit-test instruction logic and to MEASURE compute units.
//!
//! Because it drives the program at the instruction level, we reuse Anchor's own
//! `InstructionData` + `ToAccountMetas` traits (from the program crate) to build the
//! discriminator + account metas exactly the way a client would.
//!
//! Verified against mollusk-svm 0.13.4 (Solana 3.x / Agave). Add to the program crate:
//!
//!   [dev-dependencies]
//!   mollusk-svm = "0.13.4"
//!   mollusk-svm-bencher = "0.13.4"   # for the CU benchmark below
//!   solana-sdk = "3"                 # umbrella dev-only SDK types
//!
//! Mollusk resolves `counter.so` from tests/fixtures/, `$BPF_OUT_DIR`, or `$SBF_OUT_DIR`
//! (i.e. `target/deploy` after `anchor build`). Run: `SBF_OUT_DIR=target/deploy cargo test`.

// `Space` must be in scope to read `Counter::INIT_SPACE` (the const #[derive(InitSpace)] generates).
use anchor_lang::{solana_program::system_program, InstructionData, Space, ToAccountMetas};
use mollusk_svm::{program::keyed_account_for_system_program, result::Check, Mollusk};
use solana_sdk::{
    account::Account, instruction::Instruction, native_token::LAMPORTS_PER_SOL, pubkey::Pubkey,
};

/// Build the `initialize` instruction the same way a client does: Anchor derives the
/// 8-byte discriminator from `sha256("global:initialize")` via `InstructionData`, and
/// `ToAccountMetas` orders the metas to match `#[derive(Accounts)]`.
fn initialize_ix(counter_pda: Pubkey, authority: Pubkey) -> Instruction {
    Instruction {
        program_id: counter::ID,
        accounts: counter::accounts::Initialize {
            counter: counter_pda,
            authority,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: counter::instruction::Initialize {}.data(),
    }
}

#[test]
fn initialize_creates_counter_pda() {
    // Loads target/deploy/counter.so and registers the builtin programs (incl. System).
    let mollusk = Mollusk::new(&counter::ID, "counter");

    let authority = Pubkey::new_unique();
    // Canonical PDA: seeds = [b"counter", authority] — MUST match the program.
    let (counter_pda, _bump) =
        Pubkey::find_program_address(&[b"counter", authority.as_ref()], &counter::ID);

    // Initial account state fed to the instruction. `init` requires the target PDA to be
    // empty + system-owned, and the payer (authority) to hold enough lamports for rent.
    let accounts = vec![
        (counter_pda, Account::new(0, 0, &system_program::ID)),
        (authority, Account::new(LAMPORTS_PER_SOL, 0, &system_program::ID)),
        keyed_account_for_system_program(),
    ];

    // process_and_validate runs the ix and asserts the Checks, panicking on mismatch.
    mollusk.process_and_validate_instruction(
        &initialize_ix(counter_pda, authority),
        &accounts,
        &[
            Check::success(),
            // After init, the PDA is owned by our program and rent-exempt with the
            // Counter layout: 8 (discriminator) + Counter::INIT_SPACE (32 + 8 + 1).
            Check::account(&counter_pda)
                .owner(&counter::ID)
                .space(8 + counter::Counter::INIT_SPACE)
                .build(),
        ],
    );
}

/// Optional: emit a markdown CU report to ./benches/compute_units.md. Run behind a
/// feature or as a separate `cargo test -- --ignored` so it doesn't run every build.
#[test]
#[ignore = "benchmark: run explicitly with `cargo test -- --ignored`"]
fn bench_initialize_cus() {
    use mollusk_svm_bencher::MolluskComputeUnitBencher;

    let mollusk = Mollusk::new(&counter::ID, "counter");
    let authority = Pubkey::new_unique();
    let (counter_pda, _bump) =
        Pubkey::find_program_address(&[b"counter", authority.as_ref()], &counter::ID);
    let ix = initialize_ix(counter_pda, authority);
    let accounts = vec![
        (counter_pda, Account::new(0, 0, &system_program::ID)),
        (authority, Account::new(LAMPORTS_PER_SOL, 0, &system_program::ID)),
        keyed_account_for_system_program(),
    ];

    MolluskComputeUnitBencher::new(mollusk)
        .bench(("initialize", &ix, &accounts))
        .must_pass(true) // fail the bench if the instruction errors
        .out_dir("./benches")
        .execute();
}
