# Blinks & Actions Security

Deep dive behind SKILL.md → "Security". A Blink hands a user a transaction built by a **remote,
untrusted server** and asks them to sign it. That is a phishing surface by construction. This doc is
the full threat model: why the returned transaction is untrusted, the exact client-side validation
rules the spec mandates, Action Identity attribution, chained-callback replay defense, sign-message
anti-replay, and deploy-time secret hygiene.

Server-build mechanics (CORS, headers, hosting) are in `docs/deployment.md`; the chaining walkthrough
is in `docs/typed-inputs-and-chaining.md`. This doc focuses purely on *trust*.

---

## The core principle: the returned transaction is UNTRUSTED

The Actions spec is explicit (SPEC §POST Response – Transaction):

> *"The application may respond with a partially or fully signed transaction. The client and wallet
> must validate the transaction as **untrusted**."*

Two consequences that shape every defense below:

1. **The client/wallet — not the user's eyes — must validate the transaction.** A human reading
   "Claim your airdrop" cannot tell that the bytes underneath drain their wallet. Validation must be
   programmatic (simulation + signer checks), not visual.
2. **Everything the server displays is attacker-controlled.** `title`, `description`, `label`,
   `message`, and `icon` are strings/URLs the server chose. **They must never be trusted as a
   description of what the transaction actually does.**

### The attacker's move

A malicious Action returns a transaction that:
- transfers all SOL / SPL tokens to the attacker, or
- sets a token `Approve` / delegate authority to the attacker (a slow drain), or
- reassigns an account/mint/multisig **authority** to the attacker,

…while `title: "Free NFT mint"` and `message: "Mint successful!"` reassure the user. Nothing in the
metadata is bound to the bytes. This is why the wallet, not the label, is the source of truth.

### Defense in depth (what a correct client does)

- **Simulate before signing** and surface **asset/authority deltas** — SOL/token balance changes,
  new delegates, authority reassignments — so the user sees the real effect, not the marketing copy.
- **Enforce the signer rules** below (reject smuggled extra signers as malicious).
- **Apply the registry `securityLevel`** (`only-trusted` in production) so unregistered/flagged
  providers never render at all. See `docs/blinks-client-and-registry.md`.

---

## The spec-mandated client validation rules

