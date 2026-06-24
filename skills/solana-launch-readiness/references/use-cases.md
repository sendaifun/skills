# Use Cases

Load this reference when deciding whether the skill applies or when writing the owner-facing summary.

## 1. Mainnet Beta Launch Review

User intent:

```text
We are launching our Solana app on mainnet-beta next week. Review the repo and docs for launch blockers.
```

Best output:

- identify network/RPC mismatches
- verify public addresses and explorer links
- check wallet rejection and failed transaction UX
- list launch blockers and owners

## 2. Token Or NFT Campaign Readiness

User intent:

```text
We are about to announce a token/NFT campaign. Check the mint metadata, docs, explorer links, and user flow.
```

Best output:

- verify mint/program references
- inspect metadata and user-facing claims
- check SPL Token vs Token-2022 assumptions and Metaplex metadata for NFT launches
- check ATA creation, rent, mint/freeze authority, collection authority, and explorer links
- check disclaimers and support path
- flag missing authority/governance context when relevant

## 3. DeFi, Trading, Or Payment Flow Readiness

User intent:

```text
We are launching a paid flow, swap, staking, or checkout experience. Review transaction reliability and support readiness.
```

Best output:

- inspect slippage, fees, balance/rent checks, token account creation, and price/quote freshness
- check priority fees, compute budget, latest blockhash, expiry, retry, and duplicate submission handling
- verify user-facing states for rejected, failed, expired, dropped, and confirmed transactions
- confirm support can triage from signature, wallet prefix, flow name, sanitized error code, and timestamp

## 4. Program Migration Or Upgrade Readiness

User intent:

```text
We are migrating or upgrading a Solana program. Check release readiness around addresses, docs, and rollback.
```

Best output:

- verify old/new program IDs, IDL, upgrade authority, governance/multisig status, and release commit
- check migration scripts, idempotency, data snapshots, and rollback/pause path
- keep smart-contract security conclusions tied to audit artifacts only
- list exact unknowns requiring owner confirmation

## 5. Wallet UX Regression Review

User intent:

```text
We changed wallet adapter code. Review whether users can recover from common wallet and RPC failures.
```

Best output:

- inspect connect/disconnect/network mismatch states
- check rejected signature handling
- check pending/confirmed/failed/expired transaction states
- produce repro steps for risky flows

## 6. DevRel Demo Or Hackathon Submission

User intent:

```text
We need the demo to work for judges and first users. Review setup docs and the happy path.
```

Best output:

- verify README and env examples
- check whether new users can run the demo
- identify stale addresses or devnet/mainnet mismatch
- provide a short go/no-go list

## 7. Post-Audit Launch Handoff

User intent:

```text
The program audit is done. Check everything around the app before we launch.
```

Best output:

- do not repeat the audit
- review frontend, docs, RPC, monitoring, support, release controls
- list unknowns that audit reports do not cover
