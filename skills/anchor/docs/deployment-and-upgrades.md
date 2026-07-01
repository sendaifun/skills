# Deployment & Upgrades

Everything between `anchor build` and a verified, multisig-governed program on mainnet:
the upgradeable loader model, devnet/mainnet deploy, upgrade authority, buffers and
failed-deploy recovery, on-chain IDL via the Program Metadata Program, verifiable builds with
`solana-verify`, and Squads-governed upgrades.

> Versions assumed: Anchor `1.1.2` (CLI is native — no `solana` binary required on `PATH`),
> Solana CLI `3.1.10` (Agave 3.x; 4.1.0 is the newest stable), `solana-verify` `0.5.1`,
> `@solana-program/program-metadata` `0.7.0`. See [../resources/version-compatibility.md](../resources/version-compatibility.md).

---

## 1. Build

```bash
anchor build                          # all programs → target/deploy/<lib>.so + IDL + types
anchor build -- --features my-feature # pass args through to `cargo build-sbf`
anchor build --verifiable             # deterministic Docker build (run from programs/<name>/)
cargo build-sbf                       # raw Solana toolchain build (no Anchor IDL emitted)
```

`anchor build` emits four artifacts under `target/`:

| Artifact | Path | Role |
|---|---|---|
| Program binary | `target/deploy/<lib>.so` | The SBF bytecode you deploy. |
| Program keypair | `target/deploy/<lib>-keypair.json` | Its **public key is the Program ID**. Keep it secret and backed up. |
| IDL | `target/idl/<lib>.json` | Interface description (instructions, accounts, discriminators, errors). |
| TS types | `target/types/<lib>.ts` | Typed `Program<T>` for the `@anchor-lang/core` client. |

`[workspace] idls = "app/src/idls/"` / `types = "..."` in `Anchor.toml` copy the IDL/TS out of
`target/` on every build so a frontend can consume them. 1.0 **hard-errors** on IDL field types it
cannot represent (e.g. tuple struct fields) that older versions silently dropped — fix the public
signature rather than ignoring it.

### `declare_id!` vs the program keypair — keep them in sync

The Program ID lives in **two** places that must agree:

1. `declare_id!("...")` in `lib.rs` — compiled into the binary; every instruction checks that it ran
   under this ID.
2. `[programs.<cluster>]` in `Anchor.toml` — what the CLI deploys/targets.

