# Anchor Quick Reference

Lookup tables for Anchor `1.1.2` (stable `v1` API): macros/attributes, the CLI command surface, an
annotated `Anchor.toml`, and cargo feature flags. For the full constraint catalog see
[../docs/account-constraints.md](../docs/account-constraints.md); for the version matrix and migration
deltas see [version-compatibility.md](version-compatibility.md).

> TS client = `@anchor-lang/core@1.1.2` (NOT `@coral-xyz/anchor`). Rust crates `anchor-lang`/`anchor-spl`
> `= "1.1.2"`. Import everything Solana via `anchor_lang::solana_program::*` — never a separate
> `solana-program` dep.

---

## 1. Macros & attributes

### Program-structure macros

| Macro / attribute | Applies to | What it does |
|---|---|---|
| `declare_id!("…")` | crate root | Sets the on-chain Program ID; generates `ID` const + `id()`/`check_id()`. `anchor keys sync` keeps it aligned with the keypair. |
| `declare_program!(name)` | crate root | Reads `idls/<name>.json` and generates a CPI client + account/instruction types + program-ID const for an **external** program. (Internal `utils` module renamed to `parsers` in 1.0.) |
| `#[program]` | `mod` | Marks the instruction-handler module. Every `pub fn` becomes an instruction `fn name(ctx: Context<T>, …args) -> Result<()>`. |
| `#[derive(Accounts)]` | struct | Declares + validates the account list for one instruction. Each field's type and `#[account(..)]` constraints run before the handler. |
| `#[instruction(…)]` | `#[derive(Accounts)]` struct | Brings the instruction's args into scope so constraints/seeds can reference them: `#[instruction(amount: u64)]`. Also sets a custom instruction discriminator: `#[instruction(discriminator = MY_CONST)]`. |
| `#[account]` | struct | Marks an account-state struct: injects an 8-byte discriminator + borsh (de)serialization + owner enforcement (via `Account<T>`). Custom: `#[account(discriminator = 1)]`. |
| `#[account(zero_copy)]` | struct | Zero-copy state (`#[repr(C)]`, `bytemuck`); paired with `AccountLoader<T>` for large/`>10 KiB` accounts. |
| `#[derive(InitSpace)]` | `#[account]` struct | Generates the `INIT_SPACE` const (sum of field sizes, **excluding** the discriminator). Use `space = 8 + T::INIT_SPACE`. |
| `#[max_len(N)]` | field | Required on `String`/`Vec<T>` fields for `InitSpace`. Nested: `#[max_len(10, 50)]` for `Vec<String>`. `const`/module values allowed (1.1.0). |
| `#[error_code]` | enum | Defines program errors (codes start at **6000**). **Exactly one** enum per program (1.0). Variants carry `#[msg("…")]`. |
| `#[event]` | struct | An emittable event (8-byte discriminator; overridable via `discriminator = …`). Emit with `emit!`/`emit_cpi!`. |
| `#[event_cpi]` | `#[derive(Accounts)]` struct | Injects the `event_authority` PDA + program accounts required by `emit_cpi!`. Needs the `event-cpi` feature. |
| `#[constant]` | `const` | Exports the constant into the IDL (so clients can read seeds/limits). |
| `#[interface(…)]` | — | **REMOVED in 1.0** (instruction-discriminator override). Use `#[instruction(discriminator = …)]`. |

### Account wrapper types (pick the type first — most checks are free)

| Type | Automatic checks |
|---|---|
| `Account<'info, T>` | owner == this program **and** discriminator matches `T`, then deserializes. |
| `Signer<'info>` | the account signed the transaction. |
| `Program<'info, T>` | key == the program's declared ID and it is executable (`Program<System>`, `Program<Token>`). |
| `Program<'info>` | executable-only validation (no type param) — added 1.0. |
| `SystemAccount<'info>` | owner == System Program. |
| `Sysvar<'info, T>` | the real sysvar at its canonical address (`Rent`, `Clock`, …). |
| `InterfaceAccount<'info, T>` | like `Account<T>` but accepts multiple owning programs — supports SPL Token **and** Token-2022. |
| `Interface<'info, T>` | the program is one of an allowed set (`Interface<TokenInterface>`). |
| `AccountLoader<'info, T>` | zero-copy on-demand (de)serialization; checks owner + discriminator. |
| `LazyAccount<'info, T>` | defers/streams deserialization (read a few fields cheaply); feature `lazy-account`. |
| `Migration<'info, From, To>` | schema migration between account types — added 1.0. |
| `UncheckedAccount<'info>` / `AccountInfo<'info>` | **nothing**; requires a `/// CHECK: <reason>` doc comment. `AccountInfo` is deprecated (warns) in 1.0 — prefer `UncheckedAccount`. |

