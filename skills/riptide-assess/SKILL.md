---
name: riptide-assess
description: >-
  Assess a Solana program with Riptide — run deterministic, guided LiteSVM
  simulations against the real on-chain program to produce a risk assessment
  with reproducible evidence. Use when the user says "assess my protocol", "is
  my protocol safe", "run Riptide on this", "give me a risk assessment", or
  "riptide-assess", or points you at an Anchor/Solana lending, AMM, perps,
  liquid-staking, or stablecoin repo and wants one agent-led flow from program
  source to an assessment report. Detects the protocol family, scopes what the
  guided sim must handle (typed args, Pyth/Switchboard oracle-account bytes,
  liquidator/keeper actors, multi-instruction sequences), authors and runs the
  sim, then returns assessment evidence and exact rerun commands.
---

# riptide-assess

Riptide runs **deterministic guided simulations** of Solana programs to produce
a **risk assessment** backed by reproducible evidence. This skill is the single
front door: point it at a Solana program repo, answer at most three scoped
questions, and it detects the protocol family, authors a project-owned Rust
simulation crate that drives the program's real `.so` under stress, runs it over
a declared fixed-seed sweep, and emits an assessment (`assessment.md` +
`assessment.json`) plus an executive brief — with the exact commands to
reproduce every figure.

There is one execution path: a **guided simulation**. The agent authors the
adapter, sim crate, personas, flows, and invariants — the user does not.

## Trigger & Mission

Invoke this skill when an agent should turn a Solana program repo into a Riptide
risk assessment — when the user asks to "assess my protocol", "run Riptide on
this", check whether a protocol is "safe", or otherwise wants evidence about a
lending / AMM / perps / liquid-staking / stablecoin program's behavior under
stress.

The outcome is an `assessment.md` / `assessment.json` plus an evidence pack and
the **exact rerun commands** over a declared, fixed-seed region. This is
**simulation evidence over a declared region — not an audit signoff**, not
formal verification, and not a mainnet prediction. Hold that boundary in every
claim you make.

## First Contact / Prerequisites (auto-install)

If `riptide --help` fails, the CLI is not set up. Run the bundled bootstrap from
this skill's directory (idempotent — safe to re-run):

```bash
bash install.sh
```

It installs the Riptide CLI via the public installer (`https://riptide.run/install`).

**Riptide is NOT on npm** — do not `npm i riptide`. The CLI scaffolds a
project-owned Rust crate that builds against a vendored runtime (there is no
separate engine binary), so the host needs:

- `rustup` / `cargo` + `rustc`
- `node >= 20` and `npm`
- the Solana SBF toolchain (`cargo-build-sbf`, via the Anza/Solana install)

Confirm the install before doing anything else:

```bash
riptide --version     # expect v0.12.0 or newer
riptide doctor        # static health check of the environment + adapter
```

## How To Run (the CLI surface)

Use **only** these commands. Never invent flags or subcommands.

- `riptide init` — scaffold a thin `.riptide/` bootstrap in the target repo.
- `riptide readiness <dir> [--json]` — read-only repo classification check.
- `riptide doctor` — static adapter/environment health check.
- `riptide sim generate --adapter <adapter.toml>` — scaffold the project-owned
  guided-sim crate (`.riptide/sim`).
- `riptide sim refresh --adapter <adapter.toml> --dir .riptide/sim` — regenerate
  builders after IDL changes without overwriting hand-authored flows.
- `riptide sim run <sim-dir> [--iterations N] [--flows N] [--seed HEX] --out <dir>`
  — execute the sweep; reads `[sim.sweep]` from `Riptide.toml`.
- `riptide sim surface <artifact-dir> --sim <sim-dir>` — build the cartography
  root (campaign-summary.json + risk-surface.json + retention-manifest.json).
- `riptide sim lint <sim-dir>` — validate the sim manifest.
- `riptide sim review <artifact-dir>` — review a run's retained evidence.
- `riptide sim fork` / `riptide sim debug` — fork-cache and debug helpers.
- `riptide review <guided-sim-root>` — root reviewer over a surfaced root.
- `riptide assess <guided-sim-root> [--input <json>] [--brief] [--html|--pdf]`
  — ingest a surfaced root and emit the assessment.

