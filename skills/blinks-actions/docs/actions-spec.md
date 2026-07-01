# The Actions Spec — Reference

The long-form spec reference behind the condensed donate route in `SKILL.md`. This file covers the
complete request/response lifecycle, the exact `@solana/actions-spec@2.4.2` types (GET metadata, the
POST request, and the POST-response discriminated union), the two SDK builders you actually call
(`createActionHeaders` + `createPostResponse`), the exact CORS/version headers, `actions.json`
mapping, and a minimal-but-complete `GET`+`POST`+`OPTIONS` route handler.

Scope boundary: typed inputs and action chaining are their own doc
(`docs/typed-inputs-and-chaining.md`); client rendering is `docs/blinks-client-and-registry.md`;
CORS scoping / hosting is `docs/deployment.md`. This file is the server-side spec core.

Pinned versions (stable/frozen, not deprecated):

| Package | Version | Role |
|---|---|---|
| `@solana/actions` | **1.6.6** | Server SDK. web3.js **v1** (`@solana/web3.js ^1.61.0`). **No `@solana/kit` port.** |
| `@solana/actions-spec` | **2.4.2** | Spec **v2** types (types-only; re-exported by the SDK). |
| `@solana/web3.js` | **^1** (v1 latest 1.98.4) | Builds the `Transaction` / `VersionedTransaction`. |

---

## 1. The request/response lifecycle (6 steps)

One Action URL drives up to six HTTP exchanges. Every request is made by the **client** (a wallet, a
Blink renderer, the `dial.to` interstitial, a bot, or a QR scanner) against **your server** (the
Action API). The client is untrusted output for a browser to render; your server is the source of
truth for the transaction.

1. **URL scheme** — `solana-action:<link>`, where `<link>` is a *conditionally* URL-encoded
   **absolute HTTPS** URL. Encode it if it carries query params; leave it un-encoded for a shorter QR
   if it does not. Clients URL-decode; a decoded URL that is **not** absolute HTTPS is **malformed**
   and rejected. (A plain website URL can substitute for this scheme when an `actions.json` maps it —
   see §7.)
2. **`OPTIONS`** — CORS preflight. Must return `Access-Control-Allow-Origin: *` and the Actions
   header set (§5). **Mandatory** — a missing `OPTIONS` is the single most common "Blink won't load"
   cause, because clients preflight before the `GET`.
3. **`GET`** — the client fetches metadata. It must **not** identify the wallet or user (no `account`
   in a GET); it sends `Accept-Encoding` and the negotiation headers `X-Accept-Action-Version` /
   `X-Accept-Blockchain-Ids`.
4. **`GET` response** — an `ActionGetResponse` (icon / title / description / label / `disabled` /
   `links.actions` / `error`). The client renders buttons and inputs from this.
5. **`POST`** — the client sends `{ account: "<base58 pubkey>", data? }`, where `account` is the
   wallet that will sign. Your handler builds and returns a signable transaction.
6. **`POST` response** — an `ActionPostResponse` with a **base64-encoded** serialized transaction
   (plus optional `message` / `links.next`). The wallet sets the fee payer + a fresh blockhash, the
   user signs and submits, and the client tracks confirmation — then optionally follows `links.next`
   into a chained next action.

```
  Client (wallet / Blink / bot)                 Your Action API (server)
  -----------------------------                 ------------------------
  1. resolve solana-action:<https url>
  2. OPTIONS  ─────────────────────────────▶    200 + CORS headers            (MANDATORY)
  3. GET      ─────────────────────────────▶    ActionGetResponse (metadata)
     ◀── render buttons + typed inputs ────
  4. user picks a button / fills inputs
  5. POST { account, data? } ──────────────▶    build tx → createPostResponse →
                                                { type:"transaction", transaction:<base64>, message }
     ◀── wallet re-sets feePayer + fresh ──
         blockhash; user SIGNS + SUBMITS
  6. (optional) links.next ────────────────▶    NextAction → … → CompletedAction
```

