# Troubleshooting

A catalog of the errors you actually hit building, testing, and deploying Anchor `1.1.2` programs,
each as **Error / Cause / Solution**. This is the superset of the SKILL.md "Common Errors" section,
grouped by phase. Anchor's framework error codes are stable; custom program errors start at **6000**.

> Quick orientation on error-code ranges:
> **2000–2499** constraint failures · **2500–2599** `require!` family · **3000–3017** account
> errors · **6000+** your `#[error_code]` enum.

---

## Build errors (Rust / `anchor build`)

### Error: `declared program id does not match` / `DeclaredProgramIdMismatch`
**Cause** The pubkey in `declare_id!("...")` differs from `target/deploy/<name>-keypair.json`.
Anchor 1.0 added a build-time check (a hard error in 1.0, softened to a warning in 1.1.1). Happens
after a fresh `anchor build` generated a new keypair, or after cloning/copying a template without
updating the ID.
**Solution** `anchor keys sync` rewrites `declare_id!` **and** `Anchor.toml` from the keypair files;
then `anchor build`. During early prototyping you can bypass with `anchor build --ignore-keys`.

### Error: `failed to select a version for ... solana-program` / "two versions of crate solana-program"
**Cause** A separate `solana-program` dependency was added to the program `Cargo.toml`. Anchor 0.32+
split the monolithic `solana-program` crate into smaller crates and re-exports them under
`anchor_lang::solana_program`; a second copy collides.
**Solution** Remove `solana-program` from `[dependencies]`. Import everything you need via
`anchor_lang::solana_program::{...}` (e.g. `instruction::Instruction`, `system_program`, `pubkey`) and
use `anchor_lang::system_program::{Transfer, transfer, ID}` for SOL CPIs.

### Error: `error: failed to parse lock file ... lock file version 4 requires -Znext-lockfile-bump`
**Cause** `Cargo.lock` is on `version = 4`, but the active cargo/rustc is older than the lockfile
format expects.
**Solution** Use the Anchor MSRV toolchain (rustc **1.89.0** — the `rust-toolchain.toml` `anchor init`
writes pins this). As a stopgap on an older toolchain, edit `Cargo.lock` and change `version = 4` →
`version = 3`.

### Error: `package requires rustc 1.89.0 or newer` / `feature X is stable since 1.89`
**Cause** `anchor-lang 1.1.x` raised its MSRV to **rustc 1.89.0** (1.1.0 migrated `anchor-syn` to
`syn 2.0`). An older toolchain can't compile it.
**Solution** `rustup update` and ensure `rust-toolchain.toml` has `channel = "1.89.0"`. Verify with
`rustc --version`.

### Error: `Stack offset of NNNN exceeded max offset of 4096 by MMMM bytes`
**Cause** A function's stack frame exceeds the SBF 4 KiB limit — usually a large `Account<T>`,
big arrays, or many large locals copied onto the stack. More common on Solana v2/v3 toolchains which
tightened stack accounting.
**Solution** Box large accounts: `pub data: Box<Account<'info, BigState>>` (moves them to the heap).
For accounts that are large or near the 10 KiB `init` ceiling, switch to zero-copy
(`#[account(zero_copy)]` + `AccountLoader` + `load_mut()`), and avoid deep nested struct copies.

### Error: `memory allocation failed, out of memory` (runtime/build-time)
**Cause** Heap exhaustion. The SBF runtime gives a program a small fixed heap (32 KiB by default); a
large `Vec`/`String`, deserializing an oversized account, or many boxed allocations overruns it.
**Solution** Reduce heap pressure (avoid cloning large buffers; use zero-copy for big accounts; stream
with `LazyAccount` to read only a few fields). If you genuinely need more, request a larger heap with a
`ComputeBudget::request_heap_frame` instruction from the client, and consider a `custom-heap`
allocator feature.

### Error: `the trait bound ... Discriminator is not satisfied` / `no method named discriminator`
**Cause** Code calls the removed `T::discriminator()` method (gone since 0.31), or a `zero`-constraint
account lacks a `Discriminator` impl.
**Solution** Use the **`DISCRIMINATOR` associated constant** instead: `T::DISCRIMINATOR`. Size custom
accounts with `space = T::DISCRIMINATOR.len() + T::INIT_SPACE` (discriminators may be non-8-byte in
0.31+). Derive `#[account]` so the impl exists.

