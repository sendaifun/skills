# Ephemeral SPL Token Lifecycle: Deposit, Transfer, App-Program CPI, Undelegate, Withdraw

Use this reference when a project needs SPL tokens inside an Ephemeral Rollup:
depositing tokens into the ER, transferring them at ER speed (directly or through
an app program), and withdrawing them back to base-layer token accounts.
For the hosted Payments HTTP API (deposits, transfers, withdrawals, swaps as a
service, with auth) use [private-payments.md](private-payments.md) instead.

Sources of truth:

1. **Upstream program repo**: `https://github.com/magicblock-labs/ephemeral-spl-token`
   — program behavior, instruction data, account metas, PDA seeds, state layouts.
2. **TypeScript SDK**: `@magicblock-labs/ephemeral-rollups-sdk` — high-level
   `delegateSpl` / `transferSpl` / `undelegateIx` / `withdrawSpl` helpers plus
   per-instruction builders and PDA derivations.
3. **Working example**: `magicblock-engine-examples/spl-tokens/anchor` at engine-examples revision
   `1d11428` — end-to-end Anchor program + tests exercising the full lifecycle. At that revision its
   Rust program pins SDK `0.14.3`, its root TS package pins `0.14.3`, and its app pins `0.15.3`; treat
   those as example provenance, not as the dependency snapshot below.

SDK version example, verified 2026-07-13: TS + Rust
`ephemeral-rollups-sdk` **0.15.5**, with Anchor **1.0.2** for modern Anchor
programs. Preserve an existing target repo's compatible versions unless the
task explicitly requests an upgrade; see [resources.md](resources.md).

Program ID (all clusters): `SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2`

## Contents

