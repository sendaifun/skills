# Worst-Case Playbook

Per-archetype authoring guidance for guided-sim assessments. The riptide-assess
skill loads this file when the execution-path classification returns
`guided-sim-authored`: the archetype from the classification note selects an
entry, and the entry tells the authoring pass what worst case to hunt before
any code is written.

Every entry uses the same fields:

- **Worst case to hunt** — the economically real failure this archetype is
  exposed to, stated as a concrete scenario against the target program, not a
  generic category.
- **Swept axis** — the exogenous stress parameter to sweep (declared as
  `[sim.sweep]` in `.riptide/sim/Riptide.toml`) and the range that brackets
  the interesting region.
- **Deciding invariant / metric** — the invariant or metric whose movement
  decides the verdict, with the severity that makes the failure gradient
  visible on the risk surface.
- **Signal trap** — where a naive measurement reads flat while the real
  signal moves; name the field to measure instead.
- **Honest framing** — how to state the result: inherent risk versus bug,
  the swept axis as exogenous stress rather than a protocol knob, and the
  reminder that a held invariant across the full sweep is a robustness
  result, not a failed assessment.

An entry that has not been written yet is marked *(entry not yet written)*.
For those archetypes, derive the worst case from the protocol-archetype
defaults table in `SKILL.md` plus the target program's actual P0 flows, and
keep the five fields above as the working structure.

## irs (interest-rate swap)

- **Worst case to hunt:** The LP pool is the unhedged counterparty to a
  one-sided book under a rate move that goes against it. A balanced book
  self-hedges and shows zero LP loss, so seed the **adversarial** book: every
  trader on the same side (e.g. all-PayFixed), then shock the rate index in the
  direction that makes that side win. The pool pays the winners. Run the full
  lifecycle on the real program: LPs deposit → traders `open_swap` (all one
  side) → a rate-index shock via the program's oracle setter → `settle_period`
  → third-party `liquidate_position` → LP `request_withdrawal`, with negative
  controls (a stale-index `open_swap` must reject; a healthy-position
  liquidation must reject).
- **Swept axis:** Rate-shock magnitude in bps (the exogenous market rate move),
  bracketed from `0` (healthy control) up to just under the program's
  per-period rate breaker — e.g. `rate_shock_bps ∈ {0, 100, 200, 300, 400, 490}`
  under a 5%/period breaker. Declare it `[sim.sweep]` with a healthy `0` control.
- **Deciding invariant / metric:** Metric `lp_outflow` — the LP pool's payout
  to the winning side, summed from each position's realized PnL. The deciding
  invariant fires (error-severity, e.g. `lp_outflow_material`) when outflow
  crosses a **stated** risk line (e.g. 1% of seeded reserve), which gives the
  surface a visible gradient; the hard solvency bound
  (`collateral_vault + lp_vault` covers all claims, no `unpaid_pnl`) is checked
  separately and is expected to hold.
- **Signal trap:** Measure **`realized_pnl` summed across positions**, not
  `lp_nav` or an LP-share token balance. The pool's bookkeeping NAV field can
  read flat while value is actually flowing to the winning traders; the real
  outflow only shows up in the positions' settled PnL. Reading the stub-inert
  NAV field is how an agent concludes "no signal" on a pool that is in fact
  bleeding.
- **Honest framing:** Directional LP P&L under a one-sided book is the
  **inherent risk an LP underwrites**, not a protocol bug — a balanced book
  hedges it away. The rate shock is an **exogenous** market move, not a protocol
  knob, so the report's "keep `rate_shock_bps` in {…}" line must be reframed as
  a statement about where the outflow threshold sits (a surface fact), not a
  tuning instruction. Solvency holding across the whole sweep is a **robustness
  result** worth stating plainly; the heatmap "failure rate" is the rate at
  which outflow crossed the chosen line, not an insolvency rate. If an external
  reserve is inert in stub-oracle mode, say the on-chain threshold is a
  conservative (early) bound. *(Validated on Anemone: solvency held to the 490
  bps breaker; LP outflow crossed 1% of the $1M reserve above ~300 bps.)*

## lending

- **Worst case to hunt:** A collateral price crash that **outruns** liquidation,
  so recovery is capped below the outstanding debt and the lender (or protocol)
  eats the shortfall as bad debt. The realistic worst case is the crash landing
  **before** the liquidator reacts — and check *who* may liquidate: if
  `liquidate_loan` is permissioned (lender-only, or keeper-only) there is no
  third-party backstop on an active position, which widens the exposure window.
  Run the lifecycle on the real program: borrower posts collateral at the
  healthy ratio → lender funds → **crash the collateral oracle by the swept
  bps** → liquidate → measure recovered collateral vs outstanding debt. Negative
  control: a healthy (un-crashed) loan must reject liquidation.
- **Swept axis:** Collateral crash magnitude in bps (exogenous price move),
  bracketed across and past the liquidation threshold — e.g.
  `collateral_price_drop_bps ∈ {0, 1000, …, 6000}` (0–60%) so the surface spans
  both the "liquidation becomes eligible" knee and the "collateral < debt" onset.
  Crash via the **oracle account bytes** (see the Pyth `PriceUpdateV2` helper in
  the authoring patterns), not a primitive argument.
