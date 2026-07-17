# Product Composition Patterns

MagicBlock products can be combined. Select the smallest set that meets the product requirements, then
specify authority, account placement, routing, settlement, and recovery for each boundary.

## Common compositions

| Product outcome | Likely primitives | Critical boundary |
|---|---|---|
| Real-time multiplayer game | Public ER, delegated state, optional Session Keys, VRF, Cranks | Durable rewards/results must commit; temporary state may use Ephemeral Accounts |
| Prediction market | ER + Pricing Oracle + Session Keys + eSPL; optional Magic Actions for settlement | Oracle freshness, token authority, action delivery, and final base settlement are independent checks |
| Private payment experience | Private Payments API or eSPL private flow + PER where app state is private | Queue completion is asynchronous; custody and receipts need explicit recovery |
| Low-latency trading | ER + Pricing Oracle + eSPL + Session Keys | Co-location, stale-price rejection, limits, and base settlement |
| Temporary chat/social session | ER + Ephemeral Accounts + Session Keys | Decide which content can disappear and what durable summary remains |
| Automated game/economy | ER + Cranks + VRF + Magic Actions | Scheduled work and callbacks must be idempotent; base side-effects need observation |

These are starting points, not mandatory bundles. Do not add VRF when ordinary entropy is sufficient,
PER when no data needs confidentiality, or eSPL when no token balance needs ER-speed movement.

## Composition procedure

For every user-visible action, write a short flow with:

1. **Authority** — wallet, session key, PDA, permission member, scheduler, or VRF identity.
2. **Reads/writes** — every account and whether it is base, delegated, ER-only, or service-owned.
3. **Endpoint** — base RPC, router, public ER, private ER, or hosted API.
4. **Timing** — synchronous transaction result versus later commit, callback, crank, queue settlement,
   or propagation.
5. **Durability** — what is canonical now and what becomes canonical only after settlement.
6. **Failure owner** — who detects, retries, refunds, cancels, or reconciles an incomplete flow.

If one transaction needs multiple writable accounts, they must be writable in the same runtime. If a
flow crosses runtimes, it is a workflow even when an SDK helper hides several instructions.

## Independent boundaries

- **Session authorization is not token authority.** Validate the session and separately configure/check
  SPL delegate allowance.
- **Oracle validity is not business authorization.** A fresh price does not prove the caller may trade.
- **ER execution is not base settlement.** Track commit/undelegation completion before promising finality.
- **Queue acceptance is not transfer completion.** Observe receipts/destination state and support failure
  recovery.
- **Ephemeral Account state is not durable state.** Settle anything that must survive elsewhere.
- **Magic Action scheduling is not sufficient product observation.** Verify the base-layer side-effect.
- **Commit success is not proof that any scheduled Magic Action ran.** One failed BaseAction causes all
  BaseActions in its affected transaction strategy to be removed before that strategy's remaining
  commit work is retried; reconcile every originally scheduled action independently.
- **PER privacy is not automatic access control.** Configure and test the permission lifecycle.

## Example: price-aware session trade

A wallet creates a short-lived session and, separately, a bounded token delegate allowance. The app
state, both token accounts, and the price feed are made available to one ER. The session signer submits
the trade there. The program validates session scope, token authority/allowance, feed identity,
freshness, arithmetic, and the user's limit. ER state changes immediately; the product separately
defines when and how the result commits to base. A Magic Action is added only if the commit should
trigger a base-layer side-effect that the product can observe and reconcile independently.

A “one-click trade” still depends on several independent authorization and settlement guarantees.

## Validation matrix

Test each primitive alone, then test their interactions:

- wrong runtime or accounts delegated to different ERs;
- expired session with otherwise valid token allowance;
- valid session with missing/insufficient token allowance;
- stale or wrong oracle feed during an authorized action;
- callback/crank retry after partial external observation;
- commit or queued settlement delayed beyond the UI's expected time;
- duplicate user request or service callback;
- recovery/refund path and durable reconciliation.

Use [architecture-planning.md](architecture-planning.md) to produce the full account, routing,
settlement, recovery, and validation plan before implementation.
