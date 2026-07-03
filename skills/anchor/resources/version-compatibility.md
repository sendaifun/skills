# Version Compatibility & Migration

The Anchor ⇄ Solana/Agave ⇄ Rust ⇄ anchor-spl matrix, avm usage, recommended pins, and the
**0.30/0.31/0.32 → 1.0/1.1 migration delta list** — the single most useful thing to have open when
upgrading an existing program or reading a pre-1.0 tutorial.

> Bottom line: target **Anchor 1.1.2** (the current stable line). `0.32.1` was the last 0.x release
> and is now legacy/migration context. The TS client is **`@anchor-lang/core`** (NOT
> `@coral-xyz/anchor`, frozen at 0.32.1). The experimental `v2`/anchor-next API is unpublished — do
> not use it (see §6).

---

## 1. Compatibility matrix (Anchor 1.1.2)

| Component | Pin for Anchor 1.1.2 | Notes |
|---|---|---|
| `anchor-lang` (crate) | **1.1.2** | crates.io `max_stable_version`. (`newest_version` shows `1.0.3`, a back-port published *after* 1.1.2 — ignore it.) |
| `anchor-cli` | **1.1.2** | what `avm install latest` installs today. |
| `anchor-spl` (crate) | **1.1.2** | keep equal to `anchor-lang`. |
| `@anchor-lang/core` (npm) | **1.1.2** | renamed from `@coral-xyz/anchor`; still depends on `@solana/web3.js` v1 (not Kit). |
| Rust (MSRV) | **1.89.0** | set in 1.1.0 (`anchor-syn` → `syn 2.0`); `rust-toolchain.toml` pins `channel = "1.89.0"`. |
| Solana CLI / Agave (tested) | **3.1.10** | Anchor 1.0 CI/Docker + `solana-verify` pin this. Install: `release.anza.xyz/v3.1.10/install`. |
| Solana minimum | **3.0+** | Anchor 1.x **dropped Solana 2.x**. |
| Latest Agave stable (reference) | **4.1.0** (2026-06-26) | newer than what Anchor tests — pin 3.1.10 for verifiable/reproducible builds. |
| Node.js (TS test template) | **>= 20.18** | `engines.node` set in 1.1.0. |
| Borsh (Rust + TS) | **1.5.7** | bumped in 1.0. |
| Anchor IDL spec | **0.1.3** | bumped in 1.1.0. |

> **Reproducible-build gotcha:** the generic installer
> `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` currently installs Agave **4.1.0**.
> For verifiable builds, pin the **tested** combo — Solana **3.1.10** — with
> `release.anza.xyz/v3.1.10/install`, and set `[workspace.metadata.cli] solana = "3.1.10"` so
> `solana-verify` selects it.

### Companion tool versions

| Tool | Version | Used for |
|---|---|---|
| `avm` | **1.0.1** | install/pin the Anchor CLI. |
| `solana-verify` | **0.5.1** | verifiable builds (repo `solana-foundation/solana-verifiable-build`). |
| `@solana-program/program-metadata` (npm) | **0.7.0** | backs the on-chain IDL (Program Metadata Program). |
| `solana-security-txt` (crate) | **1.1.1** | `security_txt!` in the binary. |
| Anchor verifiable Docker image | `quay.io/ottersec/anchor:<version>` | e.g. `:v1.1.2`. |
| `litesvm` (Rust crate) | **0.13.0** | default Rust test template SVM. |
| `mollusk-svm` (crate) | **0.13.4** | per-instruction unit tests + CU benches. |

---

## 2. Release timeline (code-affecting)