## 2. How the wallet handles your transaction (the rules that shape your POST)

The wallet — **not** the user's eyes — is responsible for validating the returned transaction. Its
handling depends on whether you return an unsigned or a partially-signed tx:

- **Unsigned tx (no signatures):** the client **ignores your `feePayer`** and sets it to the request
  `account`; **ignores your `recentBlockhash`** and sets the latest; and serialize→deserializes
  before signing (an account-key-ordering workaround). This is why the canonical handler still sets
  `feePayer` + a real blockhash even though they get overwritten — the tx must **serialize cleanly**,
  which `createPostResponse` does with `requireAllSignatures: false`.
- **Partially-signed tx:** the client must **not** alter `feePayer`/`recentBlockhash` (that would
  invalidate your signatures) and must **verify** the existing signatures, rejecting the tx as
  **malformed** if any is invalid. If you partially sign, your blockhash is now load-bearing — fetch
  it fresh.
- **Only the request `account` signs.** If the returned tx expects **any other** signature that the
  request account cannot provide, the client rejects it as **malicious**. Never smuggle in an extra
  required signer. Extra `Signer`s that *you* hold must be applied server-side via
  `createPostResponse({ signers })` before the tx reaches the client (see §6).

Practical consequence: for a simple user-signed transfer you technically don't need a valid
blockhash (the wallet replaces it), but always set one anyway so serialization succeeds, and never
require a signature other than `account`.

## 3. GET — `ActionGetResponse`

Verbatim from `@solana/actions-spec@2.4.2` (`index.d.ts`):

```ts
export type ActionType = "action" | "completed";

// `type` is OPTIONAL on ActionGetResponse (backwards compatibility); set it to "action".
export interface ActionGetResponse extends Omit<Action, "type"> {
  type?: "action";
}

export interface Action<T extends ActionType = "action"> {
  /** kind of Action to present to the user */
  type: T;
  /** absolute HTTP/HTTPS URL of an icon image — must be SVG, PNG, or WebP */
  icon: string;
  /** source of the action request (brand / store / person) */
  title: string;
  /** brief summary of the action to be performed */
  description: string;
  /** button text — verb-first, ≤ 5 words */
  label: string;
  /** disable the button (e.g. a closed vote); defaults to false */
  disabled?: boolean;
  links?: {
    /** related Actions the user could perform (buttons + inputs) */
    actions: LinkedAction[];
  };
  /** non-fatal error message shown to the user (does not block render) */
  error?: ActionError;
}

export interface ActionError {
  message: string;
}
```

**Field rules (from the spec):**

- **`icon`** — must be an **absolute** URL to an **SVG, PNG, or WebP** image. A relative URL, a
  non-HTTPS URL, or another format (e.g. `.jpg` is tolerated by some clients but off-spec; GIF/AVIF
  are not) makes the client reject the metadata as malformed. Build it from the request origin:
  `new URL("/icon.png", new URL(req.url).origin).toString()`.
- **`title` / `description` / `label`** — UTF-8 strings. `label` is the button caption: verb-first,
  ≤ 5 words ("Donate", "Stake SOL"). Treat all three as **display-only, attacker-controllable**
  text — never a trustworthy description of what the tx does (see `docs/security.md`).
- **`disabled`** — renders the button greyed out; pair with `error` to explain why (e.g. a poll that
  has closed).
- **`error`** — a **non-fatal** banner. It does **not** stop the Blink from rendering; use it for
  "you already claimed" style states. Fatal problems are returned as an `ActionError` body with an
  HTTP `4xx`/`5xx` status instead (see §6.4).
- **`links.actions`**:
  - **Absent** ⇒ the client renders a **single button** using the root `label` and POSTs to the
    **same URL as the GET**.
  - **Present** ⇒ the client renders **only** the listed `LinkedAction`s (buttons + inputs) and does
    **not** render the root `label` button. Each `LinkedAction.href` is where the POST goes.

### `LinkedAction`