The parameter sweep lives in the `[sim.sweep]` block of
`.riptide/sim/Riptide.toml` — it is configuration, **not** a CLI flag. Do not
pass the sweep on the command line; `riptide sim run` reads it from the TOML.

## Flow

Detect → Scope → Setup → Run → Surface → Assess. Work in one continuous session.

### 1. Detect

1. Establish the repo root from `.riptide/`, `Anchor.toml`, `Cargo.toml`,
   `target/idl`, or the current directory.
2. Read existing artifacts before asking the user: `.riptide/adapters/*.toml`
   (especially `[semantics].class`), `target/idl/*.json`, `app/src/idl/*.json`,
   source, tests, any existing `.riptide/sim/`, and `target/deploy/*.so`.
3. Optionally classify with the read-only check: `riptide readiness . --json`.
4. Classify the protocol family from semantics first, else source/IDL evidence:
   - **lending** — `borrow`, `repay`, `deposit`, `withdraw`, `liquidate`,
     collateral, debt, reserve, oracle.
   - **amm** — `swap`, `add_liquidity`, `remove_liquidity`, pool, reserve, LP
     mint, fee, tick/price.
   - **perps** — `open_position`, `close_position`, margin, leverage, funding,
     oracle, insurance fund.
   - **lst** — stake, unstake, exchange rate, validator, reserve, withdrawal
     queue, slash.
   - **stablecoin** — mint, redeem, collateral, liability, peg, PSM, reserve,
     hedge.
5. Record a one-screen detection note: family, semantic class, confidence
   (`high`/`medium`/`low`), evidence paths, competing interpretations. If
   confidence is low between two families, ask one classification question
   (counts toward the three-question limit).

Read the P0/P1 state-changing instructions: for each, read the IDL `args` and
`accounts` entries plus the handler source. This feeds the next step.

### 2. Scope — classify what the guided sim must handle (A–F)

There is ONE execution path (the guided sim). This step is not "which path" —
it is "**what authoring complexity** does this protocol need", so the sim crate
lands the flows right the first time. For every P0/P1 instruction, check the six
triggers below. Each trigger that fires names a concrete authoring pattern.

**Trigger A — non-primitive or enum instruction arguments.** The instruction
takes an enum, struct, `String`, or `Vec` argument, which raw scalar dispatch
cannot encode. Detect: IDL argument types other than integers, bools, and
pubkeys — `"defined"`, `"string"`, or `"vec"` entries in the IDL, or enum/struct
parameters in the handler signature. Worked example: a `swap` taking a
`SwapDirection` enum, or order placement taking side/kind enums — both need
typed argument builders in a generated sim crate.

**Trigger B — external oracle accounts needing byte-construction.** The program
reads price or attestation bytes from an account owned by an external program
(Pyth receiver, Switchboard, a custom attestor), and the stress axis is that
account's contents, so the sim must construct and mutate those bytes
deterministically. Detect: external SDK account types in the handler (for
example `pyth_solana_receiver_sdk::price_update::PriceUpdateV2`), calls like
`get_price_no_older_than`, or freshness windows checked against the clock.
Worked example: a liquidation reads a Pyth `PriceUpdateV2`, so the sim builds the
account bytes and crashes the price; a withdrawal checks a NAV-attestation
account inside a freshness window.

**Trigger C — third-party / target-vs-agent actions.** An actor signs an
instruction that operates on another actor's position or order — liquidator,
keeper, matcher, settler. A self-signed persona action only expresses an agent
acting on its own accounts. Detect: instruction account sets that contain both a
signer and a different user's position/order PDA — `liquidate`, `settle`,
`slash`, keeper cranks. Worked example: a liquidation that lets any third party
repay a borrower's debt and seize collateral; a keeper that settles a buyer and
a seller it does not own.

**Trigger D — multi-instruction sequences.** A flow only completes across an
ordered multi-instruction transaction or a multi-transaction sequence (request,
then execute, then claim). Detect: request/execute instruction pairs,
pending-state accounts, or instruction-introspection requirements such as a
required ed25519 verification instruction. Worked example: a withdrawal that is
a multi-transaction sequence whose execute step must land inside the attestation
window; a flow requiring an ed25519 signature verification instruction ahead of
the consuming instruction in the same transaction.