| Version | Published | Highlights |
|---|---|---|
| **v1.1.2** | 2026-06-26 | current stable; tightened inter-crate deps. |
| v1.1.1 | 2026-06-25 | keypair/`declare_id!` mismatch → warning (was error); `idl fetch-historical`. |
| v1.1.0 | 2026-06-24/25 | **MSRV → rustc 1.89**, `syn 2.0`; `verifiedBuild` → OtterSec registry (`verify.osec.io`); IDL spec 0.1.3; Node ≥ 20.18; versioned-tx client support; refuses nesting in a Cargo workspace; named scripts. |
| v1.0.3 | 2026-06-26 | back-port patch to the 1.0 line (published after 1.1.2). |
| v1.0.2 / v1.0.1 | 2026-05-02 / 04-21 | patches. |
| **v1.0.0** | 2026-04-02 | **MAJOR** — see §4. TS package rename, Solana 3.0+, native CLI, Surfpool/LiteSVM defaults, Program Metadata IDL, single `#[error_code]`, `Context` lifetime simplification. |
| v0.32.1 / v0.32.0 | 2025-10-09 / 10-08 | last 0.x; `solana-program` split into smaller crates; `anchor verify` wraps `solana-verify`; `anchor deploy` uploads IDL by default; removed `anchor publish`. |
| v0.31.1 / v0.31.0 | 2025-04-19 / 03-08 | **custom discriminators**; `discriminator()` method removed → `DISCRIMINATOR` const (non-8-byte allowed); `LazyAccount`; Solana → v2. |
| v0.30.1 / v0.30.0 | 2024-06-20 / 04-15 | new IDL spec; `declare_program!`; `#[derive(InitSpace)]`; Token-2022 in anchor-spl; `accountsPartial()`. |

The repo moved from `coral-xyz/anchor` to **`github.com/solana-foundation/anchor`** (OtterSec
maintains it); old links redirect.

---

## 3. avm usage & recommended pins

```bash
# Install avm (built from the solana-foundation repo), then Anchor:
cargo install --git https://github.com/solana-foundation/anchor avm --force
avm install 1.1.2
avm use 1.1.2                  # REQUIRED after install — selects the active CLI

# Pin the tested Solana toolchain (do NOT take `stable`, which is Agave 4.1.0):
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.10/install)"

# Verify the trio:
anchor --version              # anchor-cli 1.1.2
solana --version              # 3.1.10 (Agave)
rustc  --version              # 1.89.0
```

| Command | Purpose |
|---|---|
| `avm install <ver\|latest\|latest-pre-release\|<commit>>` | install (`--force`, `--from-source`, `--path`). |
| `avm use <ver\|latest>` | switch active version (required after install). |
| `avm list [--pre-release]` | list installed versions. |
| `avm update [--pre-release]` | update to latest. |
| `avm self-update [--pre-release\|--from-commit]` | update avm itself. |
| `avm uninstall <ver>` | remove a version. |

`$AVM_HOME` overrides the storage dir (default `~/.avm`). Resolution order for the Solana version:
`[toolchain] solana_version` in `Anchor.toml` → `solana-program` dep in `Cargo.toml` → Anchor's
recommended mapping. Use an exact comparator (`= "3.1.10"`) to pin one installer.

**Pin everything in source** so collaborators and CI reproduce the build:

```toml
# programs/<name>/Cargo.toml
anchor-lang = "1.1.2"
anchor-spl  = "1.1.2"

# rust-toolchain.toml (written by `anchor init`)
[toolchain]
channel = "1.89.0"

# Anchor.toml
[toolchain]
anchor_version = "1.1.2"
solana_version = "3.1.10"
```

```jsonc
// package.json — TS client (NOT @coral-xyz/anchor)
{ "dependencies": { "@anchor-lang/core": "1.1.2" } }
```

---

## 4. Migration delta list — 0.30/0.31/0.32 → 1.x

The constraint system is **stable** across all of these versions; these are the code-affecting changes
when moving a program (and its client) to 1.x. Dual coverage of old + new is a real differentiator —
most existing on-chain programs and tutorials are still on 0.30/0.31.

### TypeScript / client