### `require!` / error-raising family

| Macro | Meaning |
|---|---|
| `require!(cond, ErrCode)` | abort with `ErrCode` unless `cond`. |
| `require_eq!(a, b, ErrCode)` / `require_neq!(a, b, ErrCode)` | compare values. |
| `require_keys_eq!(a, b, ErrCode)` / `require_keys_neq!(a, b, ErrCode)` | compare `Pubkey`s. |
| `require_gt!(a, b, ErrCode)` / `require_gte!(a, b, ErrCode)` | ordered comparisons. |
| `err!(ErrCode)` / `error!(ErrCode)` | construct/return an `anchor_lang::Result` error. |
| `emit!(Event { … })` | log an event via `sol_log_data` (program logs). |
| `emit_cpi!(Event { … })` | emit via self-CPI (needs `event-cpi` feature + `#[event_cpi]`). |
| `msg!("…", x)` | program log line. |

### Discriminator math (constant, not stored in source)

- account: `sha256("account:<StructName>")[..8]` · event: `sha256("event:<EventName>")[..8]` ·
  instruction: `sha256("global:<snake_case_fn>")[..8]`.
- Access via the **`DISCRIMINATOR` const** (the `discriminator()` method was removed in 0.31).
  Custom/non-8-byte: `#[account(discriminator = 1)]`, `#[event(discriminator = [1,2])]`,
  `#[instruction(discriminator = CONST)]`.

---

## 2. CLI command reference

### Workspace & build

| Command | Purpose | Key flags |
|---|---|---|
| `anchor init <name>` | Scaffold a workspace. | `-t/--template {single,multiple}` (default `multiple`), `--test-template {litesvm,mollusk,mocha,rust-test,jest}` (default `litesvm`), `--anchor-version {v1,v2}` (default `v1`), `--install-agent-skills`, `--no-install`. Refuses to nest in an existing Cargo workspace. |
| `anchor new <name>` | Add another program to `programs/`. | |
| `anchor build` | Compile all programs; emit IDL + types. | `--verifiable` (Docker), `--program-name <name>`, `--ignore-keys`, `-- <cargo args>`. |
| `anchor clean` | Remove `target/` (except keypairs) + IDL artifacts. | |
| `anchor expand` | Show macro-expanded source. | |
| `anchor keys list` | Print each program's keypair pubkey. | |
| `anchor keys sync` | Rewrite `declare_id!` + `Anchor.toml` from keypairs. | |

### Test, run, deploy

| Command | Purpose | Key flags |
|---|---|---|
| `anchor test` | Build → boot validator → run the test script. | `--skip-build`, `--skip-deploy`, `--skip-local-validator`, `--validator legacy` (use `solana-test-validator` instead of Surfpool), `--script <name>`. |
| `anchor run <name>` (alias `anchor r`) | Run a named `[scripts]` entry. | |
| `anchor deploy` | Deploy all programs to `provider.cluster`; uploads the IDL by default. | `--no-idl`, `--program-name <name>`, `--program-keypair <path>`, `--provider.cluster <c>`. |
| `anchor upgrade <so> --program-id <id>` | In-place upgrade via the upgradeable loader. | `--provider.cluster`, `--max-sign-attempts`. |
| `anchor verify <program-id>` | Verify on-chain bytecode == local artifact (wraps `solana-verify`). | `-p <lib-name>` also checks the on-chain IDL. |

### On-chain IDL (Program Metadata Program, 1.0+)