**Trigger E — dynamic `remaining_accounts`.** The instruction's account set
varies per call with protocol state, so no static account mapping exists.
Detect: `ctx.remaining_accounts` in handlers, or loops over member/position
lists. Worked example: a slash redistribution that iterates every remaining
member's account; an integration that passes a dependency account set changing
per call.

**Trigger F — custom CPI bootstrapping.** Reaching a runnable tick-0 state needs
CPIs into external programs, or manual deployment and configuration of sibling
programs. Detect: init handlers that CPI into a dependency program, multi-program
genesis in `Anchor.toml` test config, or registration steps in the test suite.
Worked example: a program that must bootstrap its dependency programs and
register its signature oracle before any flow can run.

**Verdict:**

- **No trigger on any P0/P1 flow → `baseline-sim`.** Low-touch: primitive
  arguments, self-signed instructions, no externally owned account bytes to
  evolve mid-run. Confirm by running, not reading — a one-seed smoke. Borderline
  calls (a keeper-reward liquidation that might still be self-service; a mock
  oracle passed as a primitive argument a real deployment would replace with an
  oracle account) flip on real evidence — record the fragility.
- **One or more triggers on a P0 flow → `guided-sim-authored`** for those flows:
  the sim hand-authors the patterns the triggers named. Trigger-free flows stay
  low-touch within the same crate.
- **FHE/MPC/ZK, external-venue execution, or off-chain matching the sim cannot
  model → `unsupported`** for those surfaces. Name them as scope boundaries
  instead of silently skipping them.

Record the classification note and carry it into the final report:

```text
program: <name>
archetype: <amm | lending | perps | lst | stablecoin | irs | nav-vault | orderbook | other>
triggers: <none | subset of A-F, with one line of evidence each>
authoring patterns: <per trigger — A typed-argument builders; B oracle-account
  construction; C third-party-actor dispatch; D multi-instruction flow;
  E dynamic account resolution; F bootstrap services>
verdict: <baseline-sim | guided-sim-authored | unsupported>
```

When any trigger fires, read `resources/worst-case-playbook.md` for the
archetype's worst case to hunt, the axis to sweep, and the deciding
invariant/metric — **before** asking any scoping question.

Then ask **no more than three questions total**, one at a time, never for facts
already visible in source/IDL/tests/`.riptide`:

1. **Primary risk objective** — two to four options derived from the family and
   actual surfaces; recommend the archetype default unless evidence points
   elsewhere.
2. **Flow emphasis** — stress-flow families or program-specific flows matching
   real instructions/accounts; include one "balanced default".
3. **Missing assumption** — only when a material fact is not derivable (oracle
   account layout, authority policy, dependency fixture source, intended fee
   cap, accepted scope exclusion).

If the user says "use defaults", proceed with archetype defaults narrowed to the
program, and still show the choices before running.

### 3. Setup (folded inline — the guided-sim authoring contract)

This skill is self-contained: the setup below is the essential authoring
altitude. For the full configuration contract (repair-loop taxonomy, profiles,
verdict semantics), see the public repo at
`https://github.com/riptidesim/riptide` — it is optional reading, never a
required co-located file.

**a. Bootstrap the scaffold.**

```bash
riptide init      # only if .riptide/ is absent and the program name is unambiguous
```

`riptide init` creates only a thin `.riptide/` bootstrap (adapter placeholder +
`GETTING-STARTED.md`). You own the rest.

**b. Author the adapter** (`.riptide/adapters/<program>.toml`). It declares
account shape, instruction mappings, scheduled actions, observations, personas,
invariants, semantics, oracle channels, and `[lineage]`. Rules:

- If `program_so` and `idl_path` are both set, the runtime is Generic SBF/IDL.
- Every required IDL account must be represented by `[accounts.<name>]`, a
  recognized signer alias (`authority`, `owner`, `user`, `payer`), a well-known
  program/sysvar alias, or an IDL literal `address`. Do not omit setup-heavy
  accounts (`price_update_v2`, reserve vaults, per-agent token accounts) just
  because generated setup fills their bytes later.
- Top-level `[[invariants]]` may reference only keys declared in
  `[observations]`.
- Always include `[lineage]` with the IDL source, assumptions, and unsupported
  surfaces.

