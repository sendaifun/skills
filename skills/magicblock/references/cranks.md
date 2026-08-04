# Cranks (Scheduled Tasks)

Cranks let an Ephemeral Rollup schedule recurring execution without an application-operated cron
server. A successful schedule, update, or cancel transaction means the request was accepted and stashed;
the scheduler applies it asynchronously. Product logic must distinguish **request accepted**,
**scheduler change observed**, **iteration attempted**, and **desired state reached**.

## Contents

- [When to use](#when-to-use)
- [Lifecycle](#lifecycle)
- [Current program surface](#current-program-surface)
- [Authorization and identity](#authorization-and-identity)
- [Design for retries and failure](#design-for-retries-and-failure)
- [Validation checklist](#validation-checklist)

## When to use

Use cranks for repeated ER-local work such as game ticks, auctions, queue processing, periodic commits,
or maintenance. Prefer a user transaction when work only needs to happen after an explicit user action.
Prefer an external service when the trigger depends on off-chain data or cross-system orchestration the
ER scheduler cannot observe.

Cranks do not make a non-idempotent instruction safe, do not guarantee an exact wall-clock execution
time, and do not automatically settle changed state to Solana.

## Lifecycle

1. Create and delegate every writable account needed by the scheduled instruction.
2. Build the exact instruction the scheduler will execute, including account metas and data.
3. Submit the schedule request on the ER with a task ID, interval, and finite or deliberately chosen
   iteration count; transaction success records request acceptance, not scheduler registration.
4. Observe the scheduler-applied registration before depending on the task, then observe actual
   iterations and state/log changes separately.
5. Submit update or cancel as the same authority, and observe that the scheduler applied the requested
   change before reporting it complete or releasing target accounts.
6. Commit/undelegate separately when the resulting state must settle to base.

The target accounts must remain available and writable on that ER for every iteration. Undelegating or
closing them while the task remains active creates a predictable failure path; cancel first or make the
scheduled instruction safely detect terminal state.

## Current program surface

The current working Anchor example uses:

```toml
magicblock-magic-program-api = { version = "0.10.1", default-features = false }
bincode = "^1.3"
```

Treat that as a verified snapshot. The scheduling CPI serializes
`MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs { ... })` and invokes
`MAGIC_PROGRAM_ID` on the ER. The current argument types are signed 64-bit integers:

```rust
pub struct ScheduleTaskArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64,
    pub iterations: i64,
    pub instructions: Vec<Instruction>,
}
```

The cancel surface is `MagicBlockInstruction::CancelTask { task_id }`. Verify the exact account list
and dependency version against `magicblock-engine-examples/crank-counter/anchor` and the target
validator before copying an instruction builder.

Schedule and cancel transactions go to the ER and use an ER blockhash. Use `skipPreflight: true` only
when that ER cannot simulate the scheduler CPI faithfully, then inspect execution logs. The scheduled
inner instruction also executes in that ER.

## Authorization and identity

- A task ID is validator-global within a scheduler instance; the authority is the task's owner, not
  part of its key. Treat `task_id` as the durable identity used for scheduling, rescheduling, and
  cancellation.
- Derive a globally collision-resistant ID from the application, object, and authority (or allocate
  and store one in durable state). Small UI counters can collide with another application's task.
- Verify the pinned scheduler version's authority rules before relying on who may replace, invoke, or
  cancel a task. Do not generalize permissionless behavior from a product-specific queue crank to every
  scheduled task.
- The task authority signs schedule/reschedule and cancel. Scheduled execution does not reuse that
  signature. Instead, the scheduler derives `crank_signer_pda(task_authority)` and supplies it to the
  target handler.
- In every scheduled inner instruction, only that derived crank signer may have `is_signer = true`,
  and its meta must be read-only. The scheduler rejects other inner signer metas and rejects a writable
  crank-signer meta when the task is scheduled. Validate the derived key in the target handler before
  accepting crank-only authority.
- If a PDA is the task authority, invoke schedule/cancel with its signer seeds and test that authority
  separately from the derived read-only signer used by the scheduled handler.
- Do not expose an instruction that lets an arbitrary caller schedule arbitrary program instructions.
  Construct the permitted target instruction inside the program and validate its accounts.

Rescheduling an existing `task_id` is an update only when the existing authority authorizes it. A
different authority cannot claim an occupied ID, but because apply is asynchronous the occupied-ID
rejection can occur after the submission transaction succeeded. Wrong-authority cancellation can
similarly be rejected or become a no-op when processed later. Preserve authority and observe the
scheduler-applied registration, update, or removal rather than inferring it from transaction success.

## Design for retries and failure

Scheduled instructions should be idempotent or monotonic. Good patterns include “advance to the next
unprocessed timestamp,” “settle item if pending,” or “return success if already complete.” Fragile
patterns include “increment blindly” or “pay again whenever called” without an execution marker.

Define:

- how late execution may be before it is skipped or caught up;
- whether missed intervals are coalesced or replayed;
- the maximum iterations and who renews them;
- what state records the last successful logical execution;
- behavior when accounts are missing, no longer delegated, underfunded, or locked;
- alerting and manual recovery after repeated failures;
- commit frequency and sponsorship cost if crank-driven mutations settle to base.

Avoid assuming scheduler retries have exactly-once semantics. Application state must prevent duplicate
economic effects.

## Validation checklist

Test:

- schedule on the correct ER, observe asynchronous registration, then observe multiple actual executions;
- duplicate/reschedule under the same ID and authority, including request acceptance before apply;
- task-ID collision from another authority, plus later rejection/no-op of unauthorized reschedule and cancel;
- authorized cancel, observed scheduler removal, and absence of later mutations;
- callback instruction failure and subsequent behavior;
- duplicate execution/idempotency;
- late execution and terminal state;
- account undelegation or closure while scheduled;
- finite iteration exhaustion;
- commit/undelegation after the task is stopped.

Working example: `magicblock-engine-examples/crank-counter/anchor`. It demonstrates scheduling and
execution; add the lifecycle and failure tests above.

Pinned scheduler source: [inner signer validation](https://github.com/magicblock-labs/magicblock-validator/blob/9c7a94470af1785d88f4c671571f87c146a93779/programs/magicblock/src/schedule_task/mod.rs) and
[scheduled execution](https://github.com/magicblock-labs/magicblock-validator/blob/9c7a94470af1785d88f4c671571f87c146a93779/programs/magicblock/src/schedule_task/process_execute_task.rs).