---

## IDL build errors (`anchor build` IDL generation)

### Error: `idl-build` feature missing / `proc_macro` IDL errors with anchor-spl
**Cause** The program uses `anchor-spl` (or other Anchor crates) but the `idl-build` feature doesn't
fan out to them, so IDL generation can't resolve the types.
**Solution** In the program `Cargo.toml`, wire every Anchor crate into `idl-build`:
```toml
[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```
Never enable `idl-build` in a normal build — it is a build-time-only feature `anchor build` toggles.

### Error: `Error: Failed to generate IDL` on a type that previously built
**Cause** Anchor 1.0 **hard-errors** on IDL field types it cannot represent (e.g. tuple struct fields,
some generics) that older versions silently dropped.
**Solution** Remove the unsupported type from any **public** instruction-arg or `#[account]`/`#[event]`
field (replace a tuple with a named struct). Then `anchor clean && anchor build`.

### Error: client deserialization fails with a "spec"/IDL-version error
**Cause** The on-chain/loaded IDL spec doesn't match the client. Anchor 1.1 uses IDL spec `0.1.3`;
mixing a stale IDL with a newer client (or vice-versa) breaks decoding.
**Solution** Regenerate: `anchor build` (or `anchor idl build`), refresh `target/idl` + `target/types`,
and re-`anchor idl upgrade` the on-chain IDL. Keep the Rust crate and TS package on the **same** Anchor
version (see the version mismatch entry below).

---

## Client / TypeScript errors (`@anchor-lang/core`)

### Error: `Cannot find module '@coral-xyz/anchor'`
**Cause** Code or a tutorial targets the old TS scope. `@coral-xyz/anchor` is frozen at `0.32.1`;
the 1.x client was renamed.
**Solution** `npm i @anchor-lang/core@1.1.2` and update imports:
`import * as anchor from "@anchor-lang/core"`. Import generated types from `../target/types/<name>`.
Do **not** install both scopes — they ship incompatible `Program`/`BN`/`web3.js` copies.

### Error: `Expected 2 arguments, but got 3` on `new Program(...)`
**Cause** The 3-arg `new Program(idl, programId, provider)` form is gone (program-id arg dropped in
0.30, then the package renamed in 1.0).
**Solution** Use the **2-arg** constructor — the program ID is read from `IDL.address`:
```ts
import { Program } from "@anchor-lang/core";
const program = new Program<Counter>(IDL, provider);   // IDL = ../target/idl/counter.json
// In a workspace: const program = anchor.workspace.Counter as Program<Counter>;
```

### Error: version mismatch — Rust crate vs TS package
**Cause** `anchor-lang`/`anchor-spl` (Rust) and `@anchor-lang/core` (TS) are on different Anchor
versions. The IDL the Rust side emits no longer matches what the TS client expects (account
resolution, discriminator length, or spec changes), producing decode/resolution errors at runtime.
**Solution** Keep them in lockstep: `anchor-lang = "1.1.2"` ⇄ `@anchor-lang/core@1.1.2`. After bumping
either, `anchor build` to regenerate the IDL + types and reinstall TS deps. The avm-active CLI should
match too (`anchor --version`).

### Error: `Account does not exist or has no data` / `AccountNotInitialized` from the client
**Cause** The client derived a different PDA than the program expects (wrong seeds/order/program id),
or the account was never created.
**Solution** Derive PDAs with the **identical** seeds on both sides
(`PublicKey.findProgramAddressSync([Buffer.from("seed"), key.toBuffer()], program.programId)`), and
create the account first via its `init` instruction. `.accounts()` resolves strictly and rejects
unknown keys; use `.accountsPartial()` to pass a subset and let Anchor resolve the rest.

### Error: `Error: Account does not exist <PDA>` when fetching the IDL / `target/idl` not found
**Cause** Either the local `target/idl/<name>.json` was never generated (`anchor build` not run), or
`Program.fetchIdl`/`anchor idl fetch` can't find an on-chain IDL because none was uploaded.
**Solution** Run `anchor build` to produce `target/idl` + `target/types`. To publish the on-chain IDL,
`anchor deploy` (uploads by default) or `anchor idl init -f target/idl/<name>.json`. If you migrated to
1.0, ensure the legacy IDL was closed first (see [deployment-and-upgrades.md](deployment-and-upgrades.md) §7).

