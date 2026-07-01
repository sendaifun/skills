---
name: anchor
description: Build, test, secure, and deploy Solana programs with the Anchor framework (v1.1.2 / @anchor-lang/core). Covers program structure, the #[derive(Accounts)] constraint system, PDAs, CPI with anchor-spl (SPL Token + Token-2022), errors and events, IDL/Codama clients, testing with LiteSVM/Mollusk, the Sealevel-attacks security checklist, and verifiable mainnet deployment/upgrades. Use when writing or reviewing Anchor programs, debugging account/constraint errors, or migrating from Anchor 0.30/0.31 to 1.x.
---

# Anchor

Anchor is the dominant high-level framework for Solana program development: it turns hand-written account validation, (de)serialization, and CPI plumbing into a small set of declarative macros (`#[program]`, `#[derive(Accounts)]`, `#[account]`) plus a typed TypeScript/Rust client generated from an IDL. This skill covers the current **1.x** line end to end — structure, constraints, PDAs, CPI, errors/events, clients, testing, security, and verifiable mainnet deployment — pinned to verified versions, with explicit notes for migrating off 0.30/0.31/0.32.

## Overview

A Solana program is a stateless executable; all state lives in separate accounts that the runtime passes in by reference. The hard, bug-prone part of every instruction is **validating those accounts** — is this the right owner? did the authority sign? is this PDA derived from the canonical bump? — before touching their bytes. Anchor encodes those checks as constraints on a struct, generates the (de)serialization (with an 8-byte type discriminator), and emits an **IDL** (interface description) that drives typed clients. The result is dramatically less boilerplate and a large class of vulnerabilities closed by construction.

State of the 1.x line (pin to these — verified):

- **Anchor 1.0.0 shipped 2026-04-02**; the current stable is **`1.1.2`** (2026-06-26). `0.32.1` was the last 0.x release and is now legacy.
- Rust crates: `anchor-lang = "1.1.2"`, `anchor-spl = "1.1.2"`. **MSRV is rustc 1.89.0**. Anchor 1.x requires **Solana 3.0+** (Solana 2.x is unsupported); CI/verifiable builds pin **Solana CLI 3.1.10** (Agave 3.x), while the newest Agave stable is 4.1.0.
- The TS client was **renamed** to **`@anchor-lang/core` (1.1.2)**. The old `@coral-xyz/anchor` is frozen at `0.32.1` — do not mix the two scopes. The client still depends on `@solana/web3.js` v1 (not Kit).
- The repository moved to **`github.com/solana-foundation/anchor`** (OtterSec maintains it).
- An experimental **`v2` / "anchor-next"** API exists (`anchor init --anchor-version v2`) but is unpublished (git dependency, `wincode` serialization). It is **not for production** — every example here uses the stable `v1` API.

For the 0.30 → 1.x migration deltas (package rename, `Context` lifetimes, single `#[error_code]`, on-chain IDL via the Program Metadata Program, custom discriminators), see [resources/version-compatibility.md](resources/version-compatibility.md).

## When to use Anchor vs native vs Pinocchio

| Dimension | **Anchor** | **Native (solana-program/Agave SDK)** | **Pinocchio** |
|---|---|---|---|
| Developer experience | Highest — declarative constraints, derive macros, generated client | Low — you write every check, (de)serialize, and CPI by hand | Low — zero-dependency, zero-copy, manual everything |
| Safety by default | Strong — owner/discriminator/signer/seed checks are free | None automatic — every check is your responsibility | None automatic — but explicit and auditable |
| Compute units (token transfer, approx.) | ~3k–6k CU | ~4.5k CU | ~600–800 CU |
| Binary size | Largest | Medium | Smallest (~40% smaller than Anchor) |
| IDL / typed client | Auto (IDL + `target/types`) | None (use Shank + Codama) | None (use Shank + Codama) |
| Best for | dApps, DeFi, most programs; rapid iteration; audit-friendly | Fine-grained control without a framework | CU-bound hot paths: AMMs, orderbooks, on-chain games, token primitives |
| Audit availability | Most auditors know Anchor | Fewer | Fewest (and `pinocchio` is younger) |

Rule of thumb: **reach for Anchor first.** Drop to Pinocchio only when compute units or program size are a measured bottleneck on a hot instruction. You can also mix: an Anchor program can CPI into a Pinocchio program and vice-versa. For the low-level path, see the **`pinocchio-development`** skill.

## Install & toolchain

Anchor is installed and pinned with **avm** (Anchor Version Manager).

```bash
# 1. Prereqs: Rust (>= MSRV 1.89.0) and the Solana CLI.
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
# Pin the Anchor-tested Solana toolchain (3.1.10). `stable` currently installs Agave 4.1.0.
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.10/install)"

# 2. Install avm, then Anchor 1.1.2.
cargo install --git https://github.com/solana-foundation/anchor avm --force
avm install 1.1.2
avm use 1.1.2

# 3. Verify.
anchor --version        # -> anchor-cli 1.1.2
solana --version        # -> 3.1.10 (Agave)
node --version          # -> v20.18+ (required by @anchor-lang/core and litesvm npm)
```

Pin versions explicitly in source so collaborators and CI reproduce your build:

- `programs/<name>/Cargo.toml`: `anchor-lang = "1.1.2"`, `anchor-spl = "1.1.2"`.
- `rust-toolchain.toml`: `channel = "1.89.0"` (written by `anchor init`).
- `Anchor.toml` `[toolchain]`: `anchor_version = "1.1.2"`, `solana_version = "3.1.10"`.
- TS deps: `@anchor-lang/core@1.1.2` (NOT `@coral-xyz/anchor`).

For the full crate ↔ Solana/Agave ↔ Rust ↔ anchor-spl matrix and avm subcommands, see [resources/version-compatibility.md](resources/version-compatibility.md).

### Quick start

```bash
anchor init my_project        # scaffolds a workspace (multiple-file template, litesvm tests)
cd my_project
anchor build                  # compiles the program, emits target/idl + target/types
anchor keys sync              # align declare_id! + Anchor.toml with the program keypair
anchor test                   # builds, boots the validator (Surfpool), runs the test suite
```

`anchor init` refuses to run inside an existing Cargo workspace, and the workspace name must be a valid snake_case Rust identifier.

## Project layout

`anchor init` defaults changed in 1.0 — know them:

| Flag | Default (1.1.2) | Notes |
|---|---|---|
| `--template` / `-t` | `multiple` | Splits the program into `constants.rs`, `error.rs`, `state.rs`, `instructions/`. `single` = one `lib.rs`. |
| `--test-template` | `litesvm` | A **Rust** test run via `cargo test` (no validator, no Node). Use `--test-template mocha` for the classic TS suite. |
| `--anchor-version` | `v1` | Stable API. `v2` = experimental anchor-next (git deps) — avoid. |
| local validator | `surfpool` | `anchor test`/`localnet` boot Surfpool (mainnet-forking). Pass `--validator legacy` for `solana-test-validator`. |

Generated workspace:

```
my_project/
├── Anchor.toml                 # workspace config (provider, programs, scripts, toolchain)
├── Cargo.toml                  # virtual workspace manifest (release profile: overflow-checks = true)
├── rust-toolchain.toml         # pins channel = "1.89.0"
├── package.json                # only for TS/JS test templates
├── programs/
│   └── my_project/
│       ├── Cargo.toml          # anchor-lang dep, feature flags (idl-build, cpi, ...)
│       └── src/                # lib.rs (+ constants/error/state/instructions for `multiple`)
├── tests/                      # litesvm: test_initialize.rs ; mocha: my_project.ts
└── target/
    ├── deploy/<name>.so + <name>-keypair.json   # program binary + program-id keypair
    ├── idl/<name>.json                          # generated IDL
    └── types/<name>.ts                          # generated TypeScript types
```

`Anchor.toml` essentials:

```toml
[toolchain]                                  # optional pins (require avm)
anchor_version = "1.1.2"
solana_version = "3.1.10"
package_manager = "yarn"                     # npm | yarn | pnpm | bun (TS templates only)

[features]
resolution = true                            # IDL-based account resolution (default true)
skip-lint = false

[programs.localnet]
my_project = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"   # synced by `anchor keys sync`

[provider]
cluster = "localnet"                         # localnet | devnet | testnet | mainnet | <RPC url>
wallet  = "~/.config/solana/id.json"

[scripts]
test = "cargo test"                          # litesvm/mollusk default; mocha uses ts-mocha
```

`[registry]` was **removed in 1.0** — delete it from old configs. A starter `Anchor.toml` lives at [templates/Anchor.toml](templates/Anchor.toml); the full section reference is in [resources/anchor-reference.md](resources/anchor-reference.md).

## Program anatomy

```rust
use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"); // program's on-chain address

#[program]                          // marks the instruction-handler module
pub mod my_project {
    use super::*;

    // Each pub fn is an instruction. First arg is the Context; the rest are
    // borsh-deserialized instruction args. Return anchor_lang::Result<()>.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_add(1).ok_or(ErrorCode::Overflow)?;
        msg!("count = {}", counter.count);
        Ok(())
    }
}

#[derive(Accounts)]                 // the validated account list for `increment`
pub struct Increment<'info> {
    #[account(mut, seeds = [b"counter"], bump)]
    pub counter: Account<'info, Counter>,
    pub authority: Signer<'info>,
}

#[account]                          // injects the 8-byte discriminator + (de)serialization
#[derive(InitSpace)]               // generates Counter::INIT_SPACE
pub struct Counter {
    pub count: u64,
    pub authority: Pubkey,
}
```

Key pieces:

- **`declare_id!`** sets the program ID and generates `ID`, `id()`, and `check_id()`. `anchor keys sync` keeps it aligned with `target/deploy/<name>-keypair.json`; a mismatch errors at build time (warns in 1.1.1+).
- **`#[program]`** module: every `pub fn` becomes an instruction. The handler signature is `fn name(ctx: Context<T>, ...args) -> Result<()>`.
- **`Context<T>`**: gives `ctx.accounts` (the validated `#[derive(Accounts)]` struct), `ctx.bumps` (resolved PDA bumps), `ctx.program_id`, and `ctx.remaining_accounts`. The 1.0 lifetime form is `Context<'info, T<'info>>` (or inferred `Context<T>`) — **not** the old four-lifetime `Context<'a,'b,'c,'info, T<'info>>`.
- **`Result<()>`** is `anchor_lang::Result` (brought in by the prelude). Errors are `#[error_code]` enums (below).