These are the exact rules a Blink client / wallet MUST apply to the `transaction` field. If you build
a *custom* client (not just embedding Dialect's `<Blink>`), you are responsible for all of them.

### Unsigned transaction (no signatures / not partially signed)

- The client **ignores** the provider's `feePayer` and sets it to the request `account`.
- The client **ignores** the provider's `recentBlockhash` and sets the latest blockhash.
- The client **serializes → deserializes** the transaction before signing (an account-key ordering
  workaround).

> Practical consequence for **Action authors**: for a simple user-signed transfer you technically
> don't need a real blockhash — the wallet replaces it — but always set `feePayer = account` and a
> fresh `recentBlockhash` anyway so the transaction serializes cleanly. `createPostResponse` handles
> the unsigned-serialization detail (`requireAllSignatures: false`) for you.

### Partially-signed transaction

- The client **must NOT** alter `feePayer` or `recentBlockhash` — doing so would invalidate the
  existing signatures.
- The client **must verify** every existing signature and **reject the transaction as malformed** if
  any is invalid.

### The signer rule (the load-bearing anti-smuggling defense)

- The client signs **only** with the request `account`, and only if a signature for that account is
  actually expected.
- **If the transaction expects any signature other than the request `account`, the client MUST reject
  it as MALICIOUS.**

This blocks a class of attacks where a malicious Action smuggles in a second required signer — for
example a transaction that also needs the *program authority's* signature, or that co-signs a drain
from a second account the user controls. A user can only ever be asked to sign as themselves.

**Action-author takeaway:** never build a transaction that requires a signature from anyone but the
request `account` (plus server-side `signers` you supply via `createPostResponse`, which are already
signed by the time the base64 reaches the wallet). If your flow *needs* a co-signer, sign it
server-side and pass the `Keypair` in `signers` — do not leave an extra unsigned signer slot.

---

## Build the trusted transaction server-side

The provider is responsible for constructing exactly the transaction it intends and encoding it
consistently. Use `createPostResponse` — it validates, optionally signs, optionally attaches an
Action Identity, and base64-encodes:

```ts
import { createPostResponse } from '@solana/actions';

const payload = await createPostResponse({
  fields: {
    type: 'transaction',
    transaction,                        // a real web3.js v1 Transaction / VersionedTransaction
    message: 'Deposit 1 SOL',
    links: { next: { /* … */ } },       // optional chaining
  },
  signers: [escrowAuthorityKeypair],    // optional extra signers (signed here, server-side)
  actionIdentity: identityKeypair,      // optional attribution memo (see below)
  reference,                            // optional Solana-Pay-style tracking pubkey
});
```

`createPostResponse` behavior relevant to security:
- Requires **≥1 instruction** or throws `CreatePostResponseError` — you can't return an empty tx.
- Signs with any `signers` (`sign` for versioned, `partialSign` for legacy), then serializes with
  `requireAllSignatures: false` (legacy) so the user can still add their signature.
- Returns the transaction **base64-encoded** — never base58.

Keep the transaction-building logic on the server. **Never `partialSign` a server-provided
transaction on a client that isn't the wallet** — that's exactly the untrusted-signing the wallet is
supposed to gate.

---

## Action Identity — verifiable attribution

Action Identity lets a provider **prove on-chain which transactions its Action API produced**, and
lets a chained callback confirm a signature really came from *its* action (not a replayed/spoofed
one). It is optional but is the recommended anti-spoofing primitive for chained flows and analytics.

### The memo format

A dedicated **Action Identity keypair** signs a reference and the result is embedded via a single
**SPL Memo** instruction (Memo program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`):

```text
solana-action:<identityPubkey>:<referencePubkey>:<ed25519_signature>
```

- `identityPubkey` — base58 pubkey of the Action Identity keypair.
- `referencePubkey` — base58 32-byte reference, **single-use**; only the *first* on-chain occurrence
  counts.
- `ed25519_signature` — `nacl.sign.detached(reference.toBytes(), identity.secretKey)` — the identity
  signing **only** the reference.

Placement rules (verified from `actionIdentity.js`):
- The Memo identifier instruction has **zero accounts** (a Memo with account keys would require them
  to be signers).
- The `identity` and `reference` pubkeys are added as **read-only, non-signer** keys onto a
  **non-memo** instruction — which is why `createPostResponse` throws `at least 1 non-memo
  instruction` if the transaction is memo-only. The identity keypair does **not** sign the
  transaction itself.

### Helpers (from `@solana/actions` `actionIdentity.js`)

| Helper | Purpose |
|---|---|
| `createActionIdentifierInstruction(identity, reference?)` | Build the Memo identifier ix → `{ memo, instruction, reference }`. |
| `validateActionIdentifierMemo(identityPubkey, memos)` | Verify the ed25519 signature + that the memo's identity matches → `{ verified: true, reference }` or `false`. |
| `verifySignatureInfoForIdentity(connection, identity, sigInfo)` | Validate the memo **and** use `findReference` to confirm the on-chain signature matches the reference. |
| `getActionIdentityFromEnv(envKey = "ACTION_IDENTITY_SECRET")` | Load the identity `Keypair` from a JSON secret-key env var. |

You rarely call these by hand — `createPostResponse` injects the identity memo automatically when you
pass `actionIdentity` **or** when `ACTION_IDENTITY_SECRET` is set in the environment.

### Verifying attribution later

To confirm a transaction came from your Action:

1. `getSignaturesForAddress(identityPubkey)` (or use the `reference` pubkey).
2. For each transaction, parse the Memo and `validateActionIdentifierMemo` — verify the ed25519
   signature over the reference and that the identity matches.
3. Confirm the transaction is the **first** on-chain occurrence of that reference (references are
   single-use).

Only when all three hold is the attribution valid. `verifySignatureInfoForIdentity` bundles steps
2–3 against a specific signature.

---

## Chained callbacks: the replay / spoof defense

When you chain actions with `links.next: { type: "post", href }` (see
`docs/typed-inputs-and-chaining.md`), the next-action endpoint is a **public POST endpoint** — any
client can call it with **any valid signature**. Confirming the signature *status* is **not enough**;
a confirmed status is trivially satisfied by *any* confirmed transaction on the network.

> Verbatim from the official `chaining-basics/next-action` example: *"any client can hit this public
> endpoint with ANY valid signature. You MUST fetch & validate the transaction actually performed the
> expected action."*

The mandatory pattern:

```ts
// 1. Status check — necessary but NOT sufficient.
const status = await connection.getSignatureStatus(signature);
if (
  status.value?.confirmationStatus &&
  status.value.confirmationStatus !== 'confirmed' &&
  status.value.confirmationStatus !== 'finalized'
) {
  throw 'Unable to confirm the transaction';
}

// 2. Fetch the actual transaction and VERIFY it did the expected thing.
const tx = await connection.getParsedTransaction(signature, 'confirmed');
// - assert the instructions/programIds/accounts/amounts match what YOU issued, AND/OR
// - match the Action Identity memo/reference you embedded (validateActionIdentifierMemo).
if (!txMatchesExpectedAction(tx)) throw 'Signature does not correspond to this action';
```

Skipping step 2 lets an attacker submit an unrelated confirmed signature to advance your chain or
trigger downstream logic (crediting points, unlocking a reward, marking a step complete). Matching
the **Action Identity reference** you embedded is the strongest check because the reference is
single-use and provably tied to your identity keypair.

**Same-origin is also a security boundary:** the client only calls a `post` next-action `href` if it
is the **same origin** as the initial POST — a cross-origin callback is refused and shown as an
error. This prevents a chained callback from redirecting off-domain.

### Round-tripped `state`

`NextActionPostRequest` echoes an opaque `state` string back to your callback verbatim. Use it to
carry step-tracking **you can trust** — encode it as a MAC/JWT signed with a server secret so a
client can't forge it. (Or encode the step in the callback `href` query, e.g. `?step=2`.) Never trust
un-authenticated client-supplied state to gate value.

---

## Sign-message actions (spec 2.4) — anti-replay

`type: "message"` returns a message for the user to sign (SIWS-style auth), not a transaction. Its
`SignMessageData` is built to resist replay:

```ts
type SignMessageData = {
  domain: string;     // the requesting domain — bind the signature to your origin
  address: string;    // the signer's pubkey
  statement: string;  // human-readable purpose
  nonce: string;      // >= 8 random chars, SINGLE-USE — the anti-replay core
  issuedAt: string;   // ISO-8601 timestamp
  chainId?: string;
};
```

Server-side rules:
- **`nonce`** must be ≥8 random characters and **single-use** — store issued nonces and reject reuse.
- **`links.next` is REQUIRED** for sign-message actions and must be a **`post`** link, so the server
  receives and **verifies the returned signature** server-side (a message signature alone proves
  nothing until you check it against the address + your stored nonce).
- Carry a signed **`state`** (MAC/JWT) to bind the challenge to the session.
- Enforce `domain`, `issuedAt` freshness, and `nonce` yourself — the client does not.

This mirrors the SIWS verification model in the wallet-adapter skill; the difference is the challenge
is delivered over the Actions HTTP flow.

---

## Deploy-time hardening

- **Keep secrets server-side, never in client bundles.** `SOLANA_RPC` (paid RPC key) and
  `ACTION_IDENTITY_SECRET` (the identity keypair JSON) belong in server-only env vars. A route
  handler runs on the server; do not leak these into `NEXT_PUBLIC_*` or client components.
- **`actions.json` external `apiPath` is a redirect risk.** An `apiPath` can point to an external
  URL, so a compromised or maliciously-edited `actions.json` can redirect a trusted-looking domain
  (`alice.com/donate`) to an attacker's Action API. **Verify domain ownership and lock down who can
  edit `actions.json`** (it lives at the apex root and is high-value).
- **Scope CORS narrowly.** `Access-Control-Allow-Origin: *` belongs on Action routes + `actions.json`
  **only**, never globally (the SDK explicitly warns against this). See `docs/deployment.md`.
- **Validate every user parameter server-side.** Client `pattern` / `min` / `max` / `required` are
  advisory; a malicious client can POST anything. Re-validate and sanitize in `POST`.
- **Rate-limit and rent-check.** Guard against abuse (e.g. spammy POSTs building transactions) and
  keep recipients rent-exempt (`getMinimumBalanceForRentExemption`) so you don't hand users a tx that
  fails.

---

## Security checklist

- [ ] Return a transaction that requires **only** the request `account` to sign (extra signers are
      signed server-side via `signers`).
- [ ] Never trust `title` / `description` / `message` / `icon` as proof of what the tx does.
- [ ] Build the transaction server-side; never client-side `partialSign` a server-provided tx.
- [ ] Chained callbacks: `getParsedTransaction` + verify effect (or match Action Identity reference),
      not just signature status.
- [ ] `links.next` `post` href is same-origin.
- [ ] Sign-message: single-use `nonce`, required `post` `links.next`, server-side signature verify.
- [ ] Secrets (`SOLANA_RPC`, `ACTION_IDENTITY_SECRET`) server-only.
- [ ] `actions.json` edit access locked; external `apiPath` domains vetted.
- [ ] Production render at `securityLevel="only-trusted"`; register the action at `dial.to/register`.

## Cross-references

- **Chaining flow + the two-route callback example:** `docs/typed-inputs-and-chaining.md` and
  `examples/chained-action/*`.
- **CORS / headers / hosting:** `docs/deployment.md`.
- **Registry states & `securityLevel` gating:** `docs/blinks-client-and-registry.md`.
- **SIWS verification (server-side):** the **wallet-adapter** skill (`skills/wallet-adapter/SKILL.md`).

## References

- Actions spec (untrusted-tx rules, sign-message) — https://solana.com/docs/advanced/actions
- `solana-developers/solana-actions` (SDK + `actionIdentity` + chaining example) — https://github.com/solana-developers/solana-actions
- SPL Memo program — https://spl.solana.com/memo
- CAIP-2 Solana namespace — https://namespaces.chainagnostic.org/solana/caip10
