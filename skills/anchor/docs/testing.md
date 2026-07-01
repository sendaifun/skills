# Testing Anchor Programs

The modern Anchor test stack has four layers, from fastest/narrowest to slowest/most faithful: **Mollusk** (Rust, single-instruction unit tests + compute-unit benchmarks) → **LiteSVM** (in-process SVM for full-transaction integration tests, in Rust and TS) → **Anchor's default templates** (`litesvm` Rust via `cargo test`, or `ts-mocha` with a typed `Program<T>`) → **Surfpool / `solana-test-validator`** (real RPC, end-to-end). This guide gives one working example per tool, a "when to use which" matrix, and the cross-cutting techniques: fixtures, airdrops, slot/time travel, blockhash expiry, and asserting program errors.

Pinned versions (verified): `mollusk-svm` / `mollusk-svm-bencher` **0.13.4**, `litesvm` crate **0.13.0** (Anchor's generated template pins `0.10.0`), `litesvm` npm **1.2.0** (Kit-based) and **0.8.0** (web3.js line), `anchor-litesvm` npm **0.2.1**, `@anchor-lang/core` **1.1.2** (Node **>= 20.18**). `solana-bankrun` / `anchor-bankrun` are **deprecated** (last published 2024-10-17) — covered only for migration.

> **Two npm scopes, never mixed in one project.** The 1.x TS client is `@anchor-lang/core`; the legacy `@coral-xyz/anchor` is frozen at 0.32.1. The typed-`Program<T>` test helper `anchor-litesvm` currently pins the **legacy** `@coral-xyz/anchor` 0.31 scope. Mixing scopes yields two incompatible `Program`/`BN`/`PublicKey` types in one build. See [the gotchas section](#gotchas-that-cost-hours) and the migration notes in [resources/version-compatibility.md](../resources/version-compatibility.md).

## When to use which

| Need | Tool | Language | Why |
|---|---|---|---|
| Unit-test one instruction; assert **exact compute units**; track CU regressions | **Mollusk** (`mollusk-svm` + `mollusk-svm-bencher`) | Rust | Lightest harness — no `Bank`, no `AccountsDB`. You build every account by hand and process a single instruction. Built-in CU bencher writes a markdown diff vs. the last committed run. |
| Integration test: full transaction, multiple programs, CPIs, token flows, sysvar/time travel | **LiteSVM (Rust crate)** | Rust | In-process SVM with the real transaction pipeline; far faster than `solana-test-validator`. **This is the Anchor 1.x default test template** (`cargo test`). |
| Fast Node tests that drive the program over raw Kit transactions (no validator) | **LiteSVM (npm 1.2.0)** | TS | Kit-native; `Address` types, not `PublicKey`. Fastest Node path when you are not using a typed Anchor client. |
| TS tests using a **typed Anchor `Program<T>`** (`.methods.x().rpc()`, `.account.fetch`) without a validator | **anchor-litesvm** (`LiteSVMProvider` + `fromWorkspace`) | TS | Drop-in `AnchorProvider` over LiteSVM. **Pins `@coral-xyz/anchor` 0.31 + `litesvm` 0.x** — stay on the legacy scope when you use it (see callout below). |
| The classic "write a `.ts` file, run `anchor test`" workflow against a typed client | **ts-mocha** (`@anchor-lang/core`) | TS | The familiar mocha suite. `anchor test --validator surfpool` (default) or `--validator legacy` boots a real validator and runs it over RPC. |
| End-to-end behavior, real RPC, **mainnet fork**, cheatcodes | **Surfpool** | any | Anchor 1.x default for `anchor test` / `anchor localnet`. Closest to mainnet; mainnet-forking + account/clock cheatcodes. Requires `surfpool >= 1.1.2`. |
| Maximal fidelity, the canonical validator, airdrop faucet, full RPC surface | **`solana-test-validator`** (`anchor test --validator legacy`) | any | The official local validator. Slowest; use when you need exact runtime/loader behavior. |
| Legacy suite already on bankrun | **anchor-bankrun** (`startAnchor` + `BankrunProvider`) | TS | Works, but **deprecated** since 2024-10-17 and pinned to `@coral-xyz/anchor` 0.30. Migrate to `anchor-litesvm`. |

**Rule of thumb:** Mollusk for instruction-level logic + CU budgets → LiteSVM for integration tests (Rust by default; TS via `anchor-litesvm`) → Surfpool / `solana-test-validator` for end-to-end and RPC behavior. A healthy program has Mollusk/LiteSVM tests for logic and a thin layer of validator tests for the wire format. Treat bankrun as end-of-life.

---

## 1. Mollusk — instruction-level unit tests + CU benchmarks

`mollusk-svm` executes a **single instruction** (or a chain) against accounts you construct by hand. It skips `AccountsDB`, the `Bank`, and the loader, so it is the fastest way to test program logic and the only tool with a first-class compute-unit bencher.

```toml
# programs/<name>/Cargo.toml
[dev-dependencies]
mollusk-svm = "0.13.4"
mollusk-svm-bencher = "0.13.4"   # only if you bench CUs
solana-sdk = "3.0"               # Account, Instruction, Pubkey, ProgramError helpers
```

Mollusk needs the **compiled `.so`**. `Mollusk::new(&program_id, "counter")` searches, in order: `tests/fixtures/`, `$BPF_OUT_DIR`, then `$SBF_OUT_DIR` (default `target/deploy/counter.so`). Run `anchor build` (or `cargo build-sbf`) first, or set `SBF_OUT_DIR`.

```rust
// programs/counter/tests/mollusk.rs  — run with: cargo build-sbf && cargo test
use {
    anchor_lang::{prelude::*, InstructionData, ToAccountMetas},
    mollusk_svm::{result::Check, Mollusk},
    solana_sdk::{account::Account, instruction::Instruction, program_error::ProgramError},
};

// Helper: build an *Anchor* pre-state account (8-byte discriminator + Borsh fields).
fn anchor_account<T: AccountSerialize>(state: &T, lamports: u64, owner: &Pubkey) -> Account {
    let mut data = Vec::new();
    state.try_serialize(&mut data).unwrap(); // writes discriminator THEN fields
    Account { lamports, data, owner: *owner, executable: false, rent_epoch: 0 }
}

#[test]
fn increment_succeeds_and_costs_under_budget() {
    let program_id = counter::ID;
    // Finds counter.so in tests/fixtures or target/deploy.
    let mollusk = Mollusk::new(&program_id, "counter");

    let authority = Pubkey::new_unique();
    let (counter_pda, _bump) =
        Pubkey::find_program_address(&[b"counter", authority.as_ref()], &program_id);

    // Seed the counter account with count = 41, owned by our program.
    let pre = counter::state::Counter { count: 41, authority };
    let counter_acct = anchor_account(&pre, 1_000_000_000, &program_id);

    // Build the Anchor instruction from the generated InstructionData + ToAccountMetas.
    let ix = Instruction::new_with_bytes(
        program_id,
        &counter::instruction::Increment {}.data(),
        counter::accounts::Increment { counter: counter_pda, authority }.to_account_metas(None),
    );

    let accounts = vec![
        (counter_pda, counter_acct),
        (authority, Account::new(1_000_000_000, 0, &solana_sdk::system_program::ID)),
    ];

    mollusk.process_and_validate_instruction(
        &ix,
        &accounts,
        &[
            Check::success(),
            Check::compute_units(2_000),                          // exact CU budget — fails on regression
            // assert post-state bytes: discriminator (8) then count = 42 (u64 LE) at offset 8
            Check::account(&counter_pda).data_slice(8, &42u64.to_le_bytes()).build(),
        ],
    );
}

#[test]
fn increment_rejects_wrong_authority() {
    let program_id = counter::ID;
    let mollusk = Mollusk::new(&program_id, "counter");

    let real = Pubkey::new_unique();
    let attacker = Pubkey::new_unique();
    let (counter_pda, _) = Pubkey::find_program_address(&[b"counter", real.as_ref()], &program_id);
    let pre = counter::state::Counter { count: 0, authority: real };

    let ix = Instruction::new_with_bytes(
        program_id,
        &counter::instruction::Increment {}.data(),
        counter::accounts::Increment { counter: counter_pda, authority: attacker }.to_account_metas(None),
    );
    let accounts = vec![
        (counter_pda, anchor_account(&pre, 1_000_000_000, &program_id)),
        (attacker, Account::new(1_000_000_000, 0, &solana_sdk::system_program::ID)),
    ];

    // Anchor custom errors surface as ProgramError::Custom(6000 + n). `has_one` failure = ConstraintHasOne (2001).
    mollusk.process_and_validate_instruction(
        &ix,
        &accounts,
        &[Check::err(ProgramError::Custom(2001))],
    );
}
```

Key API surface:

- `Mollusk::new(&program_id, "name")` / `Mollusk::new_debuggable(...)` (debugger support).
- `process_instruction(&ix, &accounts) -> InstructionResult` — execute, no assertions.
- `process_and_validate_instruction(&ix, &accounts, &[Check])` — execute + assert.
- `process_instruction_chain(&[(ix, accounts), ...])` / `process_and_validate_instruction_chain(...)` — sequential instructions with state carried forward (e.g. `initialize` then `increment`).
- Stateful mode: `mollusk.with_context(account_store)` returns a `MolluskContext` that manages accounts across calls, so you don't re-thread the `accounts` vec.

`Check` constructors: `Check::success()`, `Check::err(ProgramError)`, `Check::instruction_err(InstructionError)`, `Check::compute_units(u64)`, `Check::return_data(&[u8])`, `Check::all_rent_exempt()`, and `Check::account(&pubkey)` → builder with `.data(&[u8])`, `.data_slice(offset, &[u8])`, `.lamports(u64)`, `.owner(&pubkey)`, `.space(usize)`, `.executable(bool)`, `.rent_exempt()`, `.closed()` → `.build()`.

### Compute-unit benchmarks (`mollusk-svm-bencher`)

Commit the generated markdown report; the bencher diffs each run against it, so CU regressions show up in PR diffs.

```rust
// programs/counter/benches/cu.rs  — run with: cargo bench
use {
    anchor_lang::{InstructionData, ToAccountMetas},
    mollusk_svm::Mollusk,
    mollusk_svm_bencher::MolluskComputeUnitBencher,
    /* ...build `ix` and `accounts` exactly as in the test above... */
};

fn main() {
    let mollusk = Mollusk::new(&counter::ID, "counter");
    MolluskComputeUnitBencher::new(mollusk)
        .bench(("increment", &ix, &accounts))     // add more .bench((...)) lines per instruction
        .must_pass(true)                            // fail the run if any bench errors
        .out_dir("./benches")                       // writes benches/compute_units.md
        .execute();
}
```

The report lists each named instruction, the CUs consumed, and the delta vs. the previous committed run. `MolluskComputeUnitMatrixBencher` (`.programs(&[..])`) benches several program builds side-by-side — useful when comparing an optimization.

> The published Mollusk README still shows `mollusk-svm = "0.8.0"` and `Check::compute_units(450)`. That is stale — the current crate is **0.13.4**. Don't copy the README's version string.

---

## 2. LiteSVM — the in-process SVM

LiteSVM runs a real SVM (System + SPL Token + core builtins preloaded) entirely in-process: real transactions, real CPIs, real sysvars — no validator, no `AccountsDB`. It is the recommended default for integration tests and is what `anchor init` generates.

### 2a. Rust crate (`litesvm = "0.13.0"`) — Anchor's default test template

This is (close to) what `anchor init` writes to `tests/test_initialize.rs`. `cargo test` only works **after `anchor build`** has produced the deploy artifact that `include_bytes!` loads.

```rust
// tests/test_initialize.rs  — run with: anchor build && cargo test
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_initialize() {
    let program_id = counter::ID;
    let payer = Keypair::new();
    let (counter, _bump) =
        Pubkey::find_program_address(&[b"counter", payer.pubkey().as_ref()], &program_id);

    let mut svm = LiteSVM::new();
    // Load the compiled .so emitted by `anchor build`.
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/counter.so"));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        program_id,
        &counter::instruction::Initialize {}.data(),
        counter::accounts::Initialize {
            payer: payer.pubkey(),
            counter,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    assert!(svm.send_transaction(tx).is_ok());

    // Decode the resulting account with Anchor's AccountDeserialize (skips the discriminator).
    let acct = svm.get_account(&counter).unwrap();
    let mut data: &[u8] = &acct.data;
    let state = counter::state::Counter::try_deserialize(&mut data).unwrap();
    assert_eq!(state.count, 0);
}
```

`LiteSVM` builder mutators (chain before use): `with_compute_budget(...)`, `with_sigverify(false)`, `with_blockhash_check(false)`, `with_sysvars()`, `with_lamports(...)`, `with_precompiles()`. Core methods: `airdrop`, `set_account`, `get_account`, `get_balance`, `add_program` / `add_program_from_file`, `latest_blockhash`, `expire_blockhash`, `minimum_balance_for_rent_exemption`, `send_transaction`, `simulate_transaction`. Time/slot travel: `warp_to_slot(slot)`, `get_clock()` / `set_clock()`, `get_rent()` / `set_rent()`. Companion crates: `litesvm-token` (SPL helpers), `litesvm-loader` (upgradeable deploy), `anchor-litesvm` crate 0.4.0 (Rust Anchor glue).

**Asserting a program error in Rust:** `send_transaction` returns `Result<TransactionMetadata, FailedTransactionMetadata>`; match on the error.

```rust
use solana_sdk::{instruction::InstructionError, transaction::TransactionError};

let failed = svm.send_transaction(tx).unwrap_err(); // FailedTransactionMetadata { err, meta }
assert!(matches!(
    failed.err,
    TransactionError::InstructionError(0, InstructionError::Custom(6000)) // your #[error_code] value
));
// failed.meta.logs contains the program logs, including the "AnchorError ... Error Code: ..." line.
```

> **Time/slot travel for time-locked logic.** To test a 24-hour lock, advance the `Clock` sysvar's `unix_timestamp` rather than waiting:
> ```rust
> let mut clock = svm.get_clock();
> clock.unix_timestamp += 86_400;     // +1 day
> svm.set_clock(clock);
> // svm.warp_to_slot(clock.slot + 100); // advance slot height for slot-based logic
> ```
> Call `svm.expire_blockhash()` to force the next reuse of an old blockhash to fail — the way to unit-test "blockhash not found" / rebroadcast handling.

### 2b. Node package (`litesvm@1.2.0`, Kit-based)

The 1.x npm line is built on `@solana/kit` — addresses are Kit `Address` strings, signers come from `generateKeyPairSigner()`, **not** web3.js `PublicKey`. Use it for fast Node tests built on raw Kit instructions (it does **not** plug into a typed Anchor `Program` — for that, see 2c).

```ts
// transfer.test.ts  — run with: node --test  (or your test runner)
import { test } from "node:test";
import assert from "node:assert/strict";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  appendTransactionMessageInstruction, createTransactionMessage, generateKeyPairSigner,
  lamports, pipe, setTransactionMessageFeePayerSigner, signTransactionMessageWithSigners,
} from "@solana/kit";

test("it transfers SOL", async () => {
  const svm = new LiteSVM();
  const payer = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  svm.airdrop(payer.address, lamports(2_000_000_000n)); // address is a Kit string, not a PublicKey

  const ix = getTransferSolInstruction({
    source: payer, destination: recipient.address, amount: lamports(1_000_000_000n),
  });
  const tx = await pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
    (m) => appendTransactionMessageInstruction(ix, m),
    (m) => signTransactionMessageWithSigners(m),
  );

  const result = svm.sendTransaction(tx);
  if (result instanceof FailedTransactionMetadata) throw new Error(result.err().toString());
  assert.strictEqual(svm.getBalance(recipient.address), lamports(1_000_000_000n));
});
```

TS `LiteSVM` builders: `withComputeBudget`, `withSigverify`, `withBlockhashCheck`, `withSysvars`, `withDefaultPrograms`, `withNativeMints`, `withTransactionHistory`, `withLogBytesLimit`, `withPrecompiles`. Methods mirror the Rust crate: `airdrop`, `getBalance`, `getAccount`, `setAccount`, `minimumBalanceForRentExemption`, `addProgramFromFile`, `addProgram`, `sendTransaction`, `simulateTransaction`, `latestBlockhash`, `expireBlockhash`, plus time travel: `warpToSlot(slot)`, `getClock()` / `setClock()`, `getRent()` / `setRent()`.

```ts
// TS slot/time travel + blockhash expiry:
svm.warpToSlot(1_000n);
const clock = svm.getClock();
clock.unixTimestamp += 86_400n;      // bigint seconds
svm.setClock(clock);
svm.expireBlockhash();               // next reuse of the old blockhash will fail
```

> **The web3.js line (`litesvm@0.8.0`).** A parallel-maintained branch on `@solana/web3.js ^1.98.4` exists for projects still on web3.js v1. It exposes the same surface using `PublicKey`/`Transaction` instead of Kit `Address`. Pick one line per project — do not import both.

### 2c. Typed Anchor `Program<T>` in TS → `anchor-litesvm`

LiteSVM npm 1.x (Kit) does **not** drop into Anchor's web3.js-based `Program`. The supported bridge is **`anchor-litesvm`** (npm **0.2.1**), which exports `LiteSVMProvider` (a drop-in `AnchorProvider`) and `fromWorkspace`. It is async (it implements Anchor's async `Provider` interface) even though LiteSVM itself is synchronous.

```ts
// anchor-litesvm.test.ts  — pins @coral-xyz/anchor 0.31 + litesvm 0.x (legacy scope)
import { test } from "node:test";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import { Keypair } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";       // legacy scope — REQUIRED by anchor-litesvm
import { Counter } from "./anchor-example/counter";
const IDL = require("./anchor-example/counter.json");

test("anchor via litesvm", async () => {
  const client = fromWorkspace("tests/anchor-example");  // loads programs from the Anchor workspace
  const provider = new LiteSVMProvider(client);
  const program = new Program<Counter>(IDL, provider);   // 2-arg constructor; id from IDL.address

  const counter = Keypair.generate();
  await program.methods.initialize()
    .accounts({ counter: counter.publicKey })
    .signers([counter]).rpc();

  const acct = await program.account.counter.fetch(counter.publicKey);
});
```

> **Honest caveat — scope conflict.** `anchor-litesvm@0.2.1` declares `@coral-xyz/anchor ^0.31.1`, `@solana/web3.js ^1.98.4`, `litesvm ^0.3.3`. It does **not** yet target `@anchor-lang/core` 1.x. So for a typed-`Program<T>` TS suite today you have two honest choices:
> 1. **Stay on the legacy `@coral-xyz/anchor` 0.31 scope** for the test directory and use `anchor-litesvm` (above). Your on-chain program can still be Anchor 1.x — the IDL and wire format are compatible; only the TS client scope is pinned.
> 2. **Write the typed test in Rust** with the `litesvm` crate (§2a), or run a `@anchor-lang/core` ts-mocha suite against a real validator (§3b), and reserve `anchor-litesvm` for projects already on the legacy scope.
>
> Do not import `@anchor-lang/core` and `@coral-xyz/anchor` in the same test file. A runnable version of this pattern is in [examples/tests/litesvm.test.ts](../examples/tests/litesvm.test.ts).

---

## 3. Anchor's default templates

`anchor init` defaults changed in 1.0: `--test-template` is **`litesvm`** (a Rust test, run via `cargo test`) and `anchor test` / `anchor localnet` boot **Surfpool** by default. Choose the TS suite explicitly with `--test-template mocha`.

| Template | `anchor init` flag | Runs | Notes |
|---|---|---|---|
| `litesvm` (default) | _(none)_ | `cargo test` | Rust LiteSVM test (§2a). No validator, no Node. |
| `rust` | `--test-template rust` | `cargo test` | Rust without the LiteSVM scaffolding. |
| `mollusk` | `--test-template mollusk` | `cargo test-sbf` | Mollusk scaffold (§1). |
| `mocha` | `--test-template mocha` | `ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"` | The classic TS suite (§3b). |
| `jest` | `--test-template jest` | `jest --preset ts-jest` | TS via Jest. |

### 3a. The default Rust litesvm test

See §2a — that is the generated `tests/test_initialize.rs`. `anchor test` builds the program, then runs `cargo test`.

### 3b. ts-mocha with a typed `Program<T>` (`@anchor-lang/core`)

This is the canonical mocha pattern in 1.x. `anchor test` sets `ANCHOR_PROVIDER_URL` + `ANCHOR_WALLET`, boots the validator (Surfpool by default; `--validator legacy` for `solana-test-validator`), and runs the suite over RPC.

```ts
// tests/counter.ts  — run with: anchor test --test-template mocha  (or `anchor test` if scaffolded with mocha)
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { assert } from "chai";
import { Counter } from "../target/types/counter";   // generated by `anchor build`

describe("counter", () => {
  anchor.setProvider(anchor.AnchorProvider.env());      // reads ANCHOR_PROVIDER_URL + ANCHOR_WALLET
  const program = anchor.workspace.Counter as Program<Counter>;
  const authority = program.provider.publicKey!;

  const [counter] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), authority.toBuffer()],
    program.programId,
  );

  it("initializes", async () => {
    await program.methods
      .initialize()
      .accounts({ payer: authority, counter })          // .accounts() = strict resolution
      .rpc();
    const state = await program.account.counter.fetch(counter);
    assert.strictEqual(state.count.toNumber(), 0);
  });

  it("increments", async () => {
    // .accountsPartial() lets you pass a subset and let Anchor resolve the rest.
    await program.methods.increment().accountsPartial({ counter, authority }).rpc();
    const state = await program.account.counter.fetch(counter);
    assert.strictEqual(state.count.toNumber(), 1);
  });

  it("rejects a wrong authority (asserting the program error)", async () => {
    const attacker = anchor.web3.Keypair.generate();
    await program.provider.connection.requestAirdrop(attacker.publicKey, 1e9);
    try {
      await program.methods.increment()
        .accountsPartial({ counter, authority: attacker.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("should have thrown");
    } catch (err) {
      const e = err as anchor.AnchorError;
      assert.strictEqual(e.error.errorCode.code, "Unauthorized"); // matches the #[msg] variant name
      assert.strictEqual(e.error.errorCode.number, 6000);          // custom codes start at 6000
    }
  });
});
```

- **`new Program<T>(IDL, provider)` is 2-arg** (since 0.30): the program ID comes from `IDL.address`. The old 3-arg `new Program(idl, programId, provider)` is removed — a common "wrong number of arguments" failure in old tutorials. Outside a workspace: `import IDL from "../target/idl/counter.json"; const program = new Program<Counter>(IDL, provider);`.
- **`.accounts()` vs `.accountsPartial()`:** `.accounts()` does strict resolution and rejects unknown/unresolvable keys; `.accountsPartial()` accepts a subset and resolves the rest (PDAs, programs). Old code that hand-passed every account to `.accounts()` may need `.accountsPartial()`.
- **Asserting Anchor errors:** catch and inspect `AnchorError.error.errorCode` (`.code` = variant name, `.number` = numeric code). For raw send failures, `error.logs` carries the `Program log: AnchorError ...` lines. A starter is in [templates/tests-template.ts](../templates/tests-template.ts).

---

## 4. End-to-end: Surfpool & `solana-test-validator`

For tests that must exercise real RPC, the leader pipeline, or mainnet state, run against a validator. `anchor test` orchestrates build → boot validator → deploy → run the configured test script → tear down.

```bash
anchor test                       # default: boots Surfpool (mainnet-forking), runs the test script
anchor test --validator legacy    # uses solana-test-validator instead
anchor test --skip-local-validator   # run against an already-running validator / a remote cluster
anchor test --skip-deploy            # don't redeploy (program already on the target cluster)
```

**Surfpool** (Anchor 1.x default, requires `surfpool >= 1.1.2`) forks mainnet on demand, so your test sees real mint/oracle/program accounts without cloning them by hand, and provides cheatcodes (set arbitrary account data, warp the clock). Install it separately — CI that assumed `solana-test-validator` will fail with "validator not found" until Surfpool is installed or `--validator legacy` is passed.

**`solana-test-validator`** is the canonical local validator with a faucet (`requestAirdrop`) and the full RPC surface. Configure it through `Anchor.toml`:

```toml
[test.validator]
url = "https://api.mainnet-beta.solana.com"   # source cluster for cloned accounts

[[test.validator.clone]]                       # clone a live program (e.g. Token-2022) by address
address = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

[[test.validator.account]]                     # preload a specific account from a JSON dump
address = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"   # USDC mint
filename = "tests/fixtures/usdc-mint.json"
```

Devnet vs mainnet: `anchor test` runs on a fresh local ledger by default. To exercise a real cluster, set `[provider] cluster = "devnet"` (or a custom RPC URL) and `--skip-local-validator`; airdrops only work on devnet/localnet, never mainnet.

---

## 5. bankrun / anchor-bankrun — deprecated (migration only)

`solana-bankrun` (npm **0.4.0**) is **officially deprecated** — its README reads *"DEPRECATED: use LiteSVM instead."* — and last published **2024-10-17**. `anchor-bankrun` (npm **0.5.0**, same date) pins `@coral-xyz/anchor ^0.30.0` and the v0.30 IDL format. Do not start new work on bankrun. It is documented here only so existing suites can migrate.

```ts
// LEGACY — anchor-bankrun. Migrate to anchor-litesvm: BankrunProvider → LiteSVMProvider, startAnchor → fromWorkspace.
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { Keypair } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { Counter } from "./anchor-example/counter";
const IDL = require("./anchor-example/counter.json");

test("anchor (bankrun, legacy)", async () => {
  const context = await startAnchor("tests/anchor-example", [], []); // (workspace, extraPrograms, extraAccounts)
  const provider = new BankrunProvider(context);
  const program = new Program<Counter>(IDL, provider);
  const kp = Keypair.generate();
  await program.methods.initialize().accounts({ counter: kp.publicKey }).signers([kp]).rpc();
});
```

The migration is mechanical because `anchor-litesvm` mirrors the shape: `BankrunProvider` → `LiteSVMProvider`, `startAnchor(path, ...)` → `fromWorkspace(path)`. A clearly-labeled legacy example is in [examples/tests/bankrun.test.ts](../examples/tests/bankrun.test.ts).

---

## Fixtures: loading real programs and accounts

Tests rarely run in a vacuum — you need real mints, programs, and account snapshots. Each tool loads them differently.

**Mollusk (Rust):** put extra `.so` files in `tests/fixtures/` (Mollusk searches it first), and construct dependency accounts directly in the `accounts` vec you pass to `process_*`. To use a real on-chain account, dump it and decode it into an `Account`:

```bash
solana account TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --output json --output-file tests/fixtures/token2022.json
# dump a program's executable as a fixture .so:
solana program dump TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb tests/fixtures/token2022.so
```

**LiteSVM (Rust/TS):** inject snapshots with `set_account` / `setAccount`, and load extra programs with `add_program_from_file` / `addProgramFromFile`.

```rust
let raw = std::fs::read("tests/fixtures/usdc-mint.json").unwrap();
let dumped: solana_account::Account = serde_json::from_slice(&raw).unwrap();
svm.set_account(usdc_mint_pubkey, dumped).unwrap();
svm.add_program_from_file(token_2022_id, "tests/fixtures/token2022.so").unwrap();
```

**Validator (`solana-test-validator`):** use the `[[test.validator.clone]]` / `[[test.validator.account]]` entries shown in §4. **Surfpool:** mainnet-forking means most fixtures resolve automatically — you usually only override the specific accounts you want to mutate via cheatcodes.

## Cross-cutting techniques

- **Airdrop / funding.** Mollusk: hand a funded `Account::new(lamports, 0, &system_program::ID)` to the fee payer. LiteSVM: `svm.airdrop(&pubkey, lamports)` / `svm.airdrop(address, lamports(n))`. Validator: `connection.requestAirdrop(pubkey, lamports)` (localnet/devnet only).
- **Slot & time travel.** LiteSVM: `warp_to_slot(slot)` / `warpToSlot(slot)` for slot-height logic; mutate the `Clock` (`get_clock`/`set_clock`, `unix_timestamp`) for time locks. Surfpool exposes clock cheatcodes. `solana-test-validator` cannot fast-forward — prefer LiteSVM/Mollusk for time-dependent tests.
- **Blockhash expiry.** `expire_blockhash()` / `expireBlockhash()` forces the next reuse of a prior blockhash to fail with "blockhash not found" — the unit-test hook for retry/rebroadcast logic (see the `transaction-landing` skill).
- **Asserting program errors.** Anchor custom errors are `ProgramError::Custom(6000 + n)`; framework/constraint errors are below 6000 (e.g. `ConstraintHasOne` = 2001, `ConstraintSeeds` = 2006, `AccountNotInitialized` = 3012). Mollusk: `Check::err(ProgramError::Custom(code))`. LiteSVM Rust: match `TransactionError::InstructionError(i, InstructionError::Custom(code))`. TS: inspect `AnchorError.error.errorCode.{code,number}` or parse `error.logs`.
- **Parameterized tests.** Drive boundary values (0, `u64::MAX`, off-by-one bumps, duplicate keys) in a loop. In Rust, iterate inputs in one `#[test]` (or use `rstest`); in mocha, generate `it(...)` cases from an array. This is where overflow (#8) and rounding (#13) bugs that Anchor cannot catch declaratively surface — pair every value-bearing instruction with extreme-value cases (see [docs/security.md](security.md)).

## Gotchas that cost hours

1. **Two Anchor npm scopes.** 1.x TS client = `@anchor-lang/core`; legacy = `@coral-xyz/anchor` (frozen 0.32.1). `anchor-litesvm` and `anchor-bankrun` still require the legacy scope. Never import both in one project — you get two incompatible `Program`/`BN` types.
2. **`anchor test` no longer boots `solana-test-validator` by default** — it boots **Surfpool** (`>= 1.1.2`). Install Surfpool in CI or pass `--validator legacy`.
3. **`anchor init` default test template is `litesvm` (Rust `cargo test`)**, not ts-mocha. Use `--test-template mocha` for the classic TS suite.
4. **litesvm npm 1.2.0 pins `@solana/kit ^6.10.0`** while the latest Kit is **7.0.0**. Installing Kit 7 alongside litesvm 1.2.0 yields two Kit copies and "branded type" mismatches — pin `@solana/kit` to `6.x` to match, or use the `litesvm@0.8.0` web3.js line.
5. **Mollusk needs the compiled `.so`.** `Mollusk::new(&id, "name")` searches `tests/fixtures/`, `$BPF_OUT_DIR`, `$SBF_OUT_DIR`. Run `anchor build` / `cargo build-sbf` first, or set `SBF_OUT_DIR`. Mollusk skips the loader/`AccountsDB`, so pair it with LiteSVM for integration coverage.
6. **The Rust litesvm template loads the `.so` via `include_bytes!`** at `CARGO_TARGET_TMPDIR/../deploy/<name>.so` — `cargo test` fails until `anchor build` has produced that artifact.
7. **`.accounts()` is strict.** If account resolution rejects a key, switch to `.accountsPartial()` to pass a subset and let Anchor resolve the rest.
8. **Anchor's generated test crates differ for `v2`.** `anchor init --anchor-version v2` generates tests against `anchor_lang_v2` / `anchor_v2_testing` (a different API). Default is `v1` — keep it; v2 is experimental and out of scope.

## References

- Anchor testing docs: https://www.anchor-lang.com/docs/testing
- LiteSVM (repo + Rust crate): https://github.com/LiteSVM/litesvm
- node-litesvm (npm) README + API: https://github.com/LiteSVM/litesvm/tree/master/crates/node-litesvm
- `anchor-litesvm` (TS): https://github.com/LiteSVM/anchor-litesvm
- Mollusk: https://github.com/anza-xyz/mollusk
- `mollusk-svm` / `mollusk-svm-bencher` (crates.io): https://crates.io/crates/mollusk-svm
- Surfpool: https://docs.surfpool.run
- `solana-test-validator`: https://docs.anza.xyz/cli/examples/test-validator
- `solana-bankrun` (deprecated): https://github.com/kevinheavey/solana-bankrun
- `anchor-bankrun` (deprecated): https://github.com/kevinheavey/anchor-bankrun
