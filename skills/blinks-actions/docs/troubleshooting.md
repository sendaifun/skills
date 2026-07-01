# Blinks & Actions Troubleshooting

The exhaustive error catalog behind SKILL.md → "Common Errors". Each entry is symptom → **Cause** →
**Solution**, pointing to the relevant doc or example. Grouped by where the failure happens: **render
/ CORS**, **POST / transaction**, **chaining**, **registry / distribution**, and **client SDK**.

Debug order for "my Blink won't work": (1) open the **Blinks Inspector** at
`https://www.blinks.xyz/inspector` and paste your Action URL — it shows the GET/POST payloads and
response headers; (2) `curl` the three methods directly (below); (3) if it inspects fine but doesn't
render in a wallet/feed, it's a **registry** issue, not an API issue.

```bash
# OPTIONS preflight — MUST return CORS headers (Access-Control-Allow-Origin: *)
curl -i -X OPTIONS https://your.app/api/actions/donate

# GET metadata
curl -s https://your.app/api/actions/donate | jq

# POST — MUST return { type:"transaction", transaction:"<base64>", message }
curl -s -X POST 'https://your.app/api/actions/donate?amount=1' \
  -H 'Content-Type: application/json' \
  -d '{"account":"6JpNV6DK88auwzKVizdeT4Bw3D44sam5GqjcPCJ7y176"}' | jq
```

---

## Render / CORS errors

### Error: Blink shows "Unable to load" / never renders
**Cause** The most common cause is a **missing `OPTIONS` handler**. Blink clients send a CORS
preflight before every `GET`; with no `OPTIONS` route the preflight fails and the client never
fetches your metadata. Other causes: missing/incorrect CORS headers, a missing root `actions.json`,
or an `icon` that isn't an absolute HTTPS SVG/PNG/WebP.
**Solution** Export an `OPTIONS` handler that returns the same CORS headers as GET/POST:

```ts
const headers = createActionHeaders({ chainId: 'mainnet', actionVersion: '2.4' });
export const OPTIONS = async () => new Response(null, { headers });
// (Response.json(null, { headers }) also works.)
```

Verify the preflight with `curl -i -X OPTIONS …` — you must see `Access-Control-Allow-Origin: *`.
See `docs/deployment.md`.

### Error: CORS preflight passes locally but fails in production
**Cause** `Access-Control-Allow-Origin: *` was set only on some routes, or a proxy/CDN/edge config
strips the header, or the header is set globally and a security layer overrides it. The Actions CORS
set must be present on **both** the Action routes **and** `actions.json`.
**Solution** Use `createActionHeaders()` on every Action route and on the `actions.json` route.
**Scope `Allow-Origin: *` to Action routes + `actions.json` only** (the SDK warns against setting it
globally). For Express/Hono/Fastify use `ACTIONS_CORS_HEADERS_MIDDLEWARE` or `actionCorsMiddleware()`
instead of the Next.js `HeadersInit` form. See `docs/deployment.md`.

### Error: "Blink compatibility metadata is not set. Please contact the blink provider."
**Cause** Your response omits `X-Action-Version` and/or `X-Blockchain-Ids`. Bare
`createActionHeaders()` (no args) returns the CORS set but does **not** emit those two negotiation
headers, so the Dialect client can't verify version/chain compatibility.
**Solution** Pass `chainId` and `actionVersion`:

```ts
const headers = createActionHeaders({ chainId: 'mainnet', actionVersion: '2.4' });
// → adds  X-Blockchain-Ids: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp  and  X-Action-Version: 2.4
```

`chainId` accepts `"mainnet" | "devnet" | "testnet"` (resolved to CAIP-2 via `BLOCKCHAIN_IDS`) or a
raw CAIP-2 string. The SDK does **not** hardcode an `X-Action-Version` token — `createActionHeaders`
only emits the header when you pass `actionVersion` — so advertise the spec version you actually
implement (e.g. `"2.4"`, the `@solana/actions-spec` major.minor). The client compares it
major.minor, patch ignored; `"2.4"` is the current spec max.