Validate after every adapter edit: `riptide doctor`. Fix any named field error
before moving on.

**c. Generate the sim crate.**

```bash
riptide sim generate --adapter .riptide/adapters/<program>.toml
```

This scaffolds `.riptide/sim` with `Riptide.toml`, `src/flows.rs`,
`src/invariants.rs`, generated `types.rs` / `accounts.rs`, and a `services/`
directory. Setup code carries `TODO(setup)` markers where pre-tick-0 state must
exist. Keep `types.rs` / `accounts.rs` regenerated-only; put hand-authored
actions, dynamic account resolution, and service models under `flows.rs`,
`invariants.rs`, `services/`.

**d. Fill the `TODO(setup)` seams.** Fill every seam with **deterministic
facts** — account bytes, SPL mints/vaults, PDAs, sibling programs, oracle
accounts — derived from local source, IDL, tests, constants, and fixtures.
Fixed amounts, fixed decimals, fixed seeds, no network calls. **TODO-only setup
is not acceptable** when setup-heavy accounts are required and derivable: before
declaring a blocker, inspect source/tests/IDL/dependency types/constants/fixtures
for owners, discriminators, sizes, PDA seeds, feed IDs, and serialization. If a
fact genuinely cannot be determined locally, stop and report
`blocked = missing deterministic <fact> for guided-sim setup`, naming the
account/instruction — never hide it behind a vague comment.

Declare external programs, accounts, and forked snapshots generically in
`Riptide.toml` (do not teach Riptide core protocol-specific layouts):

```toml
[[sim.programs]]
address = "<program-id>"
program = "../target/deploy/dependency.so"

[[sim.accounts]]
address = "<account-pubkey>"
filename = "fixtures/accounts/dependency-account.json"

[[sim.fork]]
address = "<mainnet-account-pubkey>"
cluster = "mainnet"
filename = "fork-cache/mainnet/dependency-account.json"
overwrite = false
```

**e. Author flows, personas, and the sweep.** Generic personas stay inline in
the adapter; the sweep and flows in the crate drive them. Map triggers to seams:
A → typed builders; B → deterministic oracle-account bytes in setup seams or
project-owned services; C/D/E → hand-authored flows in `flows.rs`; F →
`Riptide.toml` program/account declarations plus bootstrap services. Then
declare the sweep + evidence-honesty blocks in `.riptide/sim/Riptide.toml` (see
Authoring patterns below). Map IDL changes forward with
`riptide sim refresh --adapter .riptide/adapters/<program>.toml --dir .riptide/sim`.

### 4. Run

Validate, then smoke before the full sweep:

```bash
riptide sim lint .riptide/sim
riptide sim run .riptide/sim --iterations 5 --flows 20 --seed 1337 --out .riptide/sim/artifacts/smoke
riptide sim review .riptide/sim/artifacts/smoke
```

`riptide sim run` reads `[sim.sweep]` and runs one iteration per
(value, seed replicate). Verified options: `--iterations <n>`, `--flows <n>`,
`--seed <hex>`, `--out <dir>`. Do not run the full sweep until the one-seed smoke
passes.

Classify failures: **setup errors** are repair-loop inputs — return to the
responsible layer (adapter / setup seam / flow), fix it, and rerun from the
earliest affected gate. **Invariant failures are evidence, not setup failure** —
the artifacts are still reviewable; continue. If a flow needs Rust the crate does
not yet author, write it in `.riptide/sim/src/flows.rs` and keep coverage
bounded.

Once the smoke passes, run the full sweep:

```bash
riptide sim run .riptide/sim --flows 20 --out .riptide/sim/artifacts/<run>
```

### 5. Surface

Build the cartography root the assessment reads:

```bash
riptide sim surface .riptide/sim/artifacts/<run> --sim .riptide/sim
```

This writes the cartography root — `campaign-summary.json` +
`risk-surface.json` + `retention-manifest.json` — and records the
execution-honesty gate report. Note the root path it prints.

### 6. Assess