---

## Test errors

### Error: `anchor test` hangs or fails to start a validator / "surfpool: command not found"
**Cause** Anchor 1.x defaults `anchor test` / `anchor localnet` to **Surfpool** (a mainnet-forking
local validator). CI or a machine that assumes `solana-test-validator` breaks here.
**Solution** Install Surfpool (≥ 1.1.2), or fall back to the classic validator:
`anchor test --validator legacy` (uses `solana-test-validator`). For the LiteSVM/Mollusk default test
templates, no validator runs at all (`anchor test` runs `cargo test`).

### Error: tests pass with `solana-test-validator` but behave differently on Surfpool (or vice-versa)
**Cause** Surfpool forks mainnet state and models real fees/accounts; `solana-test-validator` starts
empty with a local faucet. Cloned accounts, sysvar clocks, and rent differ.
**Solution** Decide which fidelity you want. For deterministic unit/integration tests prefer
**Mollusk** (Rust, per-instruction) or **LiteSVM** (in-process SVM, the 1.x default template) — both
avoid a validator entirely. Reserve Surfpool/`--validator legacy` for end-to-end/RPC behavior. See
[testing.md](testing.md).

### Error: Mollusk/LiteSVM test can't find the program `.so`
**Cause** The compiled program binary isn't where the test loads it. Mollusk and LiteSVM `add_program`
need `target/deploy/<name>.so` (or a fixture), which requires a prior `anchor build`/`cargo build-sbf`.
**Solution** Build first (`anchor build`), and point the loader at the right path
(`include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/<name>.so"))` for LiteSVM, or set
`SBF_OUT_DIR`/use `tests/fixtures` for Mollusk).

### Error: TS test throws on `.accounts({...})` — "unknown account" / "missing account"
**Cause** `.accounts()` is strict in 1.x: it rejects keys it doesn't recognize and requires every
non-resolvable account.
**Solution** Pass exactly the accounts the IDL declares, or use `.accountsPartial({...})` to supply a
subset and let IDL-based resolution fill the rest (`[features] resolution = true`, the default).

---

## Runtime / program errors (constraint & account failures)

These surface as `AnchorError` in client logs with a numeric code; the program log line names the
constraint and account.

### Error: `AccountNotInitialized` (3012)
**Cause** An instruction expects an existing `Account<T>` (often a PDA) that was never created, or the
seeds/address resolve to an account that isn't on-chain.
**Solution** Create it first via an `init` instruction, or fix the seeds. Use `init_if_needed`
(feature `init-if-needed`, with a re-init guard) only when create-or-use in one instruction is truly
required.

### Error: `A seeds constraint was violated` / `ConstraintSeeds` (2006)
**Cause** The passed account ≠ the PDA derived from your `seeds`/`bump` — wrong seed bytes, wrong
order, a stale/non-canonical `bump`, or the client derived the PDA differently than the program.
**Solution** Derive with identical seeds on both sides. If you pass `bump = stored`, ensure `stored`
is the **canonical** bump captured at init (`ctx.bumps.<field>`), not a client-supplied value.

### Error: `A has_one constraint was violated` / `ConstraintHasOne` (2001)
**Cause** `#[account(has_one = authority)]` failed: the account's stored `authority` field ≠ the
`authority` account you passed. (Note: `has_one` does **not** check a signature.)
**Solution** Pass the account whose key equals the stored field, and pair `has_one` with a `Signer` if
you also need proof of control: `#[account(has_one = authority)]` + `pub authority: Signer<'info>`.

### Error: `AccountOwnedByWrongProgram` (3007)
**Cause** A typed account (`Account<T>`, `InterfaceAccount<T>`, token account) is owned by a different
program than expected — e.g. passing a classic SPL Token account where a Token-2022 account is
required, or a foreign account spoofed in.
**Solution** For tokens, support both programs with `InterfaceAccount` +
`Interface<'info, TokenInterface>` and thread `token::token_program`/`mint::token_program`. Detect a
mint's program via its account `.owner`. For non-token accounts, the `Account<T>` owner check is your
defense — don't replace it with `UncheckedAccount`.