### Error: The icon is missing / the card renders without an image
**Cause** `icon` is not an **absolute HTTPS** URL, or points to an unsupported format. The spec
requires the icon be an absolute URL to an **SVG, PNG, or WebP** image; a relative path, `http://`,
or a `.jpg`/`.gif`/data-URI can be rejected as malformed.
**Solution** Build an absolute HTTPS URL from the request origin and use SVG/PNG/WebP:

```ts
icon: new URL('/icon.png', new URL(req.url).origin).toString(),
```

---

## POST / transaction errors

### Error: `CreatePostResponseError: at least 1 instruction is required`
**Cause** You passed an empty `Transaction` (no instructions) to `createPostResponse`.
**Solution** Add at least one instruction before calling `createPostResponse`. If a branch can build
an empty tx, return an `ActionError` instead of an empty transaction.

### Error: `transaction requires at least 1 non-memo instruction`
**Cause** You used `actionIdentity` (or `ACTION_IDENTITY_SECRET` is set in the env) on a **memo-only**
transaction. The Action Identity `identity`/`reference` keys must attach to a **non-memo**
instruction, so a tx containing only Memo instructions has nowhere to attach them.
**Solution** Include at least one real (non-memo) instruction alongside the memo — e.g. a
`ComputeBudgetProgram.setComputeUnitPrice({ microLamports })` instruction. This is exactly why the
official chaining example adds a ComputeBudget ix next to its Memo ix. See
`examples/chained-action/route.ts`.

### Error: Wallet rejects the transaction as malicious / malformed
**Cause** One of:
- the returned tx expects **a signature other than the request `account`** (clients reject smuggled
  extra signers as malicious);
- a **partially-signed** tx whose existing signatures don't verify (rejected as malformed);
- the action was reached via a **non-absolute-HTTPS** action URL.
**Solution** Build a tx that only the request `account` needs to sign; sign any extra signers
**server-side** by passing their `Keypair`s in `createPostResponse({ signers })` (so they're already
signed in the base64). If you partially sign, ensure the signatures are valid. Use absolute HTTPS
action URLs. Full threat model in `docs/security.md`.

### Error: Transaction won't decode / wallet errors on the payload
**Cause** You base58-encoded the transaction. This is the classic Solana Pay confusion — Solana Pay
and Actions both deal in transactions, but the **Actions POST `transaction` field is base64**, not
base58.
**Solution** Return a real web3.js v1 `Transaction`/`VersionedTransaction` to `createPostResponse` and
let it base64-encode — never call `bs58.encode` on the serialized tx yourself.

### Error: `Blockhash not found` / "Transaction expired" when the user signs
**Cause** You **cached** the POST response (or the built transaction) and served a stale
`recentBlockhash`. Blockhashes expire in ~60–90 seconds; a cached transaction is dead on arrival.
**Solution** **Never cache POST responses.** Fetch a fresh `getLatestBlockhash()` inside **every**
`POST`, build the transaction, and return it uncached:

```ts
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
const transaction = new Transaction({ feePayer: account, blockhash, lastValidBlockHeight }).add(ix);
```

GET metadata (icon/title) may be cached via `Cache-Control`; POST tx responses must not. See
`docs/deployment.md` (Caching).

### Error: TypeScript error on `fields` / `ActionPostResponse` / `LinkedAction` — "type is missing"
**Cause** `@solana/actions-spec@2.x` uses **discriminated unions keyed on `type`**. `TransactionResponse`
requires `type: "transaction"`, and `LinkedAction` requires `type: LinkedActionType`. Omitting the
discriminator makes the compiler unable to narrow the union, producing errors like *"Property 'type'
is missing"* or *"'transaction' does not exist on type 'ActionPostResponse'"*.
**Solution** Set `type: "transaction"` explicitly on the POST response `fields` **and** on each
`LinkedAction`:

```ts
// POST response
await createPostResponse({ fields: { type: 'transaction', transaction, message } });

// GET linked actions
links: { actions: [{ type: 'transaction', label: '1 SOL', href: '/api/actions/donate?amount=1' }] }
```

Runtime clients tolerate a missing `type` (defaulting to `transaction`), but new code should set it
for 2.x type-correctness. Type reference in `resources/api-reference.md`.