Author a repo-local `.riptide/assessment-input.json` (an `AssessmentInputs`
object) before the final render — it turns the generic templated defaults into
an assessment that names the protocol's actual flows, figures, and boundaries.
Skipping it ships the generic layer. Cover at minimum `verdict`,
`riskPlan.target_claim`, `riskPlan.guided_sim_boundaries`, and explicit
`coverage[]` rows (one per P0 flow: `priority`, `flow`, `status`,
`evidence_tier`, `commands`, `artifacts`, `notes`). Use an accepted `status`
(`covered`, `covered by guided sim`, `blocked`, `out of scope`, `not assessed`).
Every line must be backed by what actually ran — it adds protocol nouns and
figures, never new findings. See `examples/assessment-input.json` for the shape.

Review the surfaced root, then generate the assessment with the brief — this is
the standard invocation, not an on-request variant:

```bash
riptide review .riptide/sim/artifacts/<run>/<surfaced-root>
riptide assess <guided-sim-root> --brief --input .riptide/assessment-input.json
```

`riptide assess` is ingest-only: it reads the surfaced root, re-verifies the
execution-honesty gates, and emits `assessment.json` + byte-deterministic
`assessment.md` (plus `brief.html` / `brief.pdf` with `--brief`). It **blocks**
on any failed gate. Use `--html` / `--pdf` only when the user asks for
presentation exports. A blocked assess that names a failed gate is a setup
repair (fix the positive control / make required lifecycle flows execute /
restore determinism, then re-run `sim run` + `sim surface` + `assess`) — never
a hand-written report.

## Authoring patterns (guided sim)

When triggers fire, the hard-won parts are already library code. Wire these
instead of re-deriving them.

**Oracle-account construction (Trigger B).** Use
`riptide_sim::oracle::PythPriceUpdate` to build the Pyth `PriceUpdateV2` account
a program's `get_price_no_older_than(...)` reads. The builder owns the full
134-byte layout verified against `pyth-solana-receiver-sdk` — never hand-roll
those bytes:

```rust
use riptide_sim::oracle::{crash_in_place, PythPriceUpdate};

let mut update = PythPriceUpdate::new(FEED_ID, INITIAL_PRICE, -8, base_ts);
update.install(&mut sim.world, price_update_key)?;
// Later, mid-lifecycle: the crash (the swept stress), re-stamped fresh so the
// program's freshness window is isolated from the price move.
crash_in_place(&mut sim.world, &price_update_key, crashed_price, now)?;
```

For non-Pyth attestors (custom NAV attestations, Switchboard), follow the same
shape — a deterministic byte builder in your sim's `services/` with a
`set`/`crash` mutator — rather than scattering offsets through flows.

**Third-party-actor dispatch (Trigger C).** Use
`riptide_sim::dispatch::ThirdPartyDispatch` for any instruction where one actor
signs and operates on another actor's position/order. Push accounts in IDL
order; `build()` rejects the three recurring hand-roll bugs (target marked
signer, actor never signing, a stray third signer):

```rust
use riptide_sim::dispatch::ThirdPartyDispatch;

let mut dispatch = ThirdPartyDispatch::new(liquidator, position_owner);
dispatch
    .shared(protocol_state, false)
    .target_account(position_pda, true)   // owner's position; never signs
    .actor_account(liquidator_ata, true)  // receives seized collateral
    .actor_signer(true);                  // the sole signer
let (metas, signer) = dispatch.build_with_signer()?;
```

**The sweep + control + invariant scaffold.** A guided sim destined for a
risk-surface assessment declares these blocks in `.riptide/sim/Riptide.toml`:

```toml
[sim.sweep]                      # the exogenous stress axis
name = "collateral_price_drop_bps"
values = [0, 1000, 2000, 3000, 4000, 5000, 6000]
seeds_per_value = 4

[sim.positive_control]           # the known-correct baseline coordinate
value = 0                        # parameter defaults to the sweep name

[sim.lifecycle]                  # core flows that must execute on-chain
required_flows = ["create_lend_offer", "accept_lend_offer", "liquidate_loan"]

[sim.cartography]                # surface metadata
class = "lending.v1"
risk_objective = "<one-sentence risk objective with scope boundaries>"
```

In `flows.rs`, read the swept coordinate with `world.sweep_value("<axis>")`,
echo it with `world.record_parameter`, record the deciding signal with
`world.record_metric`, and fire the deciding invariant with
`world.record_invariant_fire` when the metric crosses the stated risk line — the
playbook entry names the metric, the trap, and the line. Author negative
controls (a healthy-state action that must reject) with the transaction
builder's `expect_error()`, so a rejection is asserted, not silently tolerated.

