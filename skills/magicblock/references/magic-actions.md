# Magic Actions (Post-Commit Actions)

Magic Actions are base-layer instructions scheduled inside an ER transaction.
Within each attempted base-layer transaction, the commit and actions execute
atomically. If any BaseAction fails, however, the committor removes all BaseActions in that affected
`TransactionStrategy` and retries its remaining commit strategy. That removal does not include actions
in other transaction or finalize strategies. Magic Actions let an ER-side instruction trigger base-layer
work — updating a leaderboard, distributing rewards, transferring SPL
tokens — without a separate user transaction or external relayer.

The ER submission, commit sealing, and visible base-layer side-effect are different observation points.
Do not report the action complete from the ER signature alone.

## Contents

- [When to use](#when-to-use)
- [Action handler instruction](#action-handler-instruction-target-of-the-call)
- [Schedule a commit and action](#schedule-a-commit--action-from-the-er)
- [Multiple actions](#multiple-actions)
- [Commit-and-undelegate](#commit-and-undelegate-with-actions)
- [PDA-signed actions](#pda-signed-actions-escrow-authority)
- [Field reference](#callhandler-field-reference)
- [Common errors](#common-errors)
- [Failure, observation, and recovery](#failure-observation-and-recovery)
- [Implementation checklist](#implementation-checklist)

## When to use

- After committing ER state, request a follow-up base-layer instruction (e.g., update a global
  leaderboard once a player's score is committed), then observe whether it actually ran.
- Attempt commit + undelegate + side-effects in one base-layer transaction, with recovery if an action
  failure causes every BaseAction in that transaction strategy to be removed before commit retry.
- PDA-driven flows where a delegated account needs to dispatch base-layer
  side-effects without a user signature.

To commit state without a base-layer follow-up, use `MagicIntentBundleBuilder.commit(...)` without
actions. See [delegation.md](delegation.md).

## Imports

```rust
use ephemeral_rollups_sdk::anchor::action;
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
```

## Action Handler Instruction (target of the call)

Mark the base-layer instruction that the action will invoke with the
`#[action]` attribute on its accounts context. This declares the instruction
as callable from a post-commit action. The macro injects `escrow_auth` and
`escrow` accounts into this target context; do not add them to the
`ShortAccountMeta` list manually.

```rust
pub fn update_leaderboard(ctx: Context<UpdateLeaderboard>) -> Result<()> {
    let leaderboard = &mut ctx.accounts.leaderboard;
    let counter_info = &mut ctx.accounts.counter.to_account_info();
    let mut data: &[u8] = &counter_info.try_borrow_data()?;
    let counter = Counter::try_deserialize(&mut data)?;

    if counter.count > leaderboard.high_score {
        leaderboard.high_score = counter.count;
    }
    Ok(())
}

#[action]
#[derive(Accounts)]
pub struct UpdateLeaderboard<'info> {
    #[account(mut, seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: Account<'info, Leaderboard>,
    /// CHECK: PDA owner depends on whether it is delegated; access pattern
    /// validates this at the call site.
    pub counter: UncheckedAccount<'info>,
}
```

## Schedule a Commit + Action from the ER

Build a `CallHandler` describing the base-layer instruction, then attach it
to a `MagicIntentBundleBuilder` via `add_post_commit_actions`:

```rust
pub fn commit_and_update_leaderboard(
    ctx: Context<CommitAndUpdateLeaderboard>,
) -> Result<()> {
    let instruction_data =
        anchor_lang::InstructionData::data(&crate::instruction::UpdateLeaderboard {});
    let action_args = ActionArgs::new(instruction_data);
    let action_accounts = vec![
        ShortAccountMeta {
            pubkey: ctx.accounts.leaderboard.key().to_bytes().into(),
            is_writable: true,
        },
        ShortAccountMeta {
            pubkey: ctx.accounts.counter.key().to_bytes().into(),
            is_writable: false,
        },
    ];
    let action = CallHandler {
        destination_program: crate::ID,
        accounts: action_accounts,
        args: action_args,
        // Signer that pays transaction fees for the action from its escrow PDA
        escrow_authority: ctx.accounts.payer.to_account_info(),
        compute_units: 200_000,
    };

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[ctx.accounts.counter.to_account_info()])
    .add_post_commit_actions([action])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct CommitAndUpdateLeaderboard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,

    /// CHECK: Leaderboard PDA — writable flag is set inside the action accounts list.
    #[account(seeds = [LEADERBOARD_SEED], bump)]
    pub leaderboard: UncheckedAccount<'info>,

    /// CHECK: Destination program for the scheduled base-layer action.
    #[account(address = crate::ID)]
    pub program_id: UncheckedAccount<'info>,
}
```

The destination program must be present in the outer commit context so the ER transaction can supply
it while scheduling the action, even though it is not one of the target instruction's data accounts.

## Multiple Actions

`add_post_commit_actions` takes an `IntoIterator` — pass a slice or array
literal. Actions execute sequentially in the order passed.

```rust
MagicIntentBundleBuilder::new(
    ctx.accounts.payer.to_account_info(),
    ctx.accounts.magic_context.to_account_info(),
    ctx.accounts.magic_program.to_account_info(),
)
.commit(&[
    ctx.accounts.counter.to_account_info(),
    // ... additional committed accounts
])
.add_post_commit_actions([action_1, action_2, action_3])
.build_and_invoke()?;
```

## Commit-and-Undelegate with Actions

Actions can be chained onto undelegation as well. Each base-layer attempt applies the counter commit,
undelegation, and actions atomically, but one action failure can cause all BaseActions in the affected
transaction strategy to be removed before the committor retries its remaining commit strategy.

```rust
MagicIntentBundleBuilder::new(
    ctx.accounts.payer.to_account_info(),
    ctx.accounts.magic_context.to_account_info(),
    ctx.accounts.magic_program.to_account_info(),
)
.commit_and_undelegate(&[ctx.accounts.counter.to_account_info()])
.add_post_commit_actions([action])
.build_and_invoke()?;
```

## PDA-Signed Actions (escrow authority)

When the action's `escrow_authority` is a PDA (not a user wallet), use
`build_and_invoke_signed` and pass the PDA's seeds. This pattern is common
when the ER-side caller is itself a PDA dispatching base-layer side-effects
on behalf of users. As with any intent bundle, the **payer** and the
**committed accounts** are independent — they may be the same PDA (as in
the example below, where the reward distributor pays for and commits its
own state) or different accounts entirely.

```rust
let payer_seeds: &[&[u8]] = &[REWARD_LIST_SEED, distributor_key.as_ref(), &[bump]];

MagicIntentBundleBuilder::new(
    reward_list.to_account_info(),                       // payer (PDA)
    magic_context.to_account_info(),
    magic_program.to_account_info(),
)
.magic_fee_vault(magic_fee_vault.to_account_info())      // see commit-sponsorship section in delegation.md
.commit(&[reward_list.to_account_info()])                // committed account(s) — can differ from payer
.add_post_commit_actions([action])
.build_and_invoke_signed(&[payer_seeds])?;
```

## CallHandler Field Reference

| Field | Type | Description |
|---|---|---|
| `destination_program` | `Pubkey` | Program ID that will execute the action on base layer. Almost always your own `crate::ID`. |
| `accounts` | `Vec<ShortAccountMeta>` | Accounts the action needs. Set `is_writable: true` for any account the action mutates. |
| `args` | `ActionArgs` | Encoded instruction data — typically `ActionArgs::new(anchor_lang::InstructionData::data(&...))`. |
| `escrow_authority` | `AccountInfo` | Signer that pays transaction fees for the action from an escrow PDA. Use the user's wallet for user-paid flows; use a PDA + `build_and_invoke_signed` for program-paid flows. |
| `compute_units` | `u32` | Base-layer compute budget for this action. `200_000` is a reasonable default; increase for heavy actions. |

## Common errors

### `#[action]` is required on the target instruction's accounts context

Without `#[action]`, the SDK cannot dispatch into the instruction from a post-commit action.

### `is_writable` must match the action's actual writes

`ShortAccountMeta { is_writable: true }` for any account the action mutates,
even if the same account also appears in the outer `#[commit]` context with a
different mutability. The two contexts are independent — the action accounts
list is what the base-layer transaction sees.

### Use `[action]` (slice/array) not `vec![action]`

`add_post_commit_actions` takes `IntoIterator<Item = CallHandler>`. Array
literals are the cleaner form: `.add_post_commit_actions([action])`.

### PDA escrow authority needs `build_and_invoke_signed`

If `escrow_authority` is a PDA, the outer call must provide PDA seeds via
`build_and_invoke_signed(payer_seeds)`. Calling `build_and_invoke()` (without
`_signed`) will fail signature verification at action execution time.

### Compute units are per-action, not per-bundle

Each action gets its own compute budget. If you chain three actions at
200,000 CU each, the declared total is 600,000. Increase the budget if any individual
action does heavy work.

## Failure, Observation, and Recovery

Magic Actions express a commit-plus-action intent. In any one base-layer attempt, the actions run after
the commit and an action failure reverts that transaction. The committor may then remove every
BaseAction in the affected `TransactionStrategy` and retry that strategy's remaining commit work.
Other transaction/finalize strategies are separate. A successful ER scheduling transaction—or a later
successful commit—is not proof that any originally scheduled action ran.

- Define success as the committed account state plus every required base-layer action effect, and model
  commit-without-actions as a distinct recovery state.
- Record/correlate the ER signature, commitment signature or base transaction, committed accounts, and
  action target.
- Make the target instruction idempotent or guarded by a durable operation ID. A recovery attempt must
  not distribute a reward or apply a settlement twice.
- Validate insufficient escrow funding, wrong account metas, missing signer seeds, compute exhaustion,
  target-program error, and one failing action in a multi-action bundle.
- Do not implement an independent client retry that executes only the base action unless the product has
  a reconciliation protocol proving whether the original bundle applied.
- Expose “settling” separately from “settled” in user-facing state, with timeout/alerting and a manual
  reconciliation owner.
- Reconcile every originally scheduled action, including actions whose attempted execution was reverted
  and then removed only because another BaseAction in the same transaction strategy failed.
- Verify both per-attempt rollback and whole-strategy BaseAction removal in the target environment
  whenever an action affects money or irreversible entitlements.

Keep multiple actions only when they share one intended business outcome. Independent side-effects are
easier to observe and recover when modeled as separate operations.

## Implementation checklist

### Required

- Use Magic Actions for commit-linked base-layer follow-ups whose delivery is observed and reconciled
- Keep `escrow_authority` consistent — user wallet for user-paid, PDA for program-paid
- Pair `add_post_commit_actions` with `commit_and_undelegate` when the
  follow-up should run as part of the release path
- Set realistic `compute_units` — match the action's actual work
- Observe the base-layer effect before marking the product operation settled
- Give economic actions a durable idempotency key and reconciliation path

### Avoid

- Using Magic Actions for ER-only state changes; `MagicIntentBundleBuilder.commit(...)` is sufficient
- Omitting `#[action]` from the target instruction's accounts context
- Reusing `is_writable` assumptions between the outer `#[commit]` context and the action account list;
  they describe different transactions
- Calling `build_and_invoke()` when the escrow authority is a PDA