### Error: Recipient "may not be rent exempt" / tx fails on submit
**Cause** The transfer amount is below the minimum balance a new account needs to stay rent-exempt.
**Solution** Check `getMinimumBalanceForRentExemption(0)` before building the transfer and reject with
an `ActionError` if the amount is too small. See `examples/transfer-action/route.ts`.

---

## Chaining errors

### Error: The chained next-action never fires (or shows an error) after the tx confirms
**Cause** `links.next.href` is a **different origin** than the initial POST. The spec enforces
same-origin for `post` next-actions as a security boundary; a cross-origin callback is refused and
the client shows an error.
**Solution** Use a **same-origin** relative or absolute `href` for the `post` next-action:

```ts
links: { next: { type: 'post', href: '/api/actions/vote/next' } } // same origin — good
```

### Error: Confused about `inline` vs `post` next-action — which to use?
**Cause** The two `NextActionLink` variants behave differently and are easy to mix up.
**Solution**
- **`{ type: "post", href }`** → after the tx confirms, the client POSTs `{ account, signature, state? }`
  to the **same-origin** `href`; your callback returns the next `Action` (or a terminal
  `CompletedAction`). Use this when the next step **depends on the on-chain result** (verify the
  signature, personalize the success screen).
- **`{ type: "inline", action }`** → the client renders the embedded `action` **immediately**, with
  **no callback**. Use this when the next step is static and needs no server verification.
- Absence of `links.next` ⇒ the client shows its own generic "completed" state after confirmation.
- Terminate a chain with a `CompletedAction` (`type: "completed"`, which omits `links` — it cannot
  chain further). See `docs/typed-inputs-and-chaining.md`.

### Error: Chained callback advances even with an unrelated / spoofed signature
**Cause** Your next-action callback confirms only the signature **status**. The endpoint is public;
any client can POST any confirmed signature, and status alone is spoofable.
**Solution** After the status check, **`getParsedTransaction(signature)` and verify the tx actually
did the expected thing** — ideally by matching an Action Identity memo/reference you embedded. This is
load-bearing; see `docs/security.md` (Chained callbacks) and `examples/chained-action/next-action-route.ts`.

### Error: `{ "message": "Method not supported" }` (HTTP 403) hitting a callback endpoint
**Cause** This is **expected** for a callback-only next-action endpoint. Those routes intentionally
reject `GET` (they only accept the chained `POST` + `OPTIONS`).
**Solution** Nothing to fix on the server — this is the correct 403 for a `GET` to a callback route.
If *you* are getting it unexpectedly, you're calling the next-action URL with the wrong method; the
chain callback is a `POST`. The route still answers `OPTIONS` for CORS.

---

## Registry / distribution errors

### Error: The Blink renders in dev but is blank / not auto-rendering in Phantom or on X
**Cause** Your action's registry state is **`unknown`** (unregistered). Wallet extensions and
X-via-extension only auto-unfurl **`trusted`** actions, and Phantom's Blinks toggle is **off by
default** and renders only registry-verified actions.
**Solution** Register at **`https://dial.to/register`** (manual review; alt: email
`hello@dialect.to`). Until approved, distribute via the `dial.to` interstitial (which renders any
blink with a status badge) or embed `<Blink>` in your own app. See
`docs/blinks-client-and-registry.md` (Distribution).

### Error: `<Blink>` renders blank in my own app even though the API works
**Cause** The client `securityLevel` is `only-trusted` but your (unregistered) action is `unknown`,
so it's filtered out. Common in local dev before registration.
**Solution** For dev, relax the gate: `securityLevel="all"` (or `"non-malicious"`). For production,
keep `only-trusted` and register the action. Remember the merge policy is pessimistic
(`malicious` > `unknown` > `trusted`). See `docs/blinks-client-and-registry.md`.

### Error: `actions.json` is served but a plain website link still doesn't unfurl
**Cause** `actions.json` isn't at the **domain root**, isn't returning `Access-Control-Allow-Origin: *`,
or uses the wrong field name. It **must** be reachable at `https://<domain>/actions.json` (apex root,
even if your API is on a subdomain), with CORS, and the fields are **`pathPattern` + `apiPath`** —
there is no `apiPathPattern`.
**Solution** Serve it at the root with CORS. As a route handler it bundles CORS via
`createActionHeaders()`; as a static `public/actions.json` you must configure the CORS header
separately. Verify with `curl -i https://your.app/actions.json`.