A complete runnable counter (program + TS test) is in [examples/counter/](examples/counter/); a starter program skeleton is [templates/program-template.rs](templates/program-template.rs).

## Accounts & the constraint system

Pick the **account wrapper type** first — most checks come free with the right type — then add `#[account(..)]` constraints for relationships the type can't express.

| Type | Automatic checks |
|---|---|
| `Account<'info, T>` | owner == this program **and** 8-byte discriminator matches `T`, then deserializes. The single biggest defense (fixes owner + type-cosplay + data-matching at once). |
| `Signer<'info>` | the account signed the transaction. |
| `Program<'info, T>` | key == the program's declared ID and it is executable (e.g. `Program<'info, System>`, `Program<'info, Token>`). `Program<'info>` (no param) validates "is a program". |
| `SystemAccount<'info>` | owner == System Program. |
| `Sysvar<'info, T>` | account is the real sysvar (`Rent`, `Clock`, …) at its canonical address. |
| `InterfaceAccount<'info, T>` | like `Account<T>` but accepts **multiple** owning programs — the key to supporting SPL Token **and** Token-2022. |
| `Interface<'info, T>` | the program account is one of an allowed set (e.g. `Interface<'info, TokenInterface>`). |
| `AccountLoader<'info, T>` | zero-copy (`#[account(zero_copy)]`) on-demand (de)serialization for large/`>10 KiB` accounts; checks owner + discriminator. |
| `LazyAccount<'info, T>` | experimental; defers/streams deserialization to save CU/stack when you read only a few fields (enable the `lazy-account` feature). |
| `UncheckedAccount<'info>` / `AccountInfo<'info>` | **NOTHING.** Anchor forces a `/// CHECK: <reason>` doc comment above the field or the program won't compile — a deliberate speed-bump. Add explicit `address`/`owner`/`constraint` checks. |

Core constraints (the everyday set):

```rust
#[derive(Accounts)]
pub struct Example<'info> {
    #[account(mut)]                                    // writable; persist changes on exit
    pub payer: Signer<'info>,

    #[account(
        init,                                          // create via System CPI + write discriminator
        payer = payer,                                 // who funds rent
        space = 8 + State::INIT_SPACE,                 // 8-byte discriminator + data
        seeds = [b"state", payer.key().as_ref()],      // make it a PDA
        bump                                           // canonical bump (find_program_address)
    )]
    pub state: Account<'info, State>,

    #[account(
        mut,
        has_one = authority,                           // state.authority == authority.key()
        seeds = [b"state", authority.key().as_ref()],
        bump = state.bump,                             // reuse a stored canonical bump (cheaper)
        close = authority                              // close: drain lamports → authority, realloc(0), owner→System
    )]
    pub other: Account<'info, State>,

    #[account(address = crate::ADMIN)]                 // key must equal a specific pubkey
    pub admin: Signer<'info>,

    #[account(owner = token_program.key())]            // on-chain owner program must match
    pub raw: UncheckedAccount<'info>,                  // requires a /// CHECK comment

    #[account(constraint = state.count < MAX @ ErrorCode::TooMany)] // arbitrary boolean + custom error
    pub gated: Account<'info, State>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
```

