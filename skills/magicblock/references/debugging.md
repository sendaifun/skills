# Debugging Ephemeral Rollups

Use this when an Ephemeral Rollups transaction fails, an account appears delegated
but is rejected as writable, the app might be using the wrong ER endpoint, or a
private/eATA flow returns a misleading balance or validator-mismatch error.

## Contents

- [Endpoint Selection](#endpoint-selection)
- [Router `getDelegationStatus`](#router-getdelegationstatus)
- [Healthy Delegation Shape](#healthy-delegation-shape)
- [Fast Investigation Runbook](#fast-investigation-runbook)
- [Common Failure Patterns](#common-failure-patterns)
- [Reference Repos](#reference-repos)

## Endpoint Selection

Use the MagicBlock RPCs as the base Solana RPCs:

| Network | Base RPC |
| ------- | -------- |
| Devnet | `https://rpc.magicblock.app/devnet` |
| Mainnet | `https://rpc.magicblock.app/mainnet` |

Use the router to discover where the account is delegated:

| Network | Router API |
| ------- | ---------- |
| Devnet | `https://devnet-router.magicblock.app/` |
| Mainnet | `https://router.magicblock.app/` |

For ER transactions and ER-local account reads, use `result.fqdn` returned by
router `getDelegationStatus` for the specific account. Do not hardcode the old
generic ER endpoint when the router returns a region/TEE endpoint such as
`https://devnet-as.magicblock.app/` or `https://devnet-tee.magicblock.app/`.

## Router `getDelegationStatus`

The router method is a JSON-RPC POST with exactly one account in `params`:

```bash
ACCOUNT="<account_pubkey>"
ROUTER="https://devnet-router.magicblock.app/"

curl -sS --request POST \
  --url "$ROUTER" \
  --header "Content-Type: application/json" \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getDelegationStatus\",\"params\":[\"$ACCOUNT\"]}"
```

A delegated result includes:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "isDelegated": true,
    "fqdn": "https://devnet-as.magicblock.app/",
    "delegationRecord": {
      "authority": "<validator_identity>",
      "owner": "<original_program_id>",
      "delegationSlot": 388473478,
      "lamports": 15144960
    }
  }
}
```

Interpretation:

- `isDelegated: false`: the account is not currently delegated according to the
  router. Check whether the app used the wrong account, the account was already
  undelegated, or the delegation transaction never landed on the base RPC.
- `isDelegated: true`: `fqdn` is the ER RPC endpoint to use for that account.
  `delegationRecord.authority` is the validator identity. `delegationRecord.owner`
  is the account's original owner program before delegation.

## Healthy Delegation Shape

For a properly delegated account, expect this cross-chain shape:

- On base RPC (`https://rpc.magicblock.app/devnet` or `mainnet`), `getAccountInfo`
  shows the account owned by the delegation program
  `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`. This is expected.
- Router `getDelegationStatus` returns `isDelegated: true`, an `fqdn`, and a
  delegation record whose `owner` is the original program.
- On the ER RPC returned in `fqdn`, `getAccountInfo` shows the account owned by
  the original program, not by the delegation program.
- The first clone/update that brings the account into the ER must carry
  `delegated=true`. If the ER clone arrives as non-delegated, later writable use
  can fail even though the router still reports the account delegated.

Base ownership by the delegation program is expected. Investigate a mismatch when the router reports
delegation but the selected ER endpoint lacks a delegated, mutable clone.

## Fast Investigation Runbook

1. Start from the exact failing signature or account pubkey. Request one before diagnosing a generic
   delegation failure.
2. Fetch router status with `getDelegationStatus`; save `isDelegated`,
   `fqdn`, `authority`, `owner`, and `delegationSlot`.
3. Query the base account on the MagicBlock base RPC:

   ```bash
   solana --url https://rpc.magicblock.app/devnet account "$ACCOUNT" --output json
   ```

4. Query the account on the ER endpoint returned by the router:

   ```bash
   ER_RPC="<result.fqdn from getDelegationStatus>"
   solana --url "$ER_RPC" account "$ACCOUNT" --output json
   ```

5. If the question is about failed ER transactions, inspect recent ER activity
   for the account on that same `ER_RPC`:

   ```bash
   curl -sS "$ER_RPC" \
     --header "Content-Type: application/json" \
     --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignaturesForAddress\",\"params\":[\"$ACCOUNT\",{\"limit\":20}]}"
   ```

   Then fetch the failing transaction:

   ```bash
   SIG="<signature>"
   curl -sS "$ER_RPC" \
     --header "Content-Type: application/json" \
     --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$SIG\",{\"encoding\":\"json\",\"maxSupportedTransactionVersion\":0}]}"
   ```

6. Read `meta.err`, the failing instruction index, and `logMessages` before
   reading code. For custom program errors, map the numeric error into the local
   error enum first.

## Common Failure Patterns

- `InvalidWritableAccount`: this commonly appears only in `meta.err`; do not expect a fabricated
  account-index log line. Inspect the real `logMessages` and failing instruction index. A confined
  schedule-commit path may log
  `ScheduleCommit ERR: account <pubkey> is confined and cannot be committed`. Then compare
  router status, base ownership, ER ownership, and ER-local delegated state.
  Router `isDelegated: true` alone does not prove the ER bank has synchronized
  mutability for that account.
- Router delegated, ER local status false: likely wrong ER endpoint, missing or
  stale clone, or a router/ER synchronization issue. Use the router `fqdn`, then
  inspect recent ER signatures and clone logs.
- Base owner is the delegation program: expected for a delegated account. Do not
  treat this as proof the app lost ownership; the ER side should expose the
  original owner program.
- eATA already delegated elsewhere: in `ephemeral-spl-token`, error code `0x7`
  maps to `EphemeralAtaValidatorMismatch`. Do not chase later transfer paths if
  the transaction failed at the delegate-eATA instruction.
- Private balance returns `0`: this can happen before ER auth if delegation is
  missing or points at a different validator. Keep undelegated `0` distinct from
  delegated-to-another-validator errors.
- Router 504 on `getDelegationStatus`: this may be a router backend
  accept/connect problem below the JSON-RPC method handler. Check router
  liveness and logs before assuming the method implementation is broken.

## Reference Repos

When the failure cannot be resolved from live RPC/log evidence, use these repos
for current patterns and code-path checks:

- `https://github.com/magicblock-labs/magicblock-engine-examples` for app-level
  ER/delegation integration patterns.
- `https://github.com/magicblock-labs/ephemeral-spl-token` for eATA,
  delegated-token, private-balance, and endpoint-routing behavior.
- `https://github.com/magicblock-labs/magicblock-validator` for router,
  aperture, account cloning, SVM access checks, and committor behavior.