```json
{ "rules": [ { "pathPattern": "/api/actions/**", "apiPath": "/api/actions/**" } ] }
```

Operators: `*` = one segment, `**` = zero-or-more segments (must be **last** if combined), `?`
unsupported; query params are always preserved. See `examples/actions.json` and the route-handler /
apex-hosting form in `docs/deployment.md`.

### Error: Shared `dial.to` link is malformed / doesn't open the blink
**Cause** The `action` query value isn't a `solana-action:`-prefixed absolute **HTTPS** URL, or the
inner URL's query params weren't URL-encoded.
**Solution** Use `https://dial.to/?action=solana-action:<https action url>`. URL-encode the inner URL
when it carries its own query string. A decoded value that isn't absolute HTTPS is malformed. See
`docs/blinks-client-and-registry.md`.

---

## Client SDK (`@dialectlabs/blinks`) errors

### Error: `<Blink>` renders unstyled / broken layout
**Cause** You didn't import the stylesheet. `@dialectlabs/blinks` ships its CSS separately.
**Solution** Add `import '@dialectlabs/blinks/index.css';` in the client component (or a top-level
client module). Note this is **separate** from wallet-adapter's
`@solana/wallet-adapter-react-ui/styles.css` — you need both. See
`docs/blinks-client-and-registry.md`.

### Error: `useBlinkSolanaWalletAdapter` / wallet actions do nothing; signing never prompts
**Cause** The classic wallet-adapter provider tree is missing above the `<Blink>`. `@dialectlabs/blinks`
**requires** `<WalletProvider>` + `<WalletModalProvider>` (and `<ConnectionProvider>`) in the tree.
**Solution** Wrap the app in the wallet-adapter providers (with `wallets={[]}` so Wallet-Standard
wallets auto-register). See the provider tree in `docs/blinks-client-and-registry.md` and the full
setup in the **wallet-adapter** skill (`skills/wallet-adapter/SKILL.md`).

### Error: Next.js — "window is not defined" / hydration error from the Blink or wallet UI
**Cause** Wallet/Blink components touch browser globals and can't render on the server.
**Solution** Put `'use client'` at the top of the provider tree and the Blink component; dynamically
import the wallet button with `{ ssr: false }`. See the wallet-adapter skill for the SSR pattern.

### Error: Old tutorial uses `useAction` / `<Action>` — is it broken?
**Cause** Dialect renamed the API `Action*` → `Blink*` (`useAction`→`useBlink`, `<Action>`→`<Blink>`,
`useActionSolanaWalletAdapter`→`useBlinkSolanaWalletAdapter`).
**Solution** Nothing is broken — the legacy `Action*` names are still exported as backwards-compat
aliases and compile as-is. Migrate to the `Blink*` names opportunistically. Full alias table in
`docs/blinks-client-and-registry.md`.

---

## Cross-references

- **Server build / CORS / hosting:** `docs/deployment.md`
- **Spec types & `createPostResponse`/`createActionHeaders` internals:** `docs/actions-spec.md`,
  `resources/api-reference.md`
- **Typed inputs & chaining:** `docs/typed-inputs-and-chaining.md`
- **Client rendering, registry, distribution, SBL:** `docs/blinks-client-and-registry.md`
- **Threat model:** `docs/security.md`
- **Runnable examples:** `examples/transfer-action/route.ts`, `examples/parameterized-action/route.ts`,
  `examples/actions.json`, `examples/chained-action/*`, `examples/blink-client.tsx`

## References

- Blinks Inspector (debug) — https://www.blinks.xyz/inspector
- Actions spec — https://solana.com/docs/advanced/actions
- `solana-developers/solana-actions` (SDK + examples) — https://github.com/solana-developers/solana-actions
- Dialect Blinks docs — https://docs.dialect.to/blinks
- dial.to interstitial + registry — https://dial.to and https://dial.to/register
