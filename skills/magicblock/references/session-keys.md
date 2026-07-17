# Session Keys

Session Keys let a user authorize a short-lived key to perform a constrained set of application
actions without prompting the wallet for every transaction. They improve real-time UX, but they do
not remove authorization: the program must validate the session token on every session-enabled path.

## Mental model

There are three distinct authorities:

1. **Wallet authority** creates or revokes the session.
2. **Session signer** signs frequent transactions during the allowed period.
3. **Program authorization** decides whether this token permits this instruction for this user and
   target program. The base session token does not automatically impose application-specific
   instruction, value, or transaction-count limits; the target program must enforce them.

For SPL tokens there is a fourth authority: the Token Program's owner/delegate rule. A valid session
token does not let the session signer spend the user's tokens. The wallet must separately approve an
SPL token delegate with a bounded allowance, and the application must check both layers.

## Current integration shape

The current working examples use `session-keys` `3.1.1` in the program and
`@magicblock-labs/gum-sdk` in the client. Treat these as a verified snapshot, not an automatic upgrade
target. The program uses `SessionTokenV2`, derives the accounts context as a session-aware context, and
accepts either the user's wallet or a valid session. The client creates a V2 session with an expiration
and target-program binding; any finer instruction, value, or transaction-count policy must be enforced
by the application path that accepts the session.

The session-token PDA is scoped by target program, session signer, and wallet authority. Always use the
current SDK derivation instead of copying seed bytes from an old example.

The optional lamports value supplied at session creation is a one-time transfer that tops up the
session signer. It is not stored in `SessionTokenV2`, decremented per transaction, or enforced as a
protocol spending budget. Any value or transaction-count budget must live in application state and be
checked by the target program.

## Integration workflow

1. Identify only the high-frequency instructions that need session UX. Keep account recovery,
   withdrawals, permission changes, and other high-impact operations wallet-only unless the product has
   a deliberate stronger policy.
2. Define the target program, authorized user, expiry, instruction scope/validity, optional signer
   lamports top-up, and any separate application-enforced spending budget.
3. Generate the session key client-side and protect it like a temporary hot key.
4. Have the wallet create the on-chain session token on the correct connection.
5. If token spending is needed, separately approve the session signer as token delegate with the minimum
   required allowance.
6. Submit app operations to the runtime that owns the app state—usually the ER for delegated accounts—
   while passing and validating the session token.
7. Revoke or expire the session and separately revoke any SPL delegate allowance.

## Security checklist

- Bind the token to the expected wallet authority, session signer, and target program.
- Enforce expiry on-chain; do not rely on a UI timer.
- Limit duration, instruction surface, one-time signer top-up, and token allowance. Implement and
  decrement any application spending budget explicitly; do not infer one from the top-up.
- Reject a session token created for another program or authority.
- Keep privileged instructions wallet-only by default.
- Store session secret material in memory or protected device storage; never log or commit it.
- Make revocation visible and accessible to users.
- Treat session revocation and SPL delegate revocation as separate operations.
- Decide what happens to in-flight or retried transactions around expiry.

## ER placement

Creating the durable session authorization and executing the delegated application action may use
different connections. Confirm that the session account is readable by the target ER and that every
writable application account is delegated to that ER. Do not infer routing from the signer alone.

## Validation

Test wallet fallback, valid session, wrong authority, wrong signer, wrong target program, expired token,
revoked token, underfunded session signer, any application-defined budget exhaustion, missing ER-visible
session account, insufficient token allowance, and token delegate revocation. Do not rely only on a
successful signature test.

Working composition example: `magicblock-engine-examples/binary-prediction/anchor`.

Sources: [MagicBlock Session Keys docs](https://docs.magicblock.gg/pages/tools/session-keys/introduction) and
[engine examples](https://github.com/magicblock-labs/magicblock-engine-examples).