| Command | Purpose |
|---|---|
| `anchor idl build` | Generate the IDL via compilation. |
| `anchor idl init -f <idl.json> [program-id]` | Create the metadata (IDL) account (program-id optional — read from `idl.address`). `--non-canonical` for third-party metadata. |
| `anchor idl upgrade -f <idl.json> [program-id]` | Overwrite the on-chain IDL (wallet must be authority). |
| `anchor idl fetch -o <out.json> <program-id>` | Download the IDL from the configured cluster. |
| `anchor idl close <program-id> [--seed <seed>]` | Close the metadata account, reclaim rent (default seed `"idl"`). |
| `anchor idl create-buffer -f <idl.json>` / `write-buffer` / `set-buffer-authority` | Multi-tx writes for large IDLs / multisig handoff. |
| `anchor idl fetch-historical <program-id>` | Recover historical IDLs (1.1.1+). |

### avm (Anchor Version Manager)

| Command | Purpose |
|---|---|
| `avm install <ver\|latest\|latest-pre-release\|<commit>>` (alias `avm i`) | Install a version. `--force`, `--from-source`, `--path <repo>`. |
| `avm use <ver\|latest>` | Switch the active version (**required** after install). |
| `avm list` (alias `avm ls`) | List installed versions. `--pre-release` includes pre-releases. |
| `avm update` | Update to latest. `--pre-release` to include pre-releases. |
| `avm self-update` | Update avm itself. `--pre-release`, `--from-commit`. |
| `avm uninstall <ver>` | Remove a version. |

`$AVM_HOME` overrides the storage dir (default `~/.avm`). avm symlinks the active `anchor` into
`$CARGO_HOME/bin`. Cold bootstrap:
`cargo install --git https://github.com/solana-foundation/anchor avm --force`.

---

## 3. Annotated `Anchor.toml`

```toml
# ── [toolchain] ──────────────────────────────────────────────────────────────
# Optional per-workspace version pins; require avm. Drives `anchor build`/`test`.
[toolchain]
anchor_version  = "1.1.2"          # avm fetches/uses this anchor-cli
solana_version  = "3.1.10"         # avm resolves the matching Solana CLI + platform-tools
package_manager = "yarn"           # npm | yarn | pnpm | bun (TS test templates only)

# ── [features] ───────────────────────────────────────────────────────────────
[features]
resolution = true                  # IDL-based account resolution for clients (default true)
skip-lint  = false                 # skip the safety lint pass

# ── [programs.<cluster>] ─────────────────────────────────────────────────────
# One Program ID per program per cluster. `anchor keys sync` writes these.
[programs.localnet]
my_program = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
[programs.devnet]
my_program = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
[programs.mainnet]
my_program = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"

# ── [provider] ── REQUIRED ───────────────────────────────────────────────────
[provider]
cluster = "localnet"               # localnet | devnet | testnet | mainnet | <RPC url>
wallet  = "~/.config/solana/id.json"

# ── [scripts] ────────────────────────────────────────────────────────────────
# Named commands; `test` runs on `anchor test`. Multiple names → `anchor run <name>`.
[scripts]
test = "cargo test"                # litesvm/mollusk default
# test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 \"tests/**/*.ts\""   # mocha template

# ── [test] / [test.validator] ── solana-test-validator opts (legacy validator) ─
[test]
upgradeable = true                 # deploy program-under-test with the upgradeable loader
[test.validator]
url = "https://api.mainnet-beta.solana.com"   # base RPC to clone from
# warp_slot, slots_per_epoch, rpc_port, ledger, limit_ledger_size, startup_wait, genesis ...
[[test.validator.clone]]           # clone an on-chain account into the local validator
address = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
[[test.validator.account]]         # or load one from a JSON file
address = "…"
filename = "fixtures/account.json"

# ── [surfpool] ── default local validator since 1.0 (mainnet-forking) ─────────
[surfpool]
rpc_port = 8899
ws_port  = 8900
# online = true, datasource_rpc_url, airdrop_addresses, slot_time,
# block_production_mode = "clock" | "transaction" ...

# ── [hooks] ── lifecycle commands (added 1.0); non-zero exit aborts the CLI ────
[hooks]
pre_build  = []                    # also pre/post for: build, test, deploy
post_deploy = []

# ── [clients] ── Codama auto client generation (added 1.0) ───────────────────
[clients]
auto = true                        # generate clients on build
# rust = "...", js = "...", js-umi = "...", go = "..."

# ── [workspace] ──────────────────────────────────────────────────────────────
[workspace]
members = ["programs/*"]
# idls  = "app/src/idls/"          # copy generated IDL out of target/ on each build
# types = "app/src/types/"

# NOTE: [registry] and `anchor login` were REMOVED in 1.0 — delete them from old configs.
```