```ts
export type LinkedActionType = "transaction" | "message" | "post" | "external-link";

export interface LinkedAction {
  /** REQUIRED in the 2.x package type (see the discrepancy note below) */
  type: LinkedActionType;
  /** POST endpoint for this action — relative or same-origin absolute URL */
  href: string;
  /** button text */
  label: string;
  /** typed user inputs, spliced into {name} slots in `href` (see docs/typed-inputs-and-chaining.md) */
  parameters?: Array<TypedActionParameter>;
}
```

> **Spec-markdown vs package-type discrepancy — build to the package type.** The human-readable spec
> markdown shows a *simplified* `LinkedAction` **without** a `type` field. The published
> `@solana/actions-spec@2.x` type makes `type` **required**. Clients tolerate its absence (they
> default a missing linked-action `type` to `"transaction"`), but for new, type-correct code set
> `type: "transaction"` explicitly on every `LinkedAction`.

## 4. POST — `ActionPostRequest`

The request body the client sends after the user picks a button:

```ts
export type PostActionType = LinkedActionType; // "transaction" | "message" | "post" | "external-link"

export interface ActionPostRequest<T = string> {
  type?: PostActionType;
  /** base58-encoded public key of the account that may sign the transaction */
  account: string;
  /** user-input values keyed by parameter name; value is string OR string[] (multi-select) */
  data?: Record<keyof T, string | Array<string>>;
}
```

The client always sends at least `{ "account": "<base58 pubkey>" }`. Typed `parameters` are usually
delivered through the `href` template (query or subpath), but selectable inputs — especially
`checkbox`, which returns a **`string[]`** — can also arrive in `data`. Always re-validate `account`
by constructing a `PublicKey` inside a `try/catch`, and enforce every input constraint server-side
(client `pattern`/`min`/`max` is advisory only).

## 5. POST response — the discriminated union

The published package type is a **discriminated union keyed on `type`** — richer than the simplified
single-shape in the spec markdown. Build to this union.

```ts
export interface ActionResponse {
  type?: PostActionType;              // discriminator
  message?: string;                   // display text shown near the sign prompt (attacker-controlled)
  links?: { next: NextActionLink };   // chain into a next action (see docs/typed-inputs-and-chaining.md)
}

export interface TransactionResponse extends ActionResponse {
  type: "transaction";
  transaction: string;                // base64-encoded serialized transaction
}
export interface PostResponse extends ActionResponse {
  type: "post";                       // advance a chain with NO signing pop-up (no tx)
}
export interface ExternalLinkResponse extends ActionResponse {
  type: "external-link";
  externalLink: string;               // redirect the user to a URL
}
export interface SignMessageResponse extends ActionResponse {
  type: "message";                    // SIWS-style sign-message (spec 2.4)
  data: string | SignMessageData;
  state?: string;
  links: { next: PostNextActionLink }; // REQUIRED for sign-message so the server can verify the sig
}

export type ActionPostResponse =
  | TransactionResponse
  | PostResponse
  | ExternalLinkResponse
  | SignMessageResponse;
```

| `type` | Extra field(s) | Signing pop-up? | Use for |
|---|---|---|---|
| `"transaction"` | `transaction: <base64>` | Yes | The common case — a signable tx. |
| `"message"` | `data`, `links.next` (**required**) | Sign-message | SIWS-style auth (spec 2.4). See `docs/security.md`. |
| `"post"` | — | No | A step that only advances a chain (no tx). |
| `"external-link"` | `externalLink: string` | No | Redirect the user to a URL. |

> **Wire format is base64, never base58.** The `transaction` field is the base64 of a *serialized*
> web3.js transaction. Solana Pay uses base64 too — do not confuse Actions with the base58 some other
> tooling uses. `createPostResponse` produces the base64 for you (§6).

### 5.4 Returning errors

For a **fatal** failure (bad `account`, missing amount, rent check failed), return an `ActionError`
body with a `4xx` status and the CORS headers:

```ts
const actionError: ActionError = { message: typeof err === "string" ? err : "An unknown error occurred" };
return Response.json(actionError, { status: 400, headers });
```

The client surfaces `message` to the user. (A non-fatal, still-renderable notice goes in the `error`
field of the `ActionGetResponse` instead.)

## 6. `createPostResponse(args)` — build + sign + base64-encode

You never hand-serialize the transaction. Pass a real web3.js v1 `Transaction` /
`VersionedTransaction` and `createPostResponse` returns the spec-shaped, **base64-encoded**
`ActionPostResponse`.

```ts
import { Commitment, PublicKey, Signer, Transaction, VersionedTransaction } from "@solana/web3.js";

export class CreatePostResponseError extends Error { name: string; }

export interface CreateActionPostResponseArgs<
  TransactionType = Transaction | VersionedTransaction
> {
  fields: Omit<TransactionResponse, "transaction"> & {
    transaction: TransactionType;   // a web3.js Transaction/VersionedTransaction — NOT yet base64
    // i.e. { type: "transaction", transaction, message?, links? }
  };
  signers?: Signer[];               // extra signers YOU hold (e.g. a newly-created mint keypair)
  actionIdentity?: Signer;          // optional Action Identity keypair → injects an attribution memo
  reference?: PublicKey;            // optional Solana-Pay-style reference key for tracking
  options?: { commitment?: Commitment };
}

export function createPostResponse(
  args: CreateActionPostResponseArgs,
): Promise<ActionPostResponse>;
```

**Behavior (verified from the SDK source):**

1. If `actionIdentity` is omitted, it tries `getActionIdentityFromEnv()` (reads a keypair from
   `ACTION_IDENTITY_SECRET`) and silently continues if none is set.
2. Detects legacy vs `VersionedTransaction`. Requires **≥ 1 instruction** or throws
   `CreatePostResponseError("at least 1 instruction is required")`.