- [Integration models](#integration-models)
- [Model A: SDK lifecycle](#model-a-sdk-lifecycle)
- [Model B: direct program surface](#model-b-direct-program-surface)
- [Queued private settlement](#queued-private-settlement)
- [Public instruction groups](#public-instruction-groups)
- [Native SOL and WSOL](#native-sol-and-wsol)
- [Recovery map](#recovery-map)
- [Implementation checklist](#implementation-checklist)

## Integration models

**Model A — SDK lifecycle (default).** Clients drive the whole lifecycle with
SDK helpers: `delegateSpl` (deposit + delegate), `transferSpl`, `undelegateIx`,
`withdrawSpl`. On the ER, the delegated balance materializes as a **normal SPL
token account at the owner's canonical ATA address** — clients read it with
`getAccount(erConnection, ata)`, and app programs move it with a plain SPL
Token CPI. You never derive an eATA or vault PDA, and your program never calls
the Ephemeral SPL Token program. Use this for games, payments, and any app
that needs token balances on the ER.

**Model B — direct program surface.** A smart contract (or bespoke client)
talks to the Ephemeral SPL Token program itself: derive the **eATA PDA**
(seeds `[owner, mint]`) and per-mint **global vault PDA** (seeds `[mint]`),
build instruction data from the `ephemeral-spl-api` crate, and wire exact
account metas. Use this only when Model A's helpers cannot express the flow:
on-chain deposit/withdraw orchestration, transfer queues, shuttles, or custom
vault logic.

Both models share the same base-layer state: deposited tokens are locked in
the global vault, the user's balance is recorded in the eATA, and the eATA is
delegated to the delegation program. Withdrawal releases tokens from the vault
to the owner's real ATA, either through the default shuttle builder or through
an explicit legacy undelegate, base confirmation, and direct withdrawal. The
difference between the models is which incompatible integration surface you touch: canonical ATAs + SDK helpers
(A) versus explicit eATA/global-vault PDAs + program instructions (B). Canonical-ATA guidance in this
file applies only to Model A.

---

# Model A: SDK Lifecycle

### Lifecycle and Endpoint Routing

| Step | Helper | Endpoint | Signers |
|---|---|---|---|
| Create mint / ATAs / fund | standard `@solana/spl-token` | Base | payer |
| Deposit + delegate | `delegateSpl(...)` | Base | owner (+ payer) |
| Transfer inside ER | `transferSpl(...)` or app program | ER | from-owner |
| Read ER balance | `getAccount(erConnection, ata)` | ER | — |
| Default withdrawal | `withdrawSpl(...)` | Base | owner (+ payer) |
| Legacy undelegate | `undelegateIx(owner, mint)` | ER | owner |
| Legacy commit extraction/confirmation | `GetCommitmentSignature(...)`, then base confirmation | ER read, then Base | — |
| Legacy withdrawal | `withdrawSpl(..., { idempotent: false })` | Base | owner |

## Client Integration (TypeScript)

### Dependencies

```json
{
  "dependencies": {
    "@coral-xyz/anchor": "0.32.1",
    "@magicblock-labs/ephemeral-rollups-sdk": "0.15.5",
    "@solana/spl-token": "^0.4.14"
  }
}
```

### Imports and Connections

```typescript
import {
  delegateSpl,
  transferSpl,
  undelegateIx,
  withdrawSpl,
  deriveRentPda,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
```

Use the standard dual-connection setup (see
[typescript-setup.md](typescript-setup.md)): one provider on the base layer,
one on the ER endpoint for the validator you delegate to.

### Prerequisites

- The owner's ATA for the mint must exist on base layer before delegating
  (or pass `initAtasIfMissing: true`).
- The global **rent PDA** (`deriveRentPda()`) sponsors shuttle rent for the
  deposit flow. On a fresh/local cluster, fund it before delegating (the
  example transfers 0.2 SOL to it during setup):

```typescript
const [rentPda] = deriveRentPda();
// SystemProgram.transfer(payer → rentPda, 0.2 * LAMPORTS_PER_SOL) on base layer
```

### Choosing the Validator

**Recommended: resolve one validator up front and pass the same `validator` to
every `delegateSpl` in the flow.** Balances can only interact in one ER
transaction if they live on the same ER, and the program's transfer queue is
scoped per `[mint, validator]` — so keep the validator consistent across all
delegations for a mint. Encrypted private transfers additionally hard-require
it (the SDK throws `"validator is required for encrypted private transfers"`).

Technically `validator` is optional — omitting it delegates unpinned
(`DelegateConfig { validator: None }` on-chain, the same default as ordinary
account delegation) and the account's ER is discovered afterwards via router
`getDelegationStatus`. If you go that way, verify all interacting accounts
report the same `fqdn` before sending joint ER transactions.

`validator` takes the ER validator's **identity pubkey**, and you need it
*before* delegating — router `getDelegationStatus` only returns an `fqdn` for
accounts that are already delegated. Resolve the identity of the ER endpoint
you plan to use with JSON-RPC `getIdentity` (this is how the upstream API
resolves it when the request omits `validator`; `web3.js`'s `Connection` does
not wrap this method):

```typescript
const res = await fetch(ER_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity", params: [] }),
});
const validator = new PublicKey((await res.json()).result.identity);
```

The example's devnet tests default to validator
`mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev` (endpoint
`https://devnet-as.magicblock.app/`) — treat that as a snapshot and prefer
resolving via `getIdentity`.

### Deposit + Delegate (base layer)

```typescript
const delegateOpts = {
  validator,                    // ER validator pubkey
  idempotent: false as const,   // choose the legacy deposit builder for this example
  payer: admin.publicKey,
};

// Initialize the shared vault if absent. Each builder decides whether
// repeated initialization is idempotent; inspect existing state first.
const ixs = await delegateSpl(owner.publicKey, mint, 50n, {
  ...delegateOpts,
  initVaultIfMissing: true,
});
await provider.sendAndConfirm(new Transaction().add(...ixs), [owner, admin], {
  commitment: "confirmed",
});
```

`DelegateSplOptions`: `payer?`, `validator?`, `initIfMissing?`,
`initVaultIfMissing?`, `initAtasIfMissing?`, `shuttleId?`, `escrowIndex?`,
`idempotent?`, `private?`.

### Transfer Inside the ER

```typescript
const transferIxs = await transferSpl(fromOwner.publicKey, toOwner.publicKey, mint, 2n, {
  visibility: "public",
  fromBalance: "ephemeral",
  toBalance: "ephemeral",
});
await erProvider.sendAndConfirm(new Transaction().add(...transferIxs), [fromOwner], {
  commitment: "confirmed",
});

// Balances on the ER live at the canonical ATA addresses:
const erBalance = (await getAccount(erConnection, ata)).amount;
```

For ephemeral→ephemeral public transfers this builds a plain SPL transfer
between the canonical ATAs — which is why an app program can do the same via
CPI (next section). The current helper supports public base→base and
ephemeral→ephemeral routes. Cross-layer routes are private queued workflows;
do not assume a public base→ephemeral or ephemeral→base route exists. The SDK helper throws an ordinary
`Error` for an unsupported combination; `UNSUPPORTED_TRANSFER_ROUTE` is an HTTP Payments API error code,
not an SDK guarantee. Private variants use
`privateTransfer: { minDelayMs, maxDelayMs, split }`.

### Withdrawal Paths

The default `withdrawSpl(...)` builder uses the delegated-shuttle withdrawal path. Submit those
instructions on base; the helper builds the shuttle orchestration and does not require a preceding
`undelegateIx` call.

Use the legacy path when the application explicitly needs the direct eATA lifecycle shown below:

```typescript
// 1. Undelegate on the ER — ONE owner per transaction (combined undelegates
//    in a single tx are flaky).
const commits: string[] = [];
for (const owner of owners) {
  const sgn = await erProvider.sendAndConfirm(
    new Transaction().add(undelegateIx(owner.publicKey, mint)),
    [owner],
    {
      commitment: "confirmed",
    },
  );
  // This reads the ER transaction/logs and extracts the base signature; it
  // does not confirm that base transaction.
  commits.push(await GetCommitmentSignature(sgn, erConnection));
}

// 2. Wait for ALL commits to land on base before any withdraw. Withdraw needs
//    each eATA to be owned by the program again on base; racing a pending
//    commit fails with InvalidAccountOwner.
await Promise.all(commits.map((c) => baseConnection.confirmTransaction(c, "confirmed")));

// 3. Withdraw on base layer back to the owner's real ATA.
const withdrawIxs = await withdrawSpl(owner.publicKey, mint, amount, {
  idempotent: false,
});
await provider.sendAndConfirm(new Transaction().add(...withdrawIxs), [owner], {
  commitment: "confirmed",
});
```

### Builder Selection: `idempotent` Flag

`idempotent` is a per-call builder selector; the helper does not write that choice into account state.
`delegateSpl(...)`
independently chooses the default shuttle deposit builder or the legacy direct builder when
`idempotent: false`. `withdrawSpl(...)` independently chooses the default shuttle withdrawal builder
or the legacy direct withdrawal builder when `idempotent: false`. `undelegateIx(owner, mint)` has no
mode flag; it is the explicit undelegation step used before the legacy direct withdrawal. Do not infer
a stored account mode from a prior helper call.

## App Program Over Delegated Token Accounts (Anchor)

Use this when your program enforces custom rules while moving tokens on the ER.
This is still Model A: the program never touches the Ephemeral SPL Token
program — it receives the canonical ATAs (materialized as normal token
accounts on the ER) and CPIs into the SPL Token Program. Verbatim from the
working example (Anchor 1.0.2):

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::anchor::ephemeral;

#[ephemeral]
#[program]
pub mod spl_tokens {
    use super::*;

    pub fn transfer(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let cpi_accounts = SplTransfer {
            from: ctx.accounts.from.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        // Anchor 1.0.x: CpiContext::new takes the program key
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = from.owner == payer.key() @ ErrorCode::InvalidTokenOwner,
        constraint = from.mint == to.mint @ ErrorCode::MintMismatch
    )]
    pub from: Account<'info, TokenAccount>,
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("amount must be > 0")]
    InvalidAmount,
    #[msg("from token account is not owned by payer")]
    InvalidTokenOwner,
    #[msg("from and to token accounts must have the same mint")]
    MintMismatch,
}
```

Cargo dependencies (snapshot):

```toml
anchor-lang = { version = "1.0.2", features = ["init-if-needed"] }
anchor-spl = { version = "1.0.2" }
ephemeral-rollups-sdk = { version = "0.15.5", features = ["anchor"] }
```

Calling it from the client — the transaction targets the **ER endpoint**, so
build it with the ER blockhash:

```typescript
const tx = await program.methods
  .transfer(new BN(2))
  .accounts({ payer: sender.publicKey, from: ataSender, to: ataReceiver })
  .transaction();
tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
tx.sign(sender);
const sgn = await erConnection.sendRawTransaction(tx.serialize());
await erConnection.confirmTransaction(sgn, "confirmed");
```

Both `from` and `to` must already be delegated (via `delegateSpl`) before this
instruction is sent. Delegation, undelegation, and withdrawal are orchestrated
client-side around the app program.

---

# Model B: Direct Program Surface

Use this only when Model A's helpers cannot express the flow. Everything
here works in terms of the program's own PDAs, not canonical ATAs.

### State Model

| Account | Seeds (program `SPLxh1...agv2`) | Holds |
|---|---|---|
| Ephemeral ATA (eATA) | `[owner, mint]` | owner, mint, `amount` (the ER-side balance), bump |
| Global vault | `[mint]` | mint, vault token account address, bump |
| Vault token account | ATA of `(vault, mint)` | the actual locked SPL tokens for the whole mint |
| Rent PDA | `[b"rent"]` | lamports sponsoring shuttle/queue rent |
| Transfer queue | `[b"queue", mint, validator]` | queued delayed transfers |

## Queued Private Settlement

Private and cross-layer transfers cannot always complete as one synchronous token movement. They use
a validator-scoped queue so timing/splits can obscure the direct sender→recipient link and so work that
must cross runtime boundaries can be scheduled safely.

The observable lifecycle is:

1. The source transaction validates and escrows/debits the amount, creates a group receipt for the
   requested splits, and enqueues transfers with randomized ready timestamps.
2. The recurring queue crank observes a ready entry and schedules a standalone settlement action.
3. The queue entry is popped **when execution is scheduled**, before the payout result is known. Queue
   absence therefore does not prove recipient credit.
4. The authenticated callback records a `TransferReceipt` in the temporary `GroupReceipt`.
5. A failed payout enters the current refund/recovery path. Retry limits are implementation- and
   version-specific; inspect the pinned program before promising an exact count.
6. When every split callback has been recorded, the group receipt is closed. Treat destination state,
   callback logs/receipts, and refund state—not queue length alone—as settlement evidence.

`minDelayMs`/`maxDelayMs` choose when a split becomes eligible to be scheduled. They are not a strict
completion SLA: scheduler availability, action execution, callbacks, and retries can add time. Product
UIs need pending, settled, and refunded/failed states plus a reconciliation path.

For multi-split payments, do not mark the group settled after the first credit. Correlate every split
with its group/client reference and reconcile the total amount.

### Rust CPI via `ephemeral-spl-api`

Depend on the upstream API crate — `ephemeral-spl-api`, in the `e-token-api/`
directory of the program repo (unpublished; use a git dependency). The
on-chain program is Pinocchio-based, but the API crate is framework-agnostic.
Use its exports instead of copying bytes:

- Program ID: `ephemeral_spl_api::ID`; delegation program:
  `ephemeral_spl_api::program::DELEGATION_PROGRAM_ID`.
- Discriminators: `ephemeral_spl_api::instruction::ESplInstruction` —
  `to_vec()` for no-arg instructions, `with_data(&args.encode()...)` for
  argument payloads.
- Args: `ephemeral_spl_api::instructions::{DepositArgs, WithdrawArgs,
  DelegateArgs, InitializeTransferQueueArgs, DepositAndQueueTransferArgs,
  AmountAndSaltArgs, ...}` (encoded via `wheels::layout::Encodable`).
- State + PDAs: `state::ephemeral_ata::EphemeralAta` (`find_pda(owner, mint)`,
  `seeds`, `signer_seeds`), `state::global_vault::GlobalVault`
  (`find_pda(mint)`), `state::transfer_queue::TransferQueue`.
- Errors: `EphemeralSplError`.

```rust
use ephemeral_spl_api::instruction::ESplInstruction;

// No-arg instruction
let data = ESplInstruction::InitializeEphemeralAta.to_vec();

// Amount payload (little-endian u64 after the discriminator)
let mut data = ESplInstruction::DepositSplTokens.to_vec();
data.extend_from_slice(&amount.to_le_bytes());
```

### Core Instruction Account Metas

Verify against `e-token/tests/` when wiring; `(w)` = writable, `(s)` = signer.

| Instruction | Accounts (in order) |
|---|---|
| `InitializeEphemeralAta` | eATA PDA (w), payer (s), owner, mint, system program |
| `InitializeGlobalVault` | vault PDA (w), payer (s), mint, vault eATA (w), vault token account (w), token program, ATA program, system program |
| `DepositSplTokens` | owner eATA (w), vault, mint, source token account (w), vault token account (w), owner authority (s), token program |
| `WithdrawSplTokens` | owner (s), owner eATA (w), vault, mint, vault token account (w), destination token account (w), token program |
| `DelegateEphemeralAta` | payer (s), eATA (w), owner program, delegation buffer (w), delegation record (w), delegation metadata (w), delegation program, system program |
| `CloseEphemeralAta` | owner (s), eATA (w), rent destination (w) |

The program exposes a much larger surface (shuttle flows, transfer queues,
sponsored lamports transfers, stealth pools, scheduled private transfers) —
consult the upstream repo's README and `e-token/tests/` for those. Never call
the internal automation discriminators (196+, e.g. `UndelegationCallback`)
from an app program; they are callbacks fired by the delegation/magic programs.

### Low-Level TypeScript Builders

The SDK also exposes Model B client-side, mirroring the raw instructions
(module `instructions/ephemeral-spl-token-program`):

- PDAs: `deriveEphemeralAta(owner, mint)`, `deriveVault(mint)`,
  `deriveVaultAta(mint, vault)`, `deriveRentPda()`,
  `deriveLamportsPda(payer, destination, salt)`,
  `deriveShuttleEphemeralAta(owner, mint, shuttleId)`.
- Instructions: `initEphemeralAtaIx`, `initVaultIx`, `initVaultAtaIx`,
  `initRentPdaIx`, `depositSplTokensIx`, `delegateEphemeralAtaIx`,
  `withdrawSplIx`, `undelegateIx`, `mergeShuttleIntoAtaIx`,
  `lamportsDelegatedTransferIx` (see [lamports-topup.md](lamports-topup.md)),
  and eATA permission builders (`createEataPermissionIx`,
  `delegateEataPermissionIx`, `resetEataPermissionIx`,
  `undelegateEataPermissionIx`).
- State decoders: `decodeEphemeralAta`, `decodeGlobalVault`.

## Public Instruction Groups

The checked-in IDL or an old copied discriminator list can lag the program. Use the current
`ephemeral-spl-api::instruction::ESplInstruction` enum and current tests. The present public surface is
grouped as follows (discriminator `18` is unused; `196` and `201+` are internal callbacks/actions):

| Group | Instructions | Typical use |
|---|---|---|
| Core balance | `0`–`5`, `10` | Initialize eATA/vault, deposit, withdraw, delegate, undelegate, close |
| PER permissions | `6`–`9` | Create, delegate, undelegate, or reset an eATA permission |
| Shuttle lifecycle | `11`, `13`–`15`, `24`–`26`, `32` | Single-use accounts for cross-layer deposit/merge/withdraw and permissionless recovery |
| Transfer queues | `12`, `16`, `17`, `19`, `27`, `28` | Initialize/delegate/grow/refill a queue and enqueue delayed transfers |
| Sponsored SOL | `20`, `23` | Fund delegated destinations and initialize the rent sponsor |
| Stealth pools | `21`, `22` | Ensure/delegate a pool and update its ER-local destination set |
| Private swap delivery | `29`–`31` | Schedule, execute, and clean up stash-based private transfer delivery |

High-level SDK/API helpers are the default because these instructions have exact ordered accounts,
encryption payloads, PDAs, and callback assumptions. Direct CPI is appropriate only when the product
requires orchestration the helper does not expose.

## Native SOL and WSOL

The SPL routes represent SOL with the native WSOL mint
`So11111111111111111111111111111111111111112`. The current Payments API prepares the owner's WSOL
ATA, transfers missing lamports into it, and syncs the account when a SOL deposit or supported private
base-source transfer lacks enough wrapped balance. It also tops up the rent PDA when required.

Current settlement behavior is route-sensitive:

- A legacy-builder (`idempotent: false`) API withdrawal appends a close of the owner's WSOL ATA so the
  withdrawn value returns as native SOL.
- A queued WSOL payout attempts native-lamport delivery when the recipient is a System Program account
  and the transfer can satisfy account-creation rent rules. Otherwise it preserves token delivery.
- Public swaps can request wrap/unwrap behavior, but the private-swap path rejects
  `nativeDestinationAccount`.

Always observe whether the chosen route delivered wallet lamports or WSOL. Do not model them as the
same balance, and do not promise direct native delivery without checking route eligibility.

## Recovery Map

| Incomplete state | Evidence | Recovery owner/action |
|---|---|---|
| Deposit/delegation transaction failed | Base signature/logs; source/vault/eATA unchanged | Rebuild from current accounts and deliberately select the appropriate deposit builder |
| Shuttle delegated but merge/cleanup incomplete | Router status plus shuttle metadata/eATA/wallet ATA | Use the current SDK/API shuttle merge or undelegate-and-close path; never guess seeds/account order |
| Shuttle already undelegated but funds/accounts remain | Base ownership plus nonzero shuttle eATA or wallet ATA | Public instruction `32` permissionlessly settles both balances to an owner-controlled token account and closes the shuttle accounts |
| Queue item scheduled but destination not credited | Missing payout callback/destination delta; queue item may already be gone | Follow group/client reference, callback logs, and automatic refund path; escalate after retry exhaustion |
| Scheduled private-swap stash times out | Stash/stash ATA still funded; timeout callback result | Current instruction `30` refunds stash ATA balance to the user's ATA after timeout; reconcile cleanup via `31` |
| eATA undelegated but withdrawal fails | Base owner restored; vault and destination balances unchanged | After confirming the commit, retry the legacy direct withdrawal with `idempotent: false` |
| Rent/fee sponsor depleted | Rent PDA or fee vault balance and failed action logs | Refill through the documented sponsor path, then retry only an idempotent operation |

Persist operation identifiers and every base/ER signature outside temporary group receipts. Group
receipts close after all callbacks, so they are execution coordination—not durable payment history.

---

## Implementation checklist

- **Pin the same `validator` across a flow** — one ER transaction can only
  write accounts delegated to its own validator, and the transfer queue is
  scoped per `[mint, validator]`. Resolve it once via `getIdentity` on the ER
  endpoint and pass it to every `delegateSpl`. If you delegated unpinned
  (default config), confirm via router `getDelegationStatus` that all
  interacting accounts share the same `fqdn` first.
- **Treat `initVaultIfMissing` as builder-specific initialization** — inspect whether the shared vault
  exists. The shuttle deposit builder can use its initialization path; the legacy deposit builder may
  require later delegations to pass `false`. Do not promise an exactly-once call rule.
- **Fund the rent PDA before delegating** on fresh/local clusters — shuttle
  rent is sponsored from `deriveRentPda()`; an unfunded rent PDA fails the
  deposit flow.
- **One undelegate per transaction, per owner** — combining undelegations in
  one transaction is flaky.
- **Wait for every undelegation commit before withdrawing** — withdraw runs on
  base and requires the eATA to be program-owned again; racing a pending
  commit fails with `InvalidAccountOwner`. Use `GetCommitmentSignature` on the
  ER signature, then confirm that signature on the base connection.
- **Blockhash must come from the connection you send to** — ER transactions
  need `erConnection.getLatestBlockhash()`; mixing endpoints produces
  blockhash-not-found or stale-state errors.
- **Scope `skipPreflight` narrowly** — preserve preflight for supported base delegation/deposit
  transactions. Use `skipPreflight: true` only for ER transactions with a known simulation
  incompatibility, and inspect execution logs.
- **Choose each lifecycle builder deliberately** — the default withdrawal is a shuttle flow. The
  legacy flow is explicit `undelegateIx` on the ER, base confirmation of its commit, then
  `withdrawSpl(..., { idempotent: false })` on base. `undelegateIx` has no stored mode to match.
- **Verify balances against the right endpoint** — ER balances via the ER
  connection, base balances via the base connection; the other side is stale
  by design until commit.
- **Token vs Token-2022**: keep the token program consistent across mint,
  ATAs, vault, and CPIs.
- **Native SOL is represented as WSOL** — distinguish wallet lamports from the native-mint ATA and
  define who unwraps after withdrawal or delivery.
- **Private transfers settle later, not immediately** — the delay window controls
  eligibility for scheduling, not guaranteed completion. Do not assert destination
  balances right after sending; observe all split callbacks/destination credits or refund state.
- **Queue removal is not payout completion** — a ready item is popped when its action is scheduled.
  Reconcile with receipts, destination state, callbacks, and refunds.
- **Do not mix models** — an app program in Model A should never derive eATA or
  vault PDAs; a Model B contract must not assume canonical-ATA balances exist
  on base layer.