| Area | Pre-1.0 | 1.x | Action |
|---|---|---|---|
| TS package | `@coral-xyz/anchor` (frozen at 0.32.1) | **`@anchor-lang/core@1.1.2`** | Rename every import; IDL types import from the root. Don't mix the two scopes (incompatible `Program`/`BN`/web3.js copies). |
| `Program` constructor | `new Program(idl, programId, provider)` (3-arg, pre-0.30) | **`new Program<T>(IDL, provider)`** (2-arg; id from `IDL.address`) | Drop the program-id arg. |
| Workspace handle | `anchor.workspace.myProgram` | `anchor.workspace.MyProgram as Program<T>` (PascalCase) | Adjust casing + cast. |
| Account resolution | `.accounts()` loose | `.accounts()` strict; `.accountsPartial()` for subsets | Use `accountsPartial` where you relied on partial resolution. |
| `DISCRIMINATOR_SIZE` (TS) | constant existed | removed; lengths read dynamically | Don't assume 8. |

### Rust / program

| Area | Pre-1.0 | 1.x | Action |
|---|---|---|---|
| `Context` lifetimes | `Context<'a,'b,'c,'info, T<'info>>` | **`Context<'info, T<'info>>`** / inferred `Context<T>` | Simplify handler signatures. |
| `ctx.bumps` | `ctx.bumps.get("name")` (HashMap, pre-0.29) | `ctx.bumps.name` (struct field) | Replace `.get(...)`. |
| Error enums | multiple `#[error_code]` allowed | **exactly one** per program | Merge enums. |
| `solana-program` dep | sometimes a separate crate | `anchor_lang::solana_program::*` | Remove the separate dep (0.32 split it into small crates). |
| Discriminators | fixed 8-byte; `T::discriminator()` method | **`DISCRIMINATOR` const**; custom `#[account(discriminator = …)]` (0.31+); non-8-byte allowed | Use the const; size `init` with `T::DISCRIMINATOR.len() + T::INIT_SPACE`. |
| `#[interface(…)]` | discriminator override attribute | **removed** | Use `#[instruction(discriminator = …)]`. |
| `#[interface]` feature | `interface-instructions` | removed | drop the feature. |
| Duplicate mutable accounts | silently allowed | **rejected by default** (2040) | Pass distinct accounts; `#[account(mut, dup)]` to allow a duplicate intentionally; `constraint = a.key() != b.key()` for non-serializing types. |
| `AccountInfo` in Accounts | fine | **deprecated** (compile warning) | Prefer typed accounts or `UncheckedAccount` + `/// CHECK:`. |
| Borsh | older | **1.5.7** | bump. |
| New types | — | `Program<'info>` (no param), `Migration<'info, From, To>` | available 1.0+. |

### Tooling / deploy / IDL

| Area | Pre-1.0 | 1.x | Action |
|---|---|---|---|
| On-chain IDL | legacy Anchor IDL account instructions | **Program Metadata Program** (`ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`) at a deterministic PDA | **Close legacy IDL accounts with the 0.32.1 CLI BEFORE upgrading a deployed program to 1.0** (1.0 removed the old instructions). |
| `idl init`/`idl upgrade` arg | required positional `program-id` | optional (read from `idl.address`) | drop the arg if you want. |
| `anchor deploy` IDL upload | manual | uploads IDL by default | `--no-idl` to skip. |
| CLI ↔ `solana` binary | shells out to `solana` | **native** (`deploy`/`airdrop`/`balance`/`address`) | `solana` need not be on `PATH`. |
| Keypair vs `declare_id!` | unchecked | build-time check (error in 1.0, warning in 1.1.1) | `anchor keys sync`. |
| Verified builds | `anchor publish`/`apr.dev` | `anchor verify` wraps `solana-verify`; OtterSec registry `verify.osec.io` | use `solana-verify` (0.5.1); Docker `quay.io/ottersec/anchor:<ver>`. |
| `[registry]` / `anchor login` | present | **removed** | delete from `Anchor.toml`. |
| Solana | 2.x supported | **3.0+ required** (CI pins 3.1.10) | upgrade toolchain (MSRV rustc 1.89). |
| Test/validator defaults | ts-mocha + `solana-test-validator` | **litesvm (Rust) + Surfpool** | add `--test-template mocha` / `--validator legacy` to keep the old flow. |
| `anchor init` location | anywhere | **refuses nesting in an existing Cargo workspace** (1.1.0) | run in a fresh dir. |

### Minimal "is my repo on 1.x?" checklist