---

## 4. Cargo feature flags

### `anchor-lang` features (program `Cargo.toml`)

| Feature | Enable when | Notes |
|---|---|---|
| `idl-build` | always wired into the **`idl-build`** feature line, never in a normal build | `idl-build = ["anchor-lang/idl-build"]` (add `"anchor-spl/idl-build"` with anchor-spl). Build-time only; toggled by `anchor build`. |
| `init-if-needed` | you use the `init_if_needed` constraint | Off by default deliberately — the handler body still runs when the account already exists (re-init footgun). Guard it. |
| `event-cpi` | you call `emit_cpi!` | Also requires `#[event_cpi]` on the instruction's Accounts struct. `anchor-lang = { version = "1.1.2", features = ["event-cpi"] }`. |
| `lazy-account` | you use `LazyAccount<'info, T>` | Defers/streams deserialization for large accounts (lower CU/stack). Experimental. |
| `allow-missing-optionals` | optional accounts at the end of an Accounts struct may be omitted | |
| `interface-instructions` | **removed in 1.0** | Use `#[instruction(discriminator = …)]`. |

Program-template features `anchor init` writes (don't remove): `cpi = ["no-entrypoint"]`,
`no-entrypoint`, `no-log-ix-name`, `idl-build`, `anchor-debug`, `custom-heap`, `custom-panic`.

### `anchor-spl` features

Default = `["associated_token", "mint", "token", "token_2022", "token_2022_extensions"]`.

| Feature | Enables |
|---|---|
| `associated_token` | `anchor_spl::associated_token` (ATA program helpers). |
| `mint` / `token` | classic SPL mint / token-account types. |
| `token_2022` | Token-2022 program types. |
| `token_2022_extensions` | Token-2022 extension constraints (`extensions::*`). |
| `metadata` | `mpl-token-metadata` integration. |
| `memo`, `stake`, `governance` | the respective SPL programs. |
| `devnet` | devnet program addresses where they differ. |
| `idl-build` | fan-in for IDL generation: `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]`. |

Use `anchor_spl::token_interface` (`InterfaceAccount<Mint>`/`InterfaceAccount<TokenAccount>` +
`Interface<TokenInterface>`) to support SPL Token **and** Token-2022 from one code path.

---

## 5. The minimal program `Cargo.toml` (1.1.2)

```toml
[package]
name = "my_program"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true

[lib]
crate-type = ["cdylib", "lib"]
name = "my_program"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build"]   # add "anchor-spl/idl-build" if using anchor-spl
anchor-debug = []
custom-heap = []
custom-panic = []

[dependencies]
anchor-lang = "1.1.2"
# anchor-lang = { version = "1.1.2", features = ["event-cpi", "init-if-needed"] }
# anchor-spl  = "1.1.2"

[lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = ['cfg(target_os, values("solana"))'] }
```

> Do **not** add a separate `solana-program` dependency — Anchor 0.32 split it into smaller crates
> re-exported under `anchor_lang::solana_program`; a second copy causes version-conflict build errors.

---

## References

- Anchor docs (1.x): https://www.anchor-lang.com/docs
- CLI reference: https://www.anchor-lang.com/docs/references/cli
- `Anchor.toml` reference: https://www.anchor-lang.com/docs/references/anchor-toml
- avm reference: https://www.anchor-lang.com/docs/references/avm
- Account constraints: https://www.anchor-lang.com/docs/references/account-constraints
- Account types: https://www.anchor-lang.com/docs/references/account-types
- Events (`emit!` vs `emit_cpi!`): https://www.anchor-lang.com/docs/features/events
- `anchor-spl` (docs.rs): https://docs.rs/anchor-spl/latest/anchor_spl/
</content>