- **`init` implies `mut`** and is mutually exclusive with it; it needs `payer`, `space`, and a field literally named `system_program`. `init` cannot create accounts > 10 KiB — use `zero` (create in a prior tx) for those.
- **`close = <dest>`** safely closes: transfers all lamports to `<dest>`, reallocs data to length 0, and assigns the owner to the System Program (no legacy `CLOSED_ACCOUNT_DISCRIMINATOR` sentinel in modern Anchor). Requires `mut`.
- **`has_one = x`** checks `account.x == x.key()` (a stored field equals a passed account's key) — it does **not** check that account signed; pair with `Signer`.
- **`init_if_needed`** (feature-gated: `features = ["init-if-needed"]`) creates the account only if missing — but **the handler body still runs** when it already exists, so guard against re-initialization. Prefer two instructions.

### Sizing accounts: `InitSpace`, `#[max_len]`, `space`

`#[derive(InitSpace)]` generates `T::INIT_SPACE` (the byte size of all fields, **excluding** the discriminator). Use `space = 8 + T::INIT_SPACE`. Dynamically sized fields require a max:

```rust
#[account]
#[derive(InitSpace)]
pub struct Profile {
    pub authority: Pubkey,            // 32
    #[max_len(50)]
    pub name: String,                 // 4 + 50
    #[max_len(10)]
    pub tags: Vec<u32>,               // 4 + 10*4
    pub bump: u8,                     // 1
}
// init constraint: space = 8 + Profile::INIT_SPACE
```

For custom (possibly non-8-byte) discriminators (0.31+), use `space = T::DISCRIMINATOR.len() + T::INIT_SPACE`.

### anchor-spl token/mint/ATA constraints

`anchor-spl` constraints let you `init`-create or validate SPL Token and Token-2022 accounts declaratively. Use them with `anchor_spl::token_interface` types to support both programs:

| Group | Sub-constraints | Creates / validates |
|---|---|---|
| `token::` | `mint`, `authority`, `token_program` | a token account |
| `mint::` | `authority`, `decimals`, `freeze_authority`, `token_program` | a mint |
| `associated_token::` | `mint`, `authority`, `token_program` | an Associated Token Account (needs an `associated_token_program` field) |
| `extensions::` | `transfer_hook`, `metadata_pointer`, `permanent_delegate`, `close_authority`, `group_pointer`, `group_member_pointer` (each with sub-keys) | Token-2022 mint extensions (skipped under `init_if_needed`) |

```rust
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = payer,
        associated_token::token_program = token_program,   // thread the runtime token program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,   // accepts SPL Token OR Token-2022
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
```

### Zero-copy for large accounts

Accounts that are large or near the 10 KiB `init` ceiling use `#[account(zero_copy)]` + `AccountLoader`, which (de)serializes on demand instead of copying the whole buffer onto the stack:

```rust
#[account(zero_copy)]
#[repr(C)]
pub struct Orders { pub entries: [u64; 1024] }

#[derive(Accounts)]
pub struct Touch<'info> {
    #[account(mut)]
    pub orders: AccountLoader<'info, Orders>,
}

pub fn touch(ctx: Context<Touch>) -> Result<()> {
    let mut orders = ctx.accounts.orders.load_mut()?;   // load_init() on first init, load() to read
    orders.entries[0] = 1;
    Ok(())
}
```

This is the SKILL-level summary. The **exhaustive** constraint reference — every constraint, `realloc`/`realloc::zero`, `seeds::program`, `rent_exempt`, `executable`, and all anchor-spl `token::*` / `mint::*` / `associated_token::*` / `extensions::*` constraints — is in [docs/account-constraints.md](docs/account-constraints.md).

## PDAs

Program Derived Addresses are deterministic, off-curve addresses a program can sign for. Anchor's `seeds`/`bump` constraint derives them with `find_program_address` (the **canonical**, highest valid bump) and rejects any other bump — closing the non-canonical-bump attack.

```rust
#[derive(Accounts)]
pub struct Init<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init, payer = signer, space = 8 + Data::INIT_SPACE,
        seeds = [b"data", signer.key().as_ref()],   // domain-specific seeds avoid PDA sharing across users
        bump
    )]
    pub data: Account<'info, Data>,
    pub system_program: Program<'info, System>,
}

pub fn init(ctx: Context<Init>) -> Result<()> {
    ctx.accounts.data.bump = ctx.bumps.data;  // store the canonical bump on first init
    Ok(())
}
```

**Store the bump** on init (`ctx.bumps.<field>`), then re-derive with `bump = data.bump` on later instructions to skip the 255-iteration canonical search. `ctx.bumps` is a generated struct (`ctx.bumps.data`), not the pre-0.29 `ctx.bumps.get("data")` HashMap. Deep PDA design patterns (seed collisions, signer seeds, cross-program seeds) live in [docs/cpi-and-pdas.md](docs/cpi-and-pdas.md).

## CPI (Cross-Program Invocation)

Anchor wraps CPIs in a typed `CpiContext`. Calls made through the generated CPI modules verify the target program ID for you (mitigating arbitrary-CPI attacks).

```rust
use anchor_spl::token_interface::{self, TransferChecked, TokenInterface, Mint, TokenAccount};

// Plain CPI (program signs as a normal signer):
let cpi = CpiContext::new(
    ctx.accounts.token_program.key(),          // 1.x: program id (Pubkey), NOT to_account_info()
    TransferChecked {
        from:      ctx.accounts.from.to_account_info(),
        mint:      ctx.accounts.mint.to_account_info(),
        to:        ctx.accounts.to.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    },
);
token_interface::transfer_checked(cpi, amount, ctx.accounts.mint.decimals)?;

// PDA-signed CPI (the program signs on behalf of a PDA it controls):
let seeds: &[&[u8]] = &[b"vault", authority_key.as_ref(), &[vault_bump]];
let cpi = CpiContext::new_with_signer(
    ctx.accounts.token_program.key(),          // 1.x: program id (Pubkey)
    TransferChecked { /* ... */ },
    &[seeds],
);
token_interface::transfer_checked(cpi, amount, decimals)?;
```

The matching dual-program `#[derive(Accounts)]` — one code path for SPL Token (`Tokenkeg…`) **and** Token-2022 (`Tokenz…`):

```rust
#[derive(Accounts)]
pub struct Transfer<'info> {
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub from: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,   // validated set: Token or Token-2022
}
```

Use **`anchor_spl::token_interface`** (not `anchor_spl::token`) with `InterfaceAccount` + `Interface<'info, TokenInterface>` so the same code path serves **both SPL Token and Token-2022** — thread the runtime token program through `token::token_program` constraints and pass it as the CPI program. Always use `transfer_checked` (never `transfer`) for Token-2022 correctness. The System Program has its own helpers: `anchor_lang::system_program::{Transfer, transfer}`. After a CPI mutates an account you also hold, call `ctx.accounts.<acct>.reload()?` before reading the new value — Anchor deserializes once at entry and the in-memory struct is otherwise stale. Return data is handled with `set_return_data`/`get_return_data`. Full CPI deep dive (SPL/Token-2022, system, custom programs, `invoke_signed`, return data) is in [docs/cpi-and-pdas.md](docs/cpi-and-pdas.md).

## Errors

```rust
#[error_code]
pub enum ErrorCode {
    #[msg("Only the authority can perform this action")]
    Unauthorized,                 // -> error code 6000
    #[msg("Arithmetic overflow")]
    Overflow,                     // -> 6001
}
```

Custom error codes start at **6000** (Anchor reserves 0–5999 for framework/constraint errors). Raise them with the `require!` family or `err!`/`error!`:

```rust
require!(amount > 0, ErrorCode::Overflow);
require_keys_eq!(ctx.accounts.state.authority, signer.key(), ErrorCode::Unauthorized);
require_neq!(a, b, ErrorCode::Unauthorized);
return err!(ErrorCode::Unauthorized);
```

Anchor 1.0 allows **only one `#[error_code]` enum per program**. Members: `require!`, `require_eq!`, `require_neq!`, `require_keys_eq!`, `require_keys_neq!`, `require_gt!`, `require_gte!`. Each aborts the transaction cleanly with your code and message (surfaced in client logs).

## Events

```rust
#[event]
pub struct Transferred {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

// In a handler:
emit!(Transferred { from, to, amount });          // logs via sol_log_data ("Program Data:" base64)
emit_cpi!(Transferred { from, to, amount });      // emits via a self-CPI (data in instruction data)
```

| | `emit!` | `emit_cpi!` |
|---|---|---|
| Mechanism | `sol_log_data` syscall (program logs) | self-CPI (event data in instruction data) |
| Cost | Cheap | Extra CU |
| Reliability | RPC log providers can truncate long logs | Harder to truncate/drop |
| Setup | none | enable `features = ["event-cpi"]` **and** add `#[event_cpi]` to the instruction's `#[derive(Accounts)]` struct |

Use `emit!` for routine logs; use `emit_cpi!` when an indexer must not miss the event. `#[event]` structs carry an 8-byte discriminator (overridable with `discriminator = ...`).

## IDL & clients

`anchor build` generates `target/idl/<name>.json` (the interface) and `target/types/<name>.ts` (TypeScript types) via the program's `idl-build` feature: `idl-build = ["anchor-lang/idl-build"]` (add `"anchor-spl/idl-build"` when using anchor-spl). Never enable `idl-build` in a normal build — it is build-time only.

The **on-chain IDL** is now stored by the **Program Metadata Program** (`ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`) at a deterministic PDA — a client can be generated from a Program ID alone. `anchor deploy` uploads the IDL by default (`--no-idl` to skip); `anchor idl init`/`upgrade` no longer take a program-id positional arg (read from `idl.address`).

Typed TS client (the **2-arg** `Program` constructor — the 3-arg form is gone):

```ts
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Counter } from "../target/types/counter"; // generated by `anchor build`

anchor.setProvider(anchor.AnchorProvider.env());          // reads ANCHOR_PROVIDER_URL + ANCHOR_WALLET
const program = anchor.workspace.Counter as Program<Counter>; // workspace = PascalCase program name

await program.methods
  .increment()
  .accounts({ counter, authority: program.provider.publicKey })
  .rpc();

// Outside a workspace, construct from the IDL (program id comes from IDL.address):
import IDL from "../target/idl/counter.json";
const prog = new Program<Counter>(IDL, provider);
```

`.accounts()` does strict resolution and rejects unknown keys; use `.accountsPartial()` to pass a subset and let Anchor resolve the rest. For multi-language clients (Rust/Go/JS), generate with **Codama** (`[clients]` table in `Anchor.toml`, `auto = true`). Client/IDL details are in [resources/anchor-reference.md](resources/anchor-reference.md).

## Migrating from 0.30/0.31/0.32 to 1.x

A large installed base is still on 0.30/0.31. The constraint system is stable across all of them — these are the code-affecting deltas when moving to 1.x:

| Area | 0.30/0.31/0.32 | 1.x | Action |
|---|---|---|---|
| TS package | `@coral-xyz/anchor` (frozen at 0.32.1) | `@anchor-lang/core@1.1.2` | Rename every import; import IDL types from the root. |
| `Program` constructor | `new Program(idl, programId, provider)` (3-arg, pre-0.30) | `new Program<T>(IDL, provider)` (2-arg, id from `IDL.address`) | Drop the program-id arg (changed in 0.30). |
| `Context` lifetimes | `Context<'a,'b,'c,'info, T<'info>>` | `Context<'info, T<'info>>` / inferred `Context<T>` | Simplify signatures. |
| `ctx.bumps` | `ctx.bumps.get("name")` (HashMap, pre-0.29) | `ctx.bumps.name` (struct field) | Replace `.get(...)`. |
| Error enums | multiple `#[error_code]` allowed | exactly **one** per program | Merge enums. |
| `solana-program` dep | sometimes a separate crate | use `anchor_lang::solana_program::*` | Remove the separate dep (0.32 split it). |
| On-chain IDL | legacy Anchor IDL account instructions | **Program Metadata Program** (`ProgM6…`) | Close legacy IDL accounts with the 0.32.1 CLI **before** upgrading a deployed program to 1.0. |
| Discriminators | fixed 8-byte; `T::discriminator()` method | `DISCRIMINATOR` const; custom `#[account(discriminator = …)]` (0.31+); non-8-byte allowed | Use the const; size `init` with `T::DISCRIMINATOR.len() + T::INIT_SPACE`. |
| Solana | 2.x supported | **3.0+ required** (CI pins 3.1.10) | Upgrade the toolchain (MSRV rustc 1.89). |
| Test/validator defaults | ts-mocha + `solana-test-validator` | litesvm (Rust) + Surfpool | Add `--test-template mocha` / `--validator legacy` to keep the old flow. |

Full migration matrix and the avm reference are in [resources/version-compatibility.md](resources/version-compatibility.md).

## Testing

| Need | Use | Why |
|---|---|---|
| Fast Rust unit test of one instruction; assert exact compute units; CU regression benches | **Mollusk** (`mollusk-svm` 0.13.4 + `mollusk-svm-bencher`) | Lightest; no Bank/AccountsDB; you control every account; markdown CU diff. |
| Rust integration test: full tx, multiple programs, CPIs, sysvar/time travel, token flows | **LiteSVM (Rust crate)** | In-process SVM; the Anchor 1.x default test template (`cargo test`). |
| TS tests with a typed Anchor `Program<T>` (`.methods.x().rpc()`, `.account.fetch`) | **anchor-litesvm** (`LiteSVMProvider` + `fromWorkspace`) | Drop-in `AnchorProvider`; fast, no validator. |
| Legacy TS suite already on bankrun | **anchor-bankrun** (`startAnchor` + `BankrunProvider`) | Works, but **deprecated** — migrate to anchor-litesvm. |
| End-to-end / RPC behavior / mainnet fork / cheatcodes | **Surfpool** (Anchor 1.x default for `anchor test`) | Closest to mainnet. |
| Maximal fidelity, official validator, faucet | **solana-test-validator** (`anchor test --validator legacy`) | Canonical; slowest. |

One-line rule: **Mollusk** for instruction-level unit tests + CU budgets → **LiteSVM** for integration tests → **Surfpool/solana-test-validator** for e2e. Treat `solana-bankrun`/`anchor-bankrun` (last shipped 2024-10-17, pinned to `@coral-xyz/anchor`) as legacy. Runnable examples are in [examples/tests/](examples/tests/) (`litesvm.test.ts`, `bankrun.test.ts`, `mollusk.rs`); the full guide — APIs, fixtures, time/slot travel, parameterized tests — is in [docs/testing.md](docs/testing.md).

## Security

Anchor closes most of the classic **Sealevel attacks** by construction when you use the right type/constraint. Summary (full catalog with insecure→secure code in [docs/security.md](docs/security.md)):

| # | Attack class | Anchor mitigation |
|---|---|---|
| 1 | Missing signer | `Signer<'info>` / `#[account(signer)]` |
| 2 | Missing owner check | `Account<'info, T>` / `#[account(owner = …)]` / typed token wrapper |
| 3 | Type cosplay / data matching | `#[account]` 8-byte discriminator via `Account<T>`; `has_one` / `constraint` |
| 4 | Arbitrary CPI | `Program<'info, T>` / `Interface<TokenInterface>` + `token::token_program`; Anchor CPI modules verify the target ID |
| 5 | Authority confusion | `#[account(has_one = authority)]` + `Signer` |
| 6 | Non-canonical bump / PDA sharing | `#[account(seeds = […], bump)]` (canonical) + domain-specific seeds; `bump = acct.bump` |
| 7 | Reinitialization | `#[account(init, …)]`; avoid `init_if_needed`, or guard with an `is_initialized` flag |
| 8 | Integer overflow/underflow | `overflow-checks = true` **and** `checked_add/sub/mul/div` |
| 9 | Closing / revival | `#[account(mut, close = dest)]` (drain + realloc(0) + assign to System) |
| 10 | Duplicate mutable accounts | Rejected by default for two mutable `Account<T>` (`ConstraintDuplicateMutableAccount`, 2040); `#[account(mut, dup)]` to allow intentionally; `constraint = a.key() != b.key()` for non-serializing types |
| 11 | Sysvar / account substitution | `Clock::get()` / `Rent::get()`; `Sysvar<T>`; `#[account(address = …)]` |
| 12 | `remaining_accounts` trust | none of Anchor's checks apply — manually verify owner + discriminator + address + PDA per account |
| 13 | Rounding / precision | round toward the protocol; `u128` intermediates; `checked_div`/`div_ceil`; no floats |

Two classes Anchor **cannot** fix declaratively — integer overflow (#8) and rounding/precision (#13) — require code review and boundary-value tests. After any CPI that mutates an account you still read, `reload()?` it.

## Deploy & upgrade

Programs deploy via the **Upgradeable BPF Loader** (`BPFLoaderUpgradeab1e11111111111111111111111`), producing a Program account, a ProgramData account (holds the bytes + upgrade authority), and a transient Buffer.

```bash
anchor build                                              # or `solana-verify build` for a verifiable artifact
solana program deploy ./target/deploy/my_program.so       # first deploy → permanent Program ID
anchor upgrade ./target/deploy/my_program.so --program-id <ID>   # in-place upgrade (same ID)
solana program set-upgrade-authority <ID> --new-upgrade-authority <SQUAD_VAULT_PDA>   # hand to a multisig
solana program set-upgrade-authority <ID> --final         # make immutable (irreversible)
```

For mainnet, ship a **verifiable build** so explorers and users can confirm the on-chain bytecode matches public source (`solana-verify` 0.5.1; deterministic Docker build → hash → OtterSec registry `verify.osec.io`):

```bash
solana-verify build                                          # deterministic Docker build (do NOT re-run anchor build after)
solana program deploy -u <RPC> target/deploy/<lib>.so --program-id <ID> \
  --with-compute-unit-price 50000 --max-sign-attempts 100 --use-rpc
solana-verify get-program-hash -u <RPC> <ID>                 # must equal get-executable-hash of the .so
solana-verify verify-from-repo -u <RPC> --program-id <ID> https://github.com/<org>/<repo> \
  --commit-hash <SHA> --library-name <lib>                   # uploads the verification PDA
solana-verify remote submit-job --program-id <ID> --uploader <UPLOADER_PUBKEY>   # mainnet OtterSec job
```

Put the **upgrade authority behind a Squads multisig** so upgrades are M-of-N (`solana program set-upgrade-authority <ID> --new-upgrade-authority <SQUAD_VAULT_PDA>`). `--final` and `solana program close <id>` are irreversible (a closed Program ID can never be reused; never overwrite a verified `.so` before deploying it). The complete flow — buffers, failed-deploy recovery, on-chain IDL via the Program Metadata Program, Squads-governed upgrades, rent/size, `extend` — is in [docs/deployment-and-upgrades.md](docs/deployment-and-upgrades.md).

## Guidelines

**DO**

- DO pin versions: `anchor-lang`/`anchor-spl` `1.1.2`, Rust `1.89.0`, Solana CLI `3.1.10`; import the TS client from `@anchor-lang/core`.
- DO let account **types** do the work (`Account`, `Signer`, `Program`, `InterfaceAccount`); add `has_one`/`address`/`constraint` for relationships.
- DO store the canonical bump (`ctx.bumps.<field>`) on init and reuse it with `bump = stored`.
- DO use `#[derive(InitSpace)]` + `#[max_len]` and `space = 8 + T::INIT_SPACE` — never hand-count bytes you can derive.
- DO use **checked math** (`checked_add`/`checked_sub`/`checked_mul`/`checked_div`) and keep `overflow-checks = true` in the release profile.
- DO use `anchor_spl::token_interface` + `InterfaceAccount` + `transfer_checked` to support SPL Token and Token-2022 from one code path.
- DO `reload()?` an account after a CPI mutates it before reading the new value.
- DO `anchor keys sync` after generating program keypairs; verify builds with `solana-verify` for mainnet.

**DON'T**

- DON'T use `init_if_needed` without a re-initialization guard (and remember its body runs even when the account exists; `extensions::*` checks are skipped under it).
- DON'T add a separate `solana-program` dependency — use `anchor_lang::solana_program::*` (Anchor split it into smaller crates; a separate dep causes version-conflict build errors).
- DON'T trust `ctx.remaining_accounts` or `UncheckedAccount`/`AccountInfo` without explicit checks (and a `/// CHECK:` justification).
- DON'T assume Anchor ignores duplicate accounts — 1.0+ **rejects** two mutable `Account<T>` with the same key (2040). Use `#[account(mut, dup)]` only when a duplicate is intentional, and `constraint = a.key() != b.key()` for non-serializing types (`Signer`/`UncheckedAccount`/…, which the default check doesn't cover).
- DON'T mix `@coral-xyz/anchor` and `@anchor-lang/core` in one project (two incompatible `Program`/`BN` types).
- DON'T hand-roll account closing by zeroing lamports — use `close = <dest>`.
- DON'T overwrite a verified `.so` with `anchor build`/`cargo build-sbf` before deploying it — the on-chain hash won't match.

## Common Errors

### Error: `DeclaredProgramIdMismatch` / "program ID in declare_id! does not match"
**Cause** The pubkey in `declare_id!` differs from `target/deploy/<name>-keypair.json` (e.g. after `anchor build` generated a fresh keypair, or you copied a template without updating the ID).
**Solution** Run `anchor keys sync` to rewrite `declare_id!` and `Anchor.toml` from the keypair, then rebuild. To bypass during early prototyping: `anchor build --ignore-keys` (1.1.1+ warns instead of aborting).

### Error: `AccountNotInitialized` (code 3012)
**Cause** An instruction expects an existing `Account<T>` (e.g. a PDA) that has never been created, or you passed the wrong address/seeds so the derived account doesn't exist on-chain.
**Solution** Create the account first (an `init` instruction), or fix the seeds. Use `init_if_needed` (with a guard) only if create-or-use in one instruction is genuinely required.

### Error: `ConstraintSeeds` — "A seeds constraint was violated" (code 2006)
**Cause** The account passed doesn't match the PDA derived from your `seeds`/`bump` — wrong seed bytes, wrong order, a stale/non-canonical bump, or the client derived the PDA differently than the program.
**Solution** Make the client derive with the identical seeds and `findProgramAddressSync`. If you pass `bump = stored`, ensure the stored value is the canonical bump (`ctx.bumps.<field>`), not an attacker- or client-supplied one.

### Error: `AccountDidNotSerialize` / "Failed to serialize the account" (space too small)
**Cause** `space` is too small for the data — usually a forgotten `+ 8` discriminator, a `String`/`Vec` larger than its `#[max_len]`, or a struct that grew without bumping `space`.
**Solution** Use `space = 8 + T::INIT_SPACE` with `#[derive(InitSpace)]`; raise `#[max_len(N)]`; for already-deployed accounts that must grow, use `realloc`.

### Error: IDL build / discriminator failures (`anchor build` fails generating the IDL)
**Cause** Missing `idl-build` feature wiring (especially with anchor-spl), an unsupported IDL field type (1.0 hard-errors on e.g. tuple fields previously dropped), or a stale `target/idl`.
**Solution** Set `idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]` in the program `Cargo.toml`; remove unsupported types from public instruction/account signatures; `anchor clean && anchor build`.

### Error: `Cannot find module '@coral-xyz/anchor'` / "wrong number of arguments to Program"
**Cause** Code/tutorial targets the old TS scope or the old 3-arg `Program` constructor.
**Solution** Install and import **`@anchor-lang/core@1.1.2`**; use the 2-arg `new Program<T>(IDL, provider)` (program ID comes from `IDL.address`). Import generated types from `../target/types/<name>`.

### Error: "anchor test" fails to start a validator / Surfpool not found
**Cause** Anchor 1.x defaults `anchor test`/`localnet` to **Surfpool**, which isn't installed (CI assuming `solana-test-validator` breaks here).
**Solution** Install Surfpool (≥ 1.1.2), or run `anchor test --validator legacy` to use `solana-test-validator`.

For a broader build/test/deploy error catalog, see [docs/troubleshooting.md](docs/troubleshooting.md).

## Files in This Skill

```
anchor/
├── SKILL.md                              # this file — entry point
├── docs/
│   ├── account-constraints.md            # exhaustive constraint reference (incl. anchor-spl token/mint/ATA/extensions)
│   ├── cpi-and-pdas.md                   # CPI deep dive (SPL/Token-2022, system, custom), invoke_signed, return data, PDA patterns
│   ├── testing.md                        # Mollusk / LiteSVM / anchor-litesvm / bankrun (legacy); fixtures, time travel
│   ├── security.md                       # Sealevel-attacks catalog: insecure → secure → Anchor mitigation
│   ├── deployment-and-upgrades.md        # build/deploy/upgrade, buffers, on-chain IDL, solana-verify, Squads
│   └── troubleshooting.md                # build/test/deploy error catalog with fixes
├── resources/
│   ├── anchor-reference.md               # macros/attributes, CLI, Anchor.toml, feature flags
│   └── version-compatibility.md          # Anchor ↔ Solana/Agave ↔ Rust ↔ anchor-spl matrix; avm; 0.3x → 1.x deltas
├── examples/
│   ├── counter/                          # lib.rs + tests/counter.ts — init + increment with InitSpace + events
│   ├── escrow/                           # lib.rs — PDA escrow with anchor-spl transfers (deposit/take/refund)
│   ├── token-vault/                      # lib.rs — InterfaceAccount vault for SPL Token AND Token-2022
│   └── tests/                            # litesvm.test.ts, bankrun.test.ts, mollusk.rs
└── templates/
    ├── program-template.rs               # starter program skeleton
    ├── Cargo-program.toml                # program-crate manifest (anchor-lang/anchor-spl 1.1.2, idl-build)
    ├── Anchor.toml                       # starter workspace config
    ├── rust-toolchain.toml               # pins rustc 1.89.0
    └── tests-template.ts                 # starter TS test (ts-mocha / @anchor-lang/core)
```

## References

- Anchor docs (1.x): https://www.anchor-lang.com/docs
- Anchor repository (solana-foundation): https://github.com/solana-foundation/anchor
- Account constraints reference: https://www.anchor-lang.com/docs/references/account-constraints
- Account types reference: https://www.anchor-lang.com/docs/references/account-types
- Events (`emit!` vs `emit_cpi!`): https://www.anchor-lang.com/docs/features/events
- 1.0.0 release notes (breaking changes): https://www.anchor-lang.com/docs/updates/release-notes/1-0-0
- anchor-spl (docs.rs): https://docs.rs/anchor-spl/latest/anchor_spl/
- `anchor_spl::token_interface` (SPL Token + Token-2022): https://docs.rs/anchor-spl/latest/anchor_spl/token_interface/index.html
- Sealevel attacks (security patterns): https://github.com/coral-xyz/sealevel-attacks
- Solana program security course: https://github.com/solana-foundation/developer-content/tree/main/content/courses/program-security
- Deploying programs: https://solana.com/docs/programs/deploying
- Verifiable builds (`solana-verify`): https://solana.com/docs/programs/verified-builds