1. `package.json` uses `@anchor-lang/core` (not `@coral-xyz/anchor`).
2. `Program` is constructed with 2 args; types come from `target/types/<name>`.
3. Program `Cargo.toml`: `anchor-lang = "1.1.2"`, no separate `solana-program`, `idl-build` wired.
4. One `#[error_code]` enum; `Context<'info, T<'info>>` signatures; `ctx.bumps.<field>`.
5. `rust-toolchain.toml` → `1.89.0`; Solana CLI `3.1.10`.
6. `Anchor.toml` has no `[registry]`; on-chain IDL via the Program Metadata Program.
7. Legacy IDL accounts closed (with the 0.32.1 CLI) before the first 1.0 upgrade.

---

## 5. Quick gotcha cheat-sheet

1. `0.32.1` is **not** current — it's the last 0.x. Use **1.1.2**. TS = `@anchor-lang/core`.
2. No separate `solana-program` dep — `anchor_lang::solana_program::*`.
3. Solana 2.x unsupported; need 3.0+; pin 3.1.10 for verifiable builds (`stable` = Agave 4.1.0).
4. `apr.dev` is dead — verified-build registry is `verify.osec.io`; `anchor verify` wraps `solana-verify`.
5. Duplicate mutable `Account<T>` error by default (2040); `#[account(mut, dup)]` to allow one, or `constraint = a.key() != b.key()` for non-serializing types.
6. `Context` lifetimes simplified to `Context<'info, T<'info>>`.
7. `init` space = discriminator + data (`8 + T::INIT_SPACE`, or `T::DISCRIMINATOR.len() + T::INIT_SPACE`).
8. `emit_cpi!` needs the `event-cpi` feature **and** `#[event_cpi]`.
9. On-chain IDL via the Program Metadata Program; close old IDL accounts before a 1.0 upgrade.
10. `anchor init` won't nest in a Cargo workspace; default test = LiteSVM, default validator = Surfpool.
11. Verifiable Docker image is `quay.io/ottersec/anchor:<ver>` (not `solanafoundation/anchor`).
12. MSRV rustc 1.89; the generated `rust-toolchain.toml` pins it.

---

## 6. The experimental `v2` / "anchor-next" API — DO NOT USE

`anchor init --anchor-version v2` generates a redesigned, **unpublished** API. It pulls
`anchor-lang-v2` from a **git branch** (not crates.io) and uses `wincode` serialization instead of
borsh. Confirmed: `anchor-lang-v2` and `anchor-spl-v2` are **not on crates.io**.

```toml
# v2 deps are git-only — not production-ready:
anchor-lang-v2 = { git = "https://github.com/solana-foundation/anchor.git", branch = "anchor-next" }
solana-program-log = { version = "1.1", features = ["macro"] }
wincode = { version = "0.5", features = ["derive"] }
```

Differences vs stable `v1`: no lifetimes, `Account<T>` (single type param), `Address`/`.address()`
instead of `Pubkey`/`.key()`, `&mut Context`, no manual `space`, `wincode` not borsh. The default for
`anchor init` remains `v1`. **Every example in this skill uses the stable `v1` API.** Mention v2 only
as "coming, not for production."

---

## References

- crates.io (versions): https://crates.io/crates/anchor-lang , .../anchor-cli , .../anchor-spl
- npm: https://www.npmjs.com/package/@anchor-lang/core , https://www.npmjs.com/package/@coral-xyz/anchor
- GitHub releases: https://github.com/solana-foundation/anchor/releases
- Agave releases: https://github.com/anza-xyz/agave/releases
- Anchor 1.0.0 release notes (full breaking list): https://www.anchor-lang.com/docs/updates/release-notes/1-0-0
- 0.31.0 release notes (discriminators): https://www.anchor-lang.com/docs/updates/release-notes/0-31-0
- Anchor installation: https://www.anchor-lang.com/docs/installation
- avm reference: https://www.anchor-lang.com/docs/references/avm
- Solana / Agave install (pin 3.1.10): https://release.anza.xyz/v3.1.10/install
</content>