3. If an Action Identity is present, it appends an SPL Memo identifier instruction and injects the
   `identity` + `reference` as **read-only non-signer** keys onto the **first non-memo** instruction
   — so it throws if the tx has *only* memo instructions ("requires at least 1 non-memo
   instruction"). See `docs/security.md`.
4. Signs with any `signers` (`partialSign` for legacy, `sign` for versioned).
5. Serializes and **base64-encodes**: legacy uses `serialize({ requireAllSignatures: false })` (so
   the user can still add their signature); versioned uses `transaction.serialize()`. Returns the
   `fields` object with `transaction` replaced by the base64 string.

`VersionedTransaction` is fully supported — build a `new TransactionMessage({...}).compileToV0Message()`,
wrap it in a `VersionedTransaction`, and pass it; the SDK detects and serializes it correctly.

## 7. Headers, CORS & version negotiation

Every Action route **and** `actions.json` must return the Actions CORS header set. Generate it once
with `createActionHeaders()` and reuse it for `GET`, `POST`, and `OPTIONS`.

### `ACTIONS_CORS_HEADERS` (exact, for `HeadersInit` frameworks like Next.js)

```js
export const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "Content-Type": "application/json",
};
```

Note `Access-Control-Allow-Methods` is exactly **`GET,POST,PUT,OPTIONS`**. **Scope
`Access-Control-Allow-Origin: *` to Action routes + `actions.json` only** — the SDK explicitly warns
against setting it globally. (Express/Hono/Fastify use `ACTIONS_CORS_HEADERS_MIDDLEWARE` /
`actionCorsMiddleware(...)` instead — see `docs/deployment.md`.)

### The negotiation headers (easy to get wrong)

- **Server → client (exposed):** `X-Action-Version` (the spec version you implement) and
  `X-Blockchain-Ids` (comma-separated CAIP-2 chains you target).
- **Client → server (accepted):** `X-Accept-Action-Version` and `X-Accept-Blockchain-Ids` (what the
  client supports). These are listed in `Access-Control-Allow-Headers` so browsers pass them through
  preflight.

### `createActionHeaders({ headers?, chainId?, actionVersion? })`

```ts
type HeaderHelperArgs = {
  headers?: typeof ACTIONS_CORS_HEADERS;
  chainId?: "mainnet" | "devnet" | "testnet" | string; // key of BLOCKCHAIN_IDS, or a raw CAIP-2 string
  actionVersion?: string | number;
};

export function createActionHeaders(args?: HeaderHelperArgs): Record<string, string>;
```

Behavior: starts from `ACTIONS_CORS_HEADERS`; **only if** `chainId` is passed does it add
`X-Blockchain-Ids` (resolving `"mainnet"|"devnet"|"testnet"` via `BLOCKCHAIN_IDS`, else passing the
raw string through); **only if** `actionVersion` is passed does it add `X-Action-Version`
(`.toString()`). Called bare, it returns just `ACTIONS_CORS_HEADERS` — so neither negotiation header
is emitted unless you pass it.

```ts
// Recommended — advertises spec version + chain so clients don't warn:
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });
// Bare createActionHeaders() omits X-Action-Version / X-Blockchain-Ids → the Dialect client shows
// "Blink compatibility metadata is not set. Please contact the blink provider."
```

**Version negotiation math:** the client compares `X-Action-Version` **major.minor only (patch
ignored)**. A Blink is supported iff `providerVersion <= clientMaxVersion` **and** the provider's
`X-Blockchain-Ids` intersect the client's supported set. Dialect's client uses a **baseline of
`"2.2"`** and a **max of `"2.4"`** (the current actions-spec version). Feature gates: `2.0` base v2,
`2.1` typed input types, `2.2` action chaining, `2.3` optional-tx / external-link, `2.4`
sign-message. Passing `actionVersion: "2.4"` advertises full support.

### CAIP-2 blockchain IDs (`BLOCKCHAIN_IDS`)

Form `solana:<genesis-hash-truncated-to-32-chars>`:

| Cluster | CAIP-2 ID |
|---|---|
| mainnet-beta | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| testnet | `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` |

## 8. `actions.json` — mapping website URLs to your Action API

`actions.json` lets a plain, human-shareable website link (`example.com/donate`, not a
`solana-action:` URL) be discovered and unfurled: it maps incoming website paths to your Action API
endpoints. It **must** be served at the **domain root** — `https://example.com/actions.json` — with
`Access-Control-Allow-Origin: *` on both `GET` and `OPTIONS`.

```ts
export interface ActionsJson { rules: ActionRuleObject[]; }
export interface ActionRuleObject {
  pathPattern: string; // matched against the incoming website pathname (relative preferred)
  apiPath: string;     // destination: absolute pathname OR external URL
}
```

> The field is **`apiPath`** — there is no `apiPathPattern` in the spec or the type package.

**Path-matching operators:**

| Operator | Matches |
|---|---|
| `*` | Exactly **one** path segment (no `/` inside). |
| `**` | **Zero or more** characters including `/`, across multiple segments. If combined with other operators it **must be last**. |
| `?` | **Unsupported.** |

Query params from the original URL are **always preserved** and appended to the mapped URL. Wildcard
captures are positional (`/trade/*` matches `/trade/123` and `/trade/abc`).

```json
{
  "rules": [
    { "pathPattern": "/donate",         "apiPath": "/api/actions/donate" },
    { "pathPattern": "/actions/*",      "apiPath": "/api/actions/*" },
    { "pathPattern": "/api/actions/**", "apiPath": "/api/actions/**" }
  ]
}
```

- The **idempotent self-map** `{ "/api/actions/**" → "/api/actions/**" }` is the most common
  production rule — it advertises that everything under `/api/actions/` is an Actions API so clients
  can detect support without the `solana-action:` prefix.
- `apiPath` may be an **external URL** (`https://api.dialect.com/api/v1/donate/*`). This is a security
  surface: a malicious mapping redirects a trusted-looking domain to an attacker's Action API — lock
  down who can edit `actions.json` and verify domain ownership (see `docs/security.md`).
- Serve it as a route handler (bundles CORS via `createActionHeaders()`) or as a static
  `public/actions.json` with CORS configured separately. Static form → `examples/actions.json`;
  the route-handler form + apex-domain / cross-host `apiPath` hosting → `docs/deployment.md`.

## 9. Minimal, complete `GET` + `POST` + `OPTIONS` handler

A single Next.js App Router Route Handler — the smallest thing that renders as a Blink and returns a
signable transaction. (The fuller multi-button parameterized form is `examples/transfer-action/route.ts`.)

```ts
// app/api/actions/donate/route.ts
import {
  ActionError,
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const TREASURY = new PublicKey("3h4AtoLTh3bWwaLhdtgQtcC3a3Tokvbg9GXkATub6Jh8");

// Advertise spec version + chain so clients don't warn about missing metadata.
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

export const GET = async (req: Request) => {
  const { origin } = new URL(req.url);
  const payload: ActionGetResponse = {
    type: "action",
    icon: new URL("/icon.png", origin).toString(), // absolute HTTPS, SVG/PNG/WebP only
    title: "Donate SOL",
    description: "Support the project with a SOL donation.",
    label: "Donate 0.1 SOL", // rendered because there is no links.actions
  };
  return Response.json(payload, { headers });
};

// MANDATORY — CORS preflight must succeed or the Blink never renders.
export const OPTIONS = async () => new Response(null, { headers });

export const POST = async (req: Request) => {
  try {
    const body: ActionPostRequest = await req.json();

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("mainnet-beta"));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const transaction = new Transaction({
      feePayer: account, // the wallet re-sets this for an unsigned tx, but set it so the tx serializes
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: TREASURY,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      }),
    );

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction", // discriminated-union tag — set it for 2.x correctness
        transaction,
        message: "Donate 0.1 SOL — thank you!",
      },
      // signers: [extraKeypair],    // extra Signers YOU hold, if the tx needs them
      // actionIdentity: identityKp, // optional attribution memo (see docs/security.md)
    });

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = {
      message: typeof err === "string" ? err : "An unknown error occurred",
    };
    return Response.json(actionError, { status: 400, headers });
  }
};
```

What each piece is doing:

- **`OPTIONS`** returns the CORS headers with an empty body — without it the client's preflight fails
  and the Blink shows "Unable to load." `new Response(null, { headers })` and
  `Response.json(null, { headers })` are both fine.
- **`GET`** returns metadata with no `links.actions`, so the client renders a single button using the
  root `label`, POSTing back to this same URL. (Add `links.actions` to render fixed buttons and typed
  inputs — see `examples/transfer-action/route.ts` and `docs/typed-inputs-and-chaining.md`.)
- **`POST`** re-validates `account`, fetches a **fresh blockhash per request** (never cache built
  transactions — a blockhash expires in ~60–90s), builds one instruction, and lets
  `createPostResponse` sign + base64-encode.
- The `headers` constant is shared across all three exports — one source of truth for CORS + version.

## References

- Actions spec (authoritative) — https://solana.com/docs/advanced/actions
- `solana-developers/solana-actions` (SDK + spec + examples) — https://github.com/solana-developers/solana-actions
- `@solana/actions` on npm — https://www.npmjs.com/package/@solana/actions
- `@solana/actions-spec` on npm — https://www.npmjs.com/package/@solana/actions-spec
- Canonical SOL-transfer route handler — https://github.com/solana-developers/solana-actions/blob/main/examples/next-js/src/app/api/actions/transfer-sol/route.ts
- CAIP-2 Solana namespace — https://namespaces.chainagnostic.org/solana/caip10

**See also:** `docs/typed-inputs-and-chaining.md` (typed inputs + `links.next` chaining),
`docs/deployment.md` (CORS scoping, Express/Hono, caching, hosting), `docs/security.md` (untrusted-tx
model + Action Identity), `resources/api-reference.md` (full export surface + signatures, type/operator
lookup tables).