### Error: `AccountDiscriminatorMismatch` (3002) / `AccountDiscriminatorNotFound` (3001)
**Cause** The first 8 bytes of the account don't match the expected type's discriminator (type cosplay,
wrong account passed, or an uninitialized account read as a typed one).
**Solution** Pass the correct account. The discriminator check is automatic for `Account<T>` — keep
the typed wrapper rather than deserializing raw bytes. If you use **custom discriminators**
(`#[account(discriminator = …)]`), make sure the client encodes the same value.

### Error: `Failed to serialize the account` / `AccountDidNotSerialize` (3004) — space too small
**Cause** `space` is too small for the data: a forgotten `+ 8` discriminator, a `String`/`Vec` larger
than its `#[max_len]`, or a struct that grew without bumping `space`.
**Solution** Use `space = 8 + T::INIT_SPACE` with `#[derive(InitSpace)]` (or
`T::DISCRIMINATOR.len() + T::INIT_SPACE` for custom discriminators); raise `#[max_len(N)]`; for
already-deployed accounts that must grow, use the `realloc` constraint.

### Error: `AccountNotMutable` (3006) / `init` + `mut` conflict
**Cause** Writing to an account not marked `#[account(mut)]`, **or** combining `init` with `mut` —
`init` already implies `mut`, and listing both is rejected.
**Solution** Add `#[account(mut)]` to any account you modify (including `close = …` and `realloc`
targets). Use `init` **alone** when creating — don't also write `mut`.

### Error: `An init constraint requires a system_program account` / `init` fails resolving
**Cause** An `init` account needs three things present in the `#[derive(Accounts)]` struct: a `payer`,
a `space`, and a field literally named `system_program`.
**Solution** Add `pub system_program: Program<'info, System>` to the struct (and
`pub associated_token_program: Program<'info, AssociatedToken>` when using `associated_token::*`).
Provide `payer = <signer>` and `space = …`. `init` cannot create accounts > 10 KiB — use `zero` (create
in a prior tx) for those.

### Error: custom error fires but the client shows a bare number, not your message
**Cause** The client can't map the error code to a name/message because it lacks the matching IDL, or
the program and client are on mismatched Anchor versions.
**Solution** Ensure the client loads the current IDL (`target/idl/<name>.json`) so codes ≥ 6000 resolve
to your `#[msg("...")]` text. Anchor 1.0 allows **one** `#[error_code]` enum per program — merge
multiple legacy enums into one.

---

## Deploy errors

Deploy/upgrade failures (failed deploy & stranded buffers, verified-build hash mismatch, legacy IDL
migration, mainnet congestion, `--final`/close footguns) are covered in detail in
[deployment-and-upgrades.md](deployment-and-upgrades.md) §5 and §10. The two you hit most:

### Error: a mainnet deploy "ate" SOL and didn't finish
**Cause** A large deploy failed after staging a buffer; the buffer survives and holds the rent.
**Solution** `solana program show --buffers`, then resume
(`solana program deploy --buffer <recovered-keypair>`, recovering the keypair from the printed 12-word
seed with `solana-keygen recover`) or reclaim (`solana program close --buffers`).

### Error: explorer shows "not verified" after a verified deploy
**Cause** The deployed `.so` wasn't the one `solana-verify build` produced (an `anchor build` re-ran
after), or the verification PDA job hasn't completed.
**Solution** Confirm `solana-verify get-program-hash` == `get-executable-hash`; if not, redeploy the
exact verifiable artifact. Then `solana-verify verify-from-repo` + `remote submit-job` and wait for
`remote get-status`.

---

## References

- Anchor error codes (`anchor_lang::error::ErrorCode`): https://docs.rs/anchor-lang/latest/anchor_lang/error/enum.ErrorCode.html
- Anchor account constraints reference: https://www.anchor-lang.com/docs/references/account-constraints
- Anchor 1.0.0 release notes (breaking changes): https://www.anchor-lang.com/docs/updates/release-notes/1-0-0
- Solana program errors & logs: https://solana.com/docs/programs/debugging
- Compute budget / heap frame: https://solana.com/docs/core/fees#compute-unit-limit
</content>