For the deep per-archetype worst-case archetypes (worst case to hunt, axis to
sweep, deciding invariant, signal trap, honest framing), see
`resources/worst-case-playbook.md`.

## Honesty Discipline (non-negotiable)

Riptide has no automatic oracle for "is this finding real and honestly framed",
so the report's credibility rests on these rules. The runtime enforces the first
three as execution-honesty gates — evaluated at `riptide sim surface`, warned at
`riptide sim run`, and **blocking** at `riptide assess` — and the rest are
framing rules the gates cannot check, so following them is on you.

1. **Positive control.** Every sweep declares a coordinate whose outcome is
   known-correct (`[sim.positive_control]`, usually axis value `0`: no shock,
   fresh-and-true attestation paying exact pro-rata) and that coordinate must
   pass. Without it a flat surface is unfalsifiable. *Enforced: the
   `positive_control` gate blocks emit when the declaration is missing, the
   coordinate never ran, or it fired an invariant.*
2. **Real-program execution — never mock.** Flows execute the target program's
   real `.so`. Constructed external-account bytes (oracle prices, attestations)
   are the stress input, not a mock of the target; the target program itself is
   never stubbed or reimplemented. A flat result is only robustness if the
   intended lifecycle actually ran on-chain. *Enforced: the `lifecycle_executed`
   gate blocks emit when declared `[sim.lifecycle] required_flows` never executed
   successfully — "no-op, not robustness".*
3. **Determinism.** Fixed seeds, fixed amounts, no wall clock, no network. The
   same command must reproduce the same bytes. *Enforced: the `determinism` gate
   re-hashes `risk-surface.json` at emit against the hash recorded at surface
   time, and `riptide assess` refuses to overwrite an existing
   `assessment.json`/`assessment.md` that does not match the freshly rendered
   bytes.*
4. **Scope and boundary framing.** The result is evidence over the declared
   region — one configuration, the swept axis, the listed flows — not a safety
   statement. Name what was held fixed, what was out of scope (e.g. an oracle's
   own staleness guards when you drive the price directly, an external reserve
   that is inert in stub mode), and say "evidence over the declared region",
   never "safe".
5. **Robustness is a valid result — never manufacture a finding.** A flat
   surface with the positive control passing and the lifecycle executed is a
   real, publishable robustness result. State the structural reason the guard
   holds rather than asserting safety, and do not tighten thresholds or distort
   scenarios until something fires.
6. **The fire-threshold is a stated risk line; the gradient is the signal.** The
   invariant's threshold (1% of reserve, 1% of debt value) is a chosen reporting
   line, not a discovered boundary. Report where the metric starts moving and
   where it crosses the line — both are surface facts.
7. **Exogenous-axis cover-framing.** The swept axis is an exogenous stress (a
   market crash, a markdown), not a protocol knob. The auto-generated finding
   title and any "keep `<axis>` in {…}" safe-region line must be reframed in your
   delivery as "the onset sits at X on the axis" — a fact about where the risk
   begins, never a tuning instruction to the protocol team. No gate can check
   this; it is a delivery-step rule.

## When it hits a wall — fail fast, file an issue

If a protocol surface cannot be modeled — FHE/MPC/ZK, external-venue execution,
off-chain matching the sim cannot drive — do **not** paper over it. Name it as an
explicit **scope boundary** in the assessment (verdict `unsupported` for that
surface) and state what evidence the rest of the run still produced.

If a blocker is in Riptide itself (a CLI validation gap, a missing builder, a
runtime limitation), report the blocked state with the exact failed command, the
error summary, what you repaired, and the smallest missing fact — then file or
link an issue at `https://github.com/riptidesim/riptide/issues`. Never substitute
a hand-written report for a blocked assess gate.

## References

- Riptide (public repo + full configuration contract):
  `https://github.com/riptidesim/riptide`
- Issues: `https://github.com/riptidesim/riptide/issues`
- Per-archetype worst-case authoring: `resources/worst-case-playbook.md`
- Assessment-input shape: `examples/assessment-input.json`