Both must equal the public key of `target/deploy/<lib>-keypair.json`. Anchor 1.0 added a **build-time
mismatch check**: if `declare_id!` ≠ keypair pubkey, `anchor build` aborts (softened to a *warning* in
1.1.1, PR #4705). Resolve it deterministically:

```bash
anchor keys list      # print each program's keypair pubkey
anchor keys sync      # rewrite declare_id! AND Anchor.toml from the keypair files, then rebuild
anchor build --ignore-keys   # escape hatch during early prototyping (skips the check)
```

`anchor keys sync` is the canonical fix — it is the single source of truth that reconciles source,
config, and keypair. Run it after `anchor init`, after cloning a repo, and any time you regenerate a
program keypair. To deploy to a **chosen** address (e.g. a vanity ID from `solana-keygen grind`),
replace `target/deploy/<lib>-keypair.json` with your keypair first, then `anchor keys sync`.

---

## 2. The upgradeable loader model

The canonical deploy uses the **Upgradeable BPF Loader**
(`BPFLoaderUpgradeab1e11111111111111111111111`, "loader-v3"). It produces **three** on-chain accounts:

| Account | Address | Contents | Lifetime |
|---|---|---|---|
| **Program** | the Program ID | tiny; a pointer to ProgramData; owned by the loader | permanent |
| **ProgramData** | derived | the executable bytes + **upgrade authority** + last-deployed slot | permanent |
| **Buffer** | ephemeral | bytes mid-upload, then swapped into ProgramData | transient |

`solana program show <id>` reports `Program Id`, `Owner` (= the loader),
`ProgramData Address`, `Authority`, `Last Deployed In Slot`, `Data Length`, `Balance`.

> Loader note: Agave is moving toward **loader-v4**, and a `Migrate` instruction exists, but loader-v3
> (`BPFLoaderUpgradeab1e…`) remains the default for `solana program deploy` as of Agave v4.1.0. Treat
> loader-v4 as forthcoming/opt-in.

### Solana CLI command reference

| Task | Command |
|---|---|
| Build | `cargo build-sbf` (or `anchor build`) |
| Deploy new / upgrade in place | `solana program deploy <path.so>` |
| Deploy to a chosen ID | `solana program deploy <path.so> --program-id ./keypair.json` |
| Show one program | `solana program show <program-id>` |
| List your programs | `solana program show --programs` |
| Download deployed `.so` | `solana program dump <program-id> ./out.so` |
| Transfer upgrade authority | `solana program set-upgrade-authority <id> --new-upgrade-authority <pubkey-or-keypair>` |
| Make immutable (irreversible) | `solana program set-upgrade-authority <id> --final` |
| Close + reclaim rent (irreversible) | `solana program close <id> --bypass-warning` |
| Pre-extend allocation | `solana program extend <id> <additional_bytes>` |
| Stage a buffer | `solana program write-buffer <path.so>` |
| List open buffers | `solana program show --buffers` |
| Close all buffers | `solana program close --buffers` |

---

## 3. Devnet vs mainnet deploy

### Cluster setup

```bash
solana config get
solana config set --url devnet                 # or mainnet-beta | testnet | localhost | <RPC url>
solana-keygen new                              # ~/.config/solana/id.json — the default deploy authority
solana airdrop 2                               # devnet/localhost ONLY (mainnet has no faucet)
solana balance
```

Deploy cost = rent-exemption for the ProgramData size. Compute it first so you fund the wallet
correctly:

```bash
wc -c < ./target/deploy/my_program.so          # e.g. 184504 bytes
solana rent 184504                             # e.g. Rent-exempt minimum: ~1.29 SOL (+ tx fees)
```

### Devnet

```bash
solana config set --url devnet
solana airdrop 2
anchor deploy                                  # deploys all workspace programs + uploads the IDL
#   or: solana program deploy ./target/deploy/my_program.so
```

Devnet is forgiving (free SOL, no congestion). Use it to validate the full deploy → IDL upload →
client-can-fetch loop before spending real SOL.

### Mainnet (treat every flag as load-bearing)

Mainnet RPC is rate-limited and congested; default public RPC will drop large deploys. Use a paid
stake-weighted RPC (Helius/Triton) and the congestion flags:

```bash
solana config set --url https://your-paid-rpc.example.com
solana program deploy ./target/deploy/my_program.so \
  --with-compute-unit-price 50000 \   # priority fee in micro-lamports/CU (size to current congestion)
  --max-sign-attempts 100 \           # re-sign with a fresh blockhash on expiry (default 5)
  --use-rpc                           # send via the configured RPC (needs a paid/SWQoS RPC)
```

> Modern `solana program deploy` allocates ProgramData to roughly the current binary size — it no
> longer reserves 2× headroom — so larger redeploys auto-`extend` and charge the extra rent. For a
> big size jump, pre-extend to avoid a failed first attempt (see §6).

### `anchor deploy` / `anchor upgrade`

```bash
anchor deploy                                  # deploy all programs to provider.cluster; uploads IDL by default
anchor deploy --no-idl                         # skip the on-chain IDL upload
anchor deploy --program-name my_program --program-keypair <path>
anchor upgrade ./target/deploy/my_program.so --program-id <PROGRAM_ID>   # in-place upgrade, same ID
```

- **Since 0.32.0**, `anchor deploy` uploads the on-chain IDL by default (`--no-idl` to skip).
- **In 1.0**, the Anchor CLI is **native** — `deploy`/`upgrade`/`airdrop`/`balance`/`address` no longer
  shell out to the `solana` binary, so it need not be on `PATH`.
- The CLI docs warn that "`anchor deploy` generates a new program address every run." This is
  misleading for the normal case: with an existing `target/deploy/<name>-keypair.json` it **reuses**
  that ID. It only mints a fresh ID when the keypair is absent. For **deterministic** mainnet
  upgrades, prefer `anchor upgrade … --program-id <id>` or `solana program deploy --program-id`.

---

## 4. Upgrade authority

The upgrade authority is the keypair allowed to replace the bytecode in ProgramData. It is set to the
deploying wallet on first deploy. Manage it explicitly:

```bash
# Hand off to a new key (e.g. a Squads vault PDA — see §8):
solana program set-upgrade-authority <id> --new-upgrade-authority <NEW_AUTHORITY>

# Freeze the program forever (cannot upgrade, cannot close, cannot reverse):
solana program set-upgrade-authority <id> --final
```

**Irreversible footguns:**

1. After `--new-upgrade-authority`, you can no longer upgrade without the **new** key. If you mistype
   the address or lose that key, the program is effectively frozen.
2. `--final` makes the program **permanently** un-upgradeable and un-closeable. There is no undo.
3. After `solana program close <id>`, the **Program ID can never be reused** — you cannot redeploy to
   that address.

Best practice: never leave a mainnet program under a single hot key. Either freeze it with `--final`
(for genuinely immutable programs) or transfer authority to a **multisig** (§8). For the verified
two-sided handoff to Squads, use Safe Authority Transfer (SAT) so authority can't be lost mid-transfer.

---

## 5. Buffers & recovering a failed deploy

Large deploys are written to a **buffer account** across many transactions, then swapped into
ProgramData in one instruction. If a deploy fails midway (congestion, blockhash expiry, RPC drop),
the buffer survives on-chain and locks SOL. You do **not** start over — you resume.

When a deploy/upgrade fails, the CLI prints a recovery hint with an ephemeral buffer account and a
**12-word seed phrase** for its keypair. Three paths:

```bash
# A. RESUME — rebuild the buffer keypair from the printed 12-word seed, then continue the deploy:
solana-keygen recover -o ./buffer.json prompt://          # paste the 12-word seed phrase
solana program deploy ./target/deploy/my_program.so --buffer ./buffer.json

# B. STAGE a buffer ahead of time (e.g. to hand to a multisig):
solana program write-buffer ./target/deploy/my_program.so \
  --with-compute-unit-price 50000 --max-sign-attempts 50
#   Buffer: <BUFFER_ADDRESS>
solana program set-buffer-authority <BUFFER_ADDRESS> --new-buffer-authority <NEW_AUTHORITY>

# C. RECLAIM — abandon the buffer and recover its rent:
solana program show --buffers                             # list your open buffers + balances
solana program close <BUFFER_ADDRESS>                     # close one
solana program close --buffers --authority ./id.json      # close ALL your buffers, reclaim rent
```

The single most common "I lost SOL deploying to mainnet" situation is an abandoned buffer.
`solana program show --buffers` + `solana program close --buffers` is the fix. Buffers are owned by
the buffer authority (the deployer by default); only that authority can close or reassign them.

---

## 6. Program size, `extend`, and rent

- Deploy cost = rent-exemption for the ProgramData size (`solana rent <bytes>`). Budget extra for tx
  fees and priority fees.
- A redeploy whose binary is **larger** than the current allocation auto-extends ProgramData and
  charges the delta. For a big jump, pre-extend to avoid a failed first attempt:

```bash
solana program show <id>                        # read "Data Length"
solana program extend <id> 8192                 # add 8192 bytes of allocation
```

- `solana program close <id> --bypass-warning` reclaims ProgramData rent but **burns the Program ID
  forever**. Only do this for programs you will never redeploy.

---

## 7. On-chain IDL — the Program Metadata Program (1.0+)

**Breaking in 1.0:** Anchor's legacy on-chain IDL instructions were removed and replaced by the
standalone **Program Metadata Program (PMP)** — `ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`
(built with Pinocchio). The IDL now lives at a **deterministic PDA derived from the Program ID**
(the "canonical" metadata account, seed `"idl"`), so a client can be generated from nothing but a
Program ID. The `anchor idl …` UX is mostly unchanged; only the storage backend moved. Anchor uses the
`@solana-program/program-metadata` npm package (latest `0.7.0`) under the hood.

```bash
anchor idl build                                            # generate the IDL via compilation
anchor idl init   -f target/idl/program.json [program-id]   # create the metadata (IDL) account
anchor idl init   -f target/idl/program.json <program-id> --non-canonical   # third-party metadata you don't own
anchor idl upgrade -f target/idl/program.json [program-id]  # overwrite the on-chain IDL (wallet must be authority)
anchor idl fetch  -o out.json <program-id>                  # download the IDL from the configured cluster
anchor idl fetch  <program-id> --non-canonical              # fetch third-party metadata
anchor idl close  <program-id> [--seed <seed>]              # close metadata account, reclaim rent (default seed "idl")
anchor idl create-buffer -f target/idl/program.json         # buffer for large IDLs (multi-tx writes)
anchor idl set-buffer-authority <buffer> -n <new-authority> # reassign buffer authority (e.g. to a multisig)
anchor idl write-buffer <program-id> -b <buffer> [--seed <seed>] [--close-buffer]
anchor idl fetch-historical <program-id>                    # recover historical IDLs (added 1.1.1, PR #3992)
```

- **1.0 breaking:** the positional `program-id` arg of `idl init` / `idl upgrade` is now **optional** —
  when omitted it is read from the IDL's top-level `"address"` field (PR #4130).
- IDL JSON shape (≥0.30): top-level `address`, `metadata {name, version, spec, description}`,
  `instructions[]` (each with an 8-byte `discriminator`), `accounts[]`, `types[]`, `events[]`,
  `errors[]`. Instruction discriminator = `sha256("global:<ix_name>")[..8]`; account discriminator =
  `sha256("account:<AccountName>")[..8]`.

### ⚠️ Migration gotcha — close the legacy IDL BEFORE upgrading to 1.0

If you are upgrading a program that **already has a legacy on-chain IDL** (deployed with 0.30/0.31/0.32),
you **must close the existing legacy IDL accounts using the v0.32.1 Anchor CLI BEFORE** redeploying with
Anchor 1.0 — 1.0 removed the old IDL-management instructions, so a 1.0 CLI cannot operate on a legacy
IDL account.

```bash
avm use 0.32.1                                    # temporarily switch to the legacy CLI
anchor idl close <program-id>                     # close the legacy IDL account (reclaims rent)
avm use 1.1.2                                      # back to current
# ... now redeploy/upgrade the program with 1.0+, then `anchor idl init` re-publishes via the PMP.
```

### Driving Program Metadata directly (for multisig export, security.txt, URLs)

```bash
npx @solana-program/program-metadata@latest write idl <program-id> --buffer <buffer-address>
npx @solana-program/program-metadata@latest set-buffer-authority <buffer-address> --new-authority <multisig-address>
# Export a tx for a multisig (Squads) instead of sending it:
npx @solana-program/program-metadata@latest write idl <program-id> --buffer <buf> \
  --export <multisig-address> --export-encoding base58 --close-buffer <refund-address>
```

Metadata can point to a URL (`--url`) or another account (`--account <addr> --account-offset N
--account-length M`) instead of storing bytes inline. Seeds like `"idl"` / `"security"` namespace
different metadata types (the same PMP also backs `security.txt`, §8).

---

## 8. Verifiable builds (`solana-verify`) — required for serious mainnet programs

A verifiable build lets anyone confirm the deployed bytecode was produced from specific public source:
a deterministic Docker build hashes the resulting `.so` and compares it to the on-chain ProgramData
hash. Explorers (Solana Explorer, SolanaFM, Solscan) show a "verified build" badge by reading the
verification PDA.

- **CLI crate:** `solana-verify` (latest `0.5.1`). Repo:
  `github.com/solana-foundation/solana-verifiable-build` (migrated from `Ellipsis-Labs/…`).
- **Otter Verify program:** `verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC` — owns the verification PDA
  (derived from program address + uploader).
- **OtterSec registry / API:** `https://verify.osec.io` (replaced the defunct `apr.dev`; Anchor's TS
  `verifiedBuild` uses this registry since 1.1.1, PR #4522). Re-verifies all programs every ~24h.
- **Anchor verifiable Docker image:** `quay.io/ottersec/anchor:<version>` (e.g.
  `docker pull quay.io/ottersec/anchor:v1.1.2`) — replaced `solanafoundation/anchor` and
  `backpackapp/build`.

```bash
cargo install solana-verify --version 0.5.1 --locked        # pin a tagged release for production
```

### Standard local workflow

```bash
# 1. Deterministic build (Docker). Selects the toolchain from [workspace.metadata.cli] solana = "3.1.10"
#    (preferred) else from Cargo.lock.
solana-verify build
solana-verify build --library-name <lib>                    # pick one program in a multi-program repo
solana-verify get-executable-hash target/deploy/<lib>.so    # record this hash

# 2. Deploy THE VERIFIED ARTIFACT. Do NOT re-run `anchor build`/`cargo build-sbf` after this — it
#    rebuilds non-deterministically and the on-chain hash won't match.
solana program deploy -u <RPC> target/deploy/<lib>.so --program-id <PROGRAM_ID> \
  --with-compute-unit-price 50000 --max-sign-attempts 100 --use-rpc
solana-verify get-program-hash -u <RPC> <PROGRAM_ID>        # MUST equal the executable hash from step 1

# 3. Verify against the public repo and upload the verification PDA (answer YES to upload):
solana-verify verify-from-repo -u <RPC> --program-id <PROGRAM_ID> https://github.com/<org>/<repo> \
  --commit-hash <SHA> --library-name <lib> --mount-path <subdir>

# 4. Queue the remote OtterSec verification job (mainnet only):
solana-verify remote submit-job --program-id <PROGRAM_ID> --uploader <UPLOADER_PUBKEY>
solana-verify remote get-status --program-id <PROGRAM_ID>
```

- `--uploader` = the address that signs the PDA upload, normally the program **upgrade authority**.
- `--mount-path` = the dir containing the program's `Cargo.toml` (its **lib name** matters, not the
  package name). Use `--workspace-path` for monorepos that reference sibling crates.
- **`--remote` is deprecated** → upload the PDA, then `solana-verify remote submit-job`.
- Verify someone else's program (trustless, no deploy):
  `solana-verify verify-from-repo --program-id <ID> <repo> --commit-hash <sha> …`, after
  `solana-verify list-program-pdas --program-id <ID>` to read the on-chain metadata.
- Verify from a prebuilt image (skip rebuild):
  `solana-verify verify-from-image -e <path>/prog.so -i <docker-image> -p <PROGRAM_ID>`.
- Immutable programs (no authority) cannot self-upload a PDA → email `contact@osec.io` for whitelist.
  Private repos are unsupported (verification needs public source).

**Determinism caveats:** you must use Docker; a different Rust/Solana toolchain, dependency drift, or
the wrong commit yields a hash mismatch. Keep a workspace release profile with
`overflow-checks = true`, `lto = "fat"`, `codegen-units = 1` (this is the `anchor init` default).

### Anchor's own verifiable-build wrappers

```bash
anchor build --verifiable                 # deterministic Docker build (run from programs/<name>/)
anchor verify <program-id>                # verify on-chain bytecode == local artifact (wraps solana-verify)
anchor verify -p <lib-name> <program-id>  # also check the on-chain IDL matches
docker rm -f anchor-program               # clean up a stuck build container
```

Since 0.32.0 `anchor verify` calls `solana-verify` under the hood (auto-installs via avm); `anchor
publish` and the `[registry]` section were removed.

### `security.txt` (complementary)

```toml
[dependencies]
solana-security-txt = "1.1.1"
```

```rust
use solana_security_txt::security_txt;
security_txt! {
    name: "My Program",
    project_url: "https://example.com",
    contacts: "email:security@example.com",
    policy: "https://example.com/security-policy",
    source_code: "https://github.com/org/repo",
    source_revision: env!("GIT_SHA"),
    auditors: "OtterSec"
}
```

Surfaced in explorers; can also be uploaded via the Program Metadata Program (seed `"security"`)
without bloating the binary.

---

## 9. Squads-governed upgrade authority (mainnet best practice)

For mainnet, transfer the upgrade authority to a **Squads v4 multisig** so upgrades require M-of-N
approval (Squads Protocol is formally verified; repo `Squads-Protocol/v4`). A hot single-key authority
is the largest unforced risk on a mainnet program.

### 1. Transfer authority to the Squad

In the Squads app → **Programs** → **Add Program** (name + address), then transfer authority via one of:

- **Manual:** `solana program set-upgrade-authority <id> --new-upgrade-authority <SQUAD_VAULT_PDA>`
- **CLI:** paste the command Squads generates.
- **Safe Authority Transfer (SAT):** a two-sided transfer signed by both the Squad's Vault PDA and the
  current authority, so authority cannot be lost mid-transfer.

### 2. Upgrade through the Squad

```bash
# Build verifiably and stage a buffer:
solana-verify build
solana program write-buffer target/deploy/my_program.so \
  --with-compute-unit-price 50000 --max-sign-attempts 50
#   Buffer: <BUFFER>

# Hand the buffer to the multisig:
solana program set-buffer-authority <BUFFER> --new-buffer-authority <SQUAD_VAULT_PDA>
```

In Squads → **Add upgrade** (name, buffer address, spill/refund address, commit link) → members
approve → **Upgrade** executes the loader's `Upgrade` instruction from the buffer. Reviewers should
compare the on-chain buffer hash to source with `solana-verify get-buffer-hash` **before** approving.

### 3. Verified build through a multisig (the PDA dance)

The verification PDA must be signed by the program authority (the Squad), so **export** the PDA write
tx and route it through Squads:

```bash
solana-verify verify-from-repo -um --program-id <ID> https://github.com/<org>/<repo>   # local hash check first
solana-verify export-pda-tx https://github.com/<org>/<repo> --program-id <ID> \
  --uploader <SQUAD_VAULT_PDA> --encoding base58 --compute-unit-price 0
# → paste the base58 tx into the Squads tx builder; confirm it only calls the Otter Verify program + compute budget
solana-verify remote submit-job --program-id <ID> --uploader <SQUAD_VAULT_PDA>
```

### 4. CI/CD

**Squads GitHub Action** `github.com/Squads-Protocol/squads-v4-program-upgrade` builds a buffer in CI
and opens a Squads upgrade **proposal** automatically; members then verify the on-chain buffer hash
against source with `solana-verify` before approving. This keeps the production upgrade authority out
of CI entirely — CI only stages buffers and proposes; humans approve.

---

## 10. End-to-end mainnet release checklist

1. `anchor keys sync` — `declare_id!`, `Anchor.toml`, and keypair agree.
2. `solana-verify build` — deterministic Docker artifact; record `get-executable-hash`.
3. Deploy the **verified** `.so` with `--use-rpc --with-compute-unit-price --max-sign-attempts` on a
   paid RPC. Do **not** re-run `anchor build` afterward.
4. `solana-verify get-program-hash` == the executable hash.
5. `anchor idl init` / `anchor deploy` (IDL by default) — publish the on-chain IDL via the PMP.
6. `solana-verify verify-from-repo` + `remote submit-job` — get the explorer "verified" badge.
7. Add `security_txt!` (or upload via PMP seed `"security"`).
8. `solana program set-upgrade-authority <id> --new-upgrade-authority <SQUAD_VAULT_PDA>` (or `--final`
   for a genuinely immutable program).
9. `solana program show --buffers` and `solana program close --buffers` — reclaim any stranded rent.

---

## Common deploy/upgrade errors

### Error: deploy fails midway, SOL is "gone"
**Cause** A large deploy/upgrade failed after writing a buffer (congestion, blockhash expiry, RPC
drop). The buffer survives on-chain and holds the rent.
**Solution** `solana program show --buffers` to find it, then `solana program deploy --buffer <recovered keypair>`
to resume (recover the keypair from the printed 12-word seed via `solana-keygen recover`), or
`solana program close --buffers` to reclaim the rent.

### Error: `Error: ELF error: ... / account data too small for instruction` on upgrade
**Cause** The new binary is larger than the current ProgramData allocation and the auto-extend didn't
cover it (or you hit a size-jump edge case).
**Solution** Pre-extend: `solana program extend <id> <bytes>` (read current size with `solana program show <id>`), then redeploy.

### Error: verified-build hash mismatch (`get-program-hash` ≠ `get-executable-hash`)
**Cause** The deployed `.so` was not the one `solana-verify build` produced — usually an `anchor build`
/ `cargo build-sbf` re-ran after the verifiable build, or a different toolchain/commit was used.
**Solution** Re-run `solana-verify build`, deploy **that exact** `target/deploy/<lib>.so`, and never
rebuild it before deploy. Pin the Solana version via `[workspace.metadata.cli] solana = "3.1.10"`.

### Error: `anchor idl init` fails / IDL can't be fetched after upgrading to 1.0
**Cause** The program still has a **legacy** on-chain IDL account from a pre-1.0 deploy, which the 1.0
CLI cannot manage.
**Solution** Switch to the legacy CLI (`avm use 0.32.1`), `anchor idl close <program-id>`, switch back
(`avm use 1.1.2`), then `anchor idl init` to publish via the Program Metadata Program.

### Error: "Account allocation failed: unable to confirm transaction" / blockhash expired on mainnet deploy
**Cause** Public RPC rate-limited the deploy, or the priority fee was too low for current congestion.
**Solution** Use a paid stake-weighted RPC with `--use-rpc`, raise `--with-compute-unit-price`, and
raise `--max-sign-attempts` (e.g. 100). Resume from the buffer rather than restarting.

For build/test/client errors, see [troubleshooting.md](troubleshooting.md).

---

## References

- Deploying programs (Solana docs): https://solana.com/docs/programs/deploying
- Verifying / verified builds: https://solana.com/docs/programs/verified-builds
- `solana-verify` (repo + flags): https://github.com/solana-foundation/solana-verifiable-build
- Anchor IDL & on-chain metadata: https://www.anchor-lang.com/docs/basics/idl
- Anchor verifiable builds reference: https://www.anchor-lang.com/docs/references/verifiable-builds
- Program Metadata Program (`ProgM6…`): https://github.com/solana-program/program-metadata
- Otter Verify program (`verifycLy…`) / OtterSec API: https://verify.osec.io
- Squads — programs & upgrade authority: https://docs.squads.so/main/navigating-your-squad/developers-assets/programs
- Squads upgrade CI Action: https://github.com/Squads-Protocol/squads-v4-program-upgrade
- `solana-security-txt`: https://github.com/neodyme-labs/solana-security-txt
</content>
</invoke>