- **Deciding invariant / metric:** Metric `bad_debt` — the USD shortfall
  (`outstanding_debt − recovered_collateral_value`, clamped at zero) the lender
  absorbs. The invariant fires (e.g. `lender_bad_debt`) when bad debt crosses a
  stated line (e.g. 1% of debt value). Note the **two** thresholds the gradient
  reveals: liquidation becomes *available* at one crash level (the
  `liquidation_threshold` ratio) but the lender stays whole until a *later*
  level where collateral value crosses below debt — report both.
- **Signal trap:** Measure the **realized shortfall** from actual recovered vs
  owed value after the liquidation transaction runs — not a health-factor or
  LTV field, and not "did liquidation succeed." Liquidation can transition the
  loan to `Liquidated` correctly (status flips, accounting is right) while the
  lender still eats bad debt; an agent that checks only the status byte or a
  pre-crash health ratio reads "liquidation worked → safe" and misses the
  shortfall entirely. The signal is the money, measured post-liquidation.
- **Honest framing:** Bad debt when a crash outruns liquidation is the
  **inherent risk of collateralized lending**, not an accounting bug — the
  liquidation math is doing exactly what it should (payout capped at collateral
  held). The crash is **exogenous**. Surface the permissioning nuance as a
  deliberate design question (no third-party backstop on an active underwater
  loan), not a defect. If you drive the oracle directly, state the oracle's own
  staleness/confidence/verification guards are out of scope — you are isolating
  the protocol's response to a price *path*. *(Validated on Agio: liquidation
  accounting correct at every level; lender bad-debt onset at ~33% crash —
  liquidation eligible at ~20%, lender whole until ~33%; `liquidate_loan`
  lender-only.)*

## nav-vault

- **Worst case to hunt:** A first-mover dilution run: a real asset markdown lands
  on the vault while a **stale-high** NAV attestation is still inside its
  freshness/TTL window, so an early withdrawer can redeem against the stale-high
  NAV and drain value from the investor who stays. Run the lifecycle on the real
  program: initialize → two investors `deposit` at par against a fresh
  attestation → a real asset markdown of the swept magnitude lands **while the
  prior high attestation is still in-window** (not yet refreshed) → the early
  investor `initiate_withdrawal` → `finalize_withdrawal` under the stale-high NAV
  → the staying investor withdraws against the refreshed, true NAV. Measure how
  much the early mover extracted beyond fair share and how much the stayer lost.
- **Swept axis:** Markdown magnitude in bps of real vault assets lost while the
  high attestation is in-window — e.g. `nav_markdown_bps ∈ {0, 500, …, 5000}`
  (0–50%). `0` is the **positive control**: a fresh-and-true NAV must pay exact
  pro-rata (this is the baseline the execution-honesty gates require).
- **Deciding invariant / metric:** Metrics `dilution_loss` (the stayer's
  shortfall vs fair value) and `early_overpayment` (the runner's excess over
  fair value), both in base units. The invariant fires (e.g. `investor_dilution`)
  when `dilution_loss` crosses a stated line (e.g. 1% of the stayer's fair
  value). A flat-zero `dilution_loss` across the full markdown sweep is the
  robustness result — but it is only meaningful if the positive control passed
  and the withdrawal lifecycle actually executed (both enforced by the
  execution-honesty gates).
- **Signal trap:** Measure the **realized payout deltas** — `a_payout`/`b_payout`
  vs each investor's `fair_value` (i.e. vault-drain), the value that actually
  left the vault — not the attested NAV field. The NAV number is a
  trusted-but-bounded *input* you constructed; reading it back tells you nothing
  about whether value was extracted. A stale-high NAV that merely raises a
  one-sided cap (payout = `min(real_pro_rata, nav_value × fraction)`) never binds
  upward, so the drain is zero *because of the cap's direction* — which you can
  only see by measuring payouts, not the NAV.
- **Honest framing:** A held (flat-zero) surface is **evidence over the tested
  region, not unconditional safety** — say so explicitly. The markdown is an
  exogenous asset-value move; the NAV attestation is trusted-but-bounded (you
  test the mechanics' response to a NAV *path*, not the attestor's honesty — the
  authority signer, TTL cap, and value cap are the controls on the attestation
  itself and you rely on them). When the guard holds, explain the **structural
  reason** (e.g. the NAV cap is one-sided and can only *lower* a payout priced
  off the real vault balance) rather than asserting safety. *(Validated on
  Defunds: zero dilution across 0–50% markdown; the audit-fix NAV cap held
  structurally; positive control at markdown 0 paid exact pro-rata.)*

## amm

*(entry not yet written — AMMs usually classify as `baseline-sim`;
use the `amm` row of the defaults table.)*

## perps

*(entry not yet written — use the `perps` row of the defaults table as
what-to-test guidance.)*

## lst

*(entry not yet written — use the `lst` row of the defaults table as
what-to-test guidance.)*

## stablecoin

*(entry not yet written — use the `stablecoin` row of the defaults table as
what-to-test guidance.)*

## orderbook

*(entry not yet written — keeper settlement and matching choreography
classify as guided-sim; derive the worst case from the target program's
match/settle flows.)*
