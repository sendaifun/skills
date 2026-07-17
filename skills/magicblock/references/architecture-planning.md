# MagicBlock Architecture Planning

Use this workflow before implementation when the product shape, state placement, delegation model,
or settlement path is not already fixed. Keep the design MagicBlock-specific; pair with the
`solana-dev` skill for general Solana program architecture.

## Contents

- [Planning workflow](#planning-workflow)
- [Product selection](#product-selection)
- [Account and delegation model](#account-and-delegation-model)
- [Routing and settlement](#routing-and-settlement)
- [Validation environment](#validation-environment)
- [Architecture brief template](#architecture-brief-template)
- [Architecture manifest template](#architecture-manifest-template)
- [Validation plan template](#validation-plan-template)
- [Definition of ready](#definition-of-ready)

## Planning workflow

### 1. Inspect before asking

Inspect the target repository, existing manifests, program accounts, clients, tests, and relevant
MagicBlock examples before asking the user for information already present in the project.

Ask at most three questions per round. Ask only questions whose answers materially change the
architecture. Prioritize:

1. Required latency, throughput, privacy, and settlement guarantees.
2. Actors, authorities, assets, and the state each actor may read or mutate.
3. Failure, timeout, recovery, sponsorship, and external-service constraints.

If the answers are not blocking, proceed with explicit assumptions and list the decision that each
assumption affects. Never invent program IDs, account addresses, package versions, or service
capabilities.

### 2. Decide whether to use MagicBlock

Justify the ER boundary instead of treating MagicBlock as mandatory. Prefer base-layer execution
when the workload is infrequent, latency-insensitive, or mostly immutable reads. Consider an ER when
the application needs repeated low-latency writes, burst throughput, private execution, or a fast
interaction loop followed by periodic base-layer settlement.

Record non-goals and explain what remains on base layer.

### 3. Select products and supporting features

Use the smallest set that satisfies the requirements. Record why each selected feature is needed
and why nearby alternatives were rejected.

| Requirement | Prefer | Important boundary |
| --- | --- | --- |
| Public, repeated low-latency state changes | Ephemeral Rollup | Plan delegation, routing, commits, and eventual undelegation |
| Permissioned access to delegated state | Private Ephemeral Rollup (PER) | Pre-fund and delegate the protected account, then create and manage its ephemeral permission on the ER |
| Managed private deposits, transfers, withdrawals, or swaps | Private Payments API | Do not model it as a custom-program ER flow unless the API boundary requires one |
| SPL balances used by a custom program on the ER | Ephemeral SPL Token | Model the base vault, delegated token account, and chosen shuttle or explicit legacy withdrawal path |
| Temporary state that must exist only on the ER | Ephemeral Accounts | Model the sponsor, ER-only creation, resize/close lifecycle, and intentional lack of base settlement |
| Temporary delegated signing authority | Session keys | Define scope, expiry, revocation, and the onchain authorization check |
| Low-latency external market data | Pricing Oracle | Verify source/feed identity, publish-time freshness, numeric conversion, user limits, and runtime co-location |
| Verifiable randomness | VRF | Model request, callback, oracle dependency, and callback failure |
| Repeated scheduled execution | Cranks | Model interval, iteration limits, cancellation, failure, and commit cost |
| Base-layer effect tied to an ER commit | Magic Actions | Define the post-commit instruction, committor retry behavior, observation, and reconciliation |
| More than the default sponsored commit allowance | Fee vault sponsorship | Model the delegated payer that is debited, validator fee vault that is credited, funding, and top-up path |

Do not conflate PER with Private Payments. PER protects access to delegated program state; Private
Payments exposes a managed private-balance and transfer API.

For multi-product designs, use [composition-patterns.md](composition-patterns.md). Load the specific
product references only after selecting the product set; this keeps planning focused while preserving
the security and settlement boundaries between products.

### 4. Model accounts, authorities, and delegation groups

List every account read or written by a user-visible flow. For each account, record:

- owner program and derivation strategy
- creation layer and authority
- persistence: base-settled, ER-only ephemeral, or external
- base-layer role and ER execution role
- whether it is delegated, by whom, and when
- delegation group and expected router-resolved ER endpoint
- privacy and read visibility
- commit and undelegation policy
- funding, rent, and sponsorship responsibility
- recovery behavior if delegation, commit, or undelegation stalls

Every writable account in an ER transaction must be available on a compatible ER endpoint. Treat
router co-location as a condition to verify, not an assumption. Identify base-layer read dependencies
that must be cloned, preloaded, passed through an oracle, or moved to a post-commit action.

Treat `delegation_group` as a logical architecture label, not an onchain protocol object.

For the ER-local PER flow, pre-fund and delegate the protected account, then create its ephemeral
permission directly on the ER. Record the delegated PDA that signs and pays rent, the members and
visibility flags, and the close/refund step before terminal cleanup. For tokens, distinguish canonical
base-layer custody from the delegated token representation used on the ER. For ER-only ephemeral
accounts, record the sponsor and close/refund path; do not assign a commit or undelegation policy.

If state must remain private until a later event, identify which bytes may settle publicly. Do not
commit plaintext private state before disclosure; split transient private state from its public
settlement representation, or scrub sensitive fields before commit or undelegation.

### 5. Map transaction routing and lifecycle

For every transaction, record the actor, signers, writable accounts, preconditions, destination,
confirmation rule, retry behavior, and settlement consequence.

Use these defaults unless the selected product documents a different route:

- Initialize accounts and delegate them on base layer.
- Query router `getDelegationStatus` to discover the ER FQDN.
- Execute mutations on delegated accounts through that ER endpoint.
- Commit or commit-and-undelegate through the ER.
- Execute Magic Actions on base layer after the associated commit is sealed.

Do not hardcode a regional ER endpoint when the flow depends on delegated-account placement.

### 6. Define settlement, failure, and observability

Specify:

- commit trigger: per operation, periodic, checkpoint, or terminal
- maximum acceptable uncommitted duration and data loss window
- terminal undelegation owner and trigger
- post-commit effects, action-stripping retry risk, observation, and reconciliation requirements
- commit quota, delegated payer debit, validator fee-vault credit, and payer top-up behavior
- timeout, retry, idempotency, cancellation, and refund paths
- monitoring for base ownership, router status, ER ownership, commit progress, and service health
- manual recovery path and the actor authorized to use it

For multi-batch settlement, define the authoritative finality marker, bounded batch and finalizer
limits, provisional-versus-final user semantics, and recovery from a partially committed batch set.

Treat the base layer as the settlement and recovery boundary for persistent delegated state. Mark
ER-only ephemeral accounts as intentionally non-settling. State where temporary ER state can be lost
or become unavailable and how the product behaves during that condition.

## Product selection

Summarize the selected architecture in one sentence before expanding it. Use this form:

> Use `<product/features>` for `<fast/private workload>`, keep `<authoritative state>` on base layer,
> and settle through `<commit/undelegation/action policy>` when `<trigger>` occurs.

If multiple designs remain viable, present no more than three options. Recommend one and compare the
others on correctness, operational complexity, latency, privacy, and settlement cost.

## Account and delegation model

Use an account matrix as the primary state-boundary artifact. Diagrams may supplement it but must not
replace explicit ownership, authority, and lifecycle fields.

| Account | Owner / derivation | Authority | Created on | Persistence | ER role | Delegation group | Commit / close policy | Privacy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<account>` | `<program; PDA/ATA/keypair>` | `<actor or PDA>` | `<base/ER/external>` | `<base-settled/ER-only/external>` | `<none/read/write>` | `<logical group or none>` | `<commit, undelegate, or close trigger>` | `<public/permissioned/private>` |

Use stable logical account IDs in the manifest even when addresses are not known yet.

## Routing and settlement

Use a routing table to make connection mistakes visible before code is written.

| Flow | Actor / signers | Writable accounts | Destination | Preconditions | Settlement / confirmation | Failure path |
| --- | --- | --- | --- | --- | --- | --- |
| `<flow>` | `<actor; signers>` | `<account IDs>` | `<base/router/ER FQDN/API>` | `<required state>` | `<observable success>` | `<retry/recover/refund>` |

Add a Mermaid sequence or state diagram only when it clarifies three or more transitions. Keep the
table as the source of truth.

## Validation environment

Choose the lowest-cost environment that can prove each claim, then retain a higher-fidelity gate for
assumptions the lower layer cannot exercise.

| Environment | Use for | Do not assume it proves |
| --- | --- | --- |
| Program unit tests or MagicSVM | Deterministic instruction, account, delegation-model, and clock tests when the project has a verified setup | Router placement, live validators, VRF oracle, PER/TEE behavior, or deployed service integration |
| `mb-stack` | Local base validator + ER + query-filtering integration | Program build/deploy, router, VRF oracle, or every hosted-service behavior |
| Repository examples harness | Existing example-specific build, deploy, fixture, and local-E2E flows | General coverage beyond the harnessed services and scenarios |
| Devnet | Router discovery, live delegation propagation, hosted oracles/services, and end-to-end settlement | Mainnet load, production funding, or operational guarantees |

Verify current package versions and commands before recommending an environment. Do not recommend
MagicSVM as a default merely because it is fast; require a runnable project example or verified
upstream surface. Check that the installed `@magicblock-labs/ephemeral-validator` version actually
exposes `mb-stack` before using it in a gate.

See [local-development.md](local-development.md) for the environment-by-claim workflow and repeatable
cross-runtime test sequence.

## Architecture brief template

Emit this concise human-readable artifact for planning requests. Remove sections that truly do not
apply, but do not omit assumptions, routing, settlement, risks, or validation.

```markdown
# <Application> MagicBlock architecture

## Decision
Use <products/features> for <workload>; keep <state> on base layer; settle via <policy>.

## Goals and non-goals
- Goals: <latency, throughput, privacy, settlement>
- Non-goals: <explicit exclusions>

## Assumptions and open questions
- ASSUMPTION: <statement> — affects <decision>
- OPEN: <question> — owner <person/team>, needed by <milestone>

## Product selection
| Capability | Selection | Rationale | Rejected alternative |
| --- | --- | --- | --- |
| <need> | <product/feature> | <why> | <alternative and why not> |

## Account and authority model
<account matrix>

## Transaction routing
<routing table>

## Delegation and settlement lifecycle
1. <create/fund on base>
2. <delegate and verify router placement>
3. <operate on ER>
4. <commit/checkpoint>
5. <commit-and-undelegate/finalize/recover>

## Security and operations
- Trust and privacy boundary: <boundary>
- Sponsorship and funding: <payer, quota, vault, top-up>
- Failure and recovery: <timeouts, retries, manual action>
- Observability: <router, ownership, commits, services>

## Validation plan
<validation matrix>

## Risks
- <risk> — mitigation <action> — owner <owner>
```

## Architecture manifest template

Emit this YAML when the user requests a durable plan, implementation handoff, or machine-readable
architecture. Use `unknown` for unresolved strings (including enum values), `null` for unresolved
numeric or boolean values, and empty lists for unresolved collections. Replace placeholder IDs once
their concepts are known, then keep those IDs stable across revisions.

```yaml
schema_version: "1"
application:
  id: "unknown"
  goal: "unknown"
  network: "unknown" # unknown | localnet | devnet | mainnet

requirements:
  latency_target_ms: null
  throughput_target_tps: null
  privacy: "unknown" # unknown | public | permissioned | private
  settlement_guarantee: "unknown"
  max_uncommitted_seconds: null

products: []

actors: []

accounts:
  - id: "unknown"
    owner_program: "unknown"
    derivation: "unknown" # unknown | pda | ata | keypair | external
    authority: "unknown"
    created_on: "unknown" # unknown | base | er | external
    persistence: "unknown" # unknown | base-settled | er-only | external
    er_access: "unknown" # unknown | none | read | write
    delegated: null
    delegated_by: "unknown"
    delegation_group: "unknown"
    privacy: "unknown" # unknown | public | permissioned | private
    commit_policy: "unknown"
    undelegate_policy: "unknown"
    close_policy: "unknown"
    funding_owner: "unknown"

transactions: []

routing:
  router_discovery_required: null
  allow_static_er_endpoint: null
  compatibility_checks: []

settlement:
  strategy: "unknown" # unknown | none | per-operation | periodic | checkpoint | terminal
  triggers: []
  terminal_undelegation_actor: "unknown"
  magic_actions: []
  commit_sponsor: "unknown"
  fee_vault: null
  delegated_fee_payer: null
  recovery_path: "unknown"

external_dependencies: []

validation:
  - environment: "unknown"
    proves: []
    command: "unknown"
    pass_signal: "unknown"

risks: []
open_questions: []
```

## Validation plan template

Map each claim to one executable gate. Avoid a generic “tests pass” row.

| Claim | Environment | Setup / command | Pass signal | Evidence retained | Not covered |
| --- | --- | --- | --- | --- | --- |
| `<architectural claim>` | `<unit/MagicSVM/mb-stack/harness/Devnet>` | `<command>` | `<observable result>` | `<log/signature/artifact>` | `<remaining fidelity gap>` |

At minimum, cover:

- account derivation and authorization
- delegation, router discovery, and ER endpoint compatibility
- primary ER mutations
- commit and terminal undelegation
- session expiry/revocation when used
- token deposit/withdrawal or payment settlement when used
- VRF/crank/Magic Action behavior when used
- sponsorship exhaustion and recovery
- timeout, retry, and service-unavailable behavior

## Definition of ready

Do not call an architecture implementation-ready until:

- the MagicBlock product selection is justified and base-only execution was considered
- every mutable account has an owner, authority, execution layer, and lifecycle
- every transaction has a destination, signers, writable accounts, confirmation, and failure path
- every delegated account has a delegation, commit, and undelegation owner and trigger
- every ER-only ephemeral account has a sponsor and close/refund policy instead of a fabricated settlement path
- multi-account ER transactions include an endpoint-compatibility check
- privacy and trust boundaries distinguish public ER, PER ephemeral permissions, and Private Payments
- settlement timing, sponsorship, funding, and recovery are explicit
- every external dependency has a failure behavior
- the validation ladder states both what each environment proves and what it cannot prove
- unresolved choices appear as assumptions or open questions rather than fabricated facts
