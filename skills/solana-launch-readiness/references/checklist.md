# Launch Readiness Checklist

Use this checklist to score a Solana app before launch. Mark each item as `pass`, `warning`, `blocker`, or `unknown`.

## Wallet UX

- Wallet connect flow works for the target wallets and target network.
- Unsupported wallets or networks produce clear user-facing errors.
- Users can recover from rejected signatures without refreshing the app.
- Transaction simulation failures are surfaced with useful next steps.
- Pending, confirmed, failed, expired, and retried transaction states are visible.
- The app does not ask users to sign ambiguous messages or transactions.

## Network And RPC

- Target network is explicit in UI, docs, and environment config.
- Devnet/testnet/mainnet-beta values are not mixed in production config.
- RPC endpoints are configurable without code changes.
- RPC keys are not committed to public source.
- Rate limits, retries, timeout behavior, and fallback RPCs are documented or implemented.
- Confirmation commitment levels are intentional and consistent with the product risk.

## Programs, Mints, And Metadata

- Program IDs, mint addresses, token accounts, and market IDs are documented.
- Public addresses are copyable and linked to the correct explorer/network.
- Token metadata matches the launch narrative and expected decimals/symbols.
- Upgrade authority, freeze authority, mint authority, or governance status is disclosed when relevant.
- Program accounts exist on the target cluster and executable status is verified when relevant.
- SPL Token vs Token-2022 assumptions are explicit, including extensions, transfer hooks, fees, or confidential transfer behavior.
- Metaplex metadata URI, name, symbol, image, and seller fee basis points are verified for NFT or compressed NFT launches.
- Seed data, allowlists, and config accounts are versioned or reproducible.

## Transactions And Safety

- Critical flows have tests or scripted dry-runs.
- Transaction construction preserves required existing signatures.
- Multi-transaction flows define ordering and retry behavior.
- Duplicate submissions and idempotency are handled where relevant.
- User balances, rent, fees, slippage, and account creation requirements are explained before signing.
- Associated token account creation, rent funding, and insufficient SOL/token balances have visible recovery paths.
- Latest blockhash and `lastValidBlockHeight` are used or intentionally replaced by another expiry strategy.
- Priority fee and compute budget behavior is intentional for expected launch congestion.
- Versioned transactions and address lookup tables are used or intentionally avoided based on account list size and wallet support.
- Preflight, simulation logs, `maxRetries`, and commitment levels are intentional and documented for critical flows.
- Failure modes do not leave users without a recovery path.

## Docs And Developer Experience

- README explains setup, env vars, target network, and launch mode.
- `.env.example` or equivalent exists and avoids real secrets.
- API docs or SDK examples match current code.
- Known limitations are documented.
- New users can complete the main happy path from docs alone.
- Error glossary or troubleshooting guide covers common Solana failures.

## Observability And Operations

- Frontend and backend errors are logged with privacy-safe metadata.
- Transaction signatures and user-facing failures can be correlated.
- There is monitoring for RPC errors, failed transactions, failed indexing, and degraded APIs.
- Support can triage a failed transaction from signature, wallet prefix, flow name, sanitized error code, and timestamp.
- There is a status page, support channel, or incident communication plan.
- Rollback or pause procedures are documented for critical releases.
- Owners are assigned for launch day response.

## Release Gates

- CI passes and includes relevant tests, linting, or type checks.
- Build and deployment commands are documented.
- Production environment and release commit/tag are identifiable.
- Analytics or event tracking confirms core funnel steps.
- Legal/risk disclaimers are reviewed where the app involves tokens, trading, rewards, or financial claims.
- A go/no-go checklist exists with named owners and deadlines.
