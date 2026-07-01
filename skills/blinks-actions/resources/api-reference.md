# `@solana/actions` API Reference

Lookup reference for the Solana Actions server SDK, the `@solana/actions-spec` v2 types, the exact
CORS/version headers, the CAIP-2 blockchain IDs, the `actions.json` shape, and the
`@dialectlabs/blinks` client surface. Every export, signature, constant, and ID below is verified
against the published `.d.ts`/`.js` artifacts on npm/unpkg. Build server code to these **package
types** (a discriminated union keyed on `type`) — the human-facing spec markdown shows an older,
simplified shape.

See `SKILL.md` for the narrative, `docs/actions-spec.md` for the full lifecycle, and
`examples/transfer-action/route.ts` for a runnable route handler.

---

## 1. Package & version matrix (stable/frozen — pin explicitly)

| Package | Version | Published | Role |
|---|---|---|---|
| `@solana/actions` | **1.6.6** | 2024-11-05 | Server SDK. **web3.js v1** — depends on `@solana/web3.js ^1.61.0`. **No `@solana/kit` port.** |
| `@solana/actions-spec` | **2.4.2** | 2024-10-24 | Spec **v2** types (types-only; re-exported by the SDK — rarely imported directly). |
| `@solana/web3.js` | **^1** (v1 latest **1.98.4**) | — | Builds the `Transaction` / `VersionedTransaction` you pass to `createPostResponse`. |
| `@dialectlabs/blinks` | **0.22.5** | 2025-04-04 | React client that renders a Blink (`useBlink`, `<Blink>`). Depends on `@dialectlabs/blinks-core ^0.20.7`. |
| `@dialectlabs/blinks-core` | **0.20.7** | 2025-04-04 | Framework-agnostic core: registry + version-negotiation logic. |
| `@dialectlabs/blinks-react-native` | 0.8.6 | — | React Native renderer. |

```bash
# Server (Action API)
npm i @solana/actions @solana/web3.js@^1

# Client (render Blinks) — also needs the classic wallet-adapter stack (see the wallet-adapter skill)
npm i @dialectlabs/blinks @solana/wallet-adapter-react @solana/wallet-adapter-react-ui
```

> The Actions spec and SDK have shipped no release since late 2024 — treat these as the current,
> frozen state of the protocol and pin them, rather than tracking "latest".

---

## 2. `@solana/actions` export surface (verified from `lib/types/index.d.ts`)

`index.d.ts` re-exports these modules:

```
export * from "./types.js";           // spec type re-exports + Reference/Memo/URL field types
export * from "./constants.js";       // ACTIONS_CORS_HEADERS, BLOCKCHAIN_IDS, MEMO_PROGRAM_ID, ...
export * from "./utils.js";           // createActionHeaders, actionCorsMiddleware
export * from "./encodeURL.js";       // encodeURL (Solana Pay-style URL builder)
export * from "./parseURL.js";        // parseURL
export * from "./createQR.js";        // createQR (uses @solana/qr-code-styling)
export * from "./fetchTransaction.js";
export * from "./findReference.js";
export * from "./createPostResponse.js";  // createPostResponse, CreatePostResponseError
export * from "./actionIdentity.js";      // Action Identity helpers
export * from "./signMessageData.js";     // sign-message helpers
```

The names you use day-to-day, grouped:

| Group | Exports |
|---|---|
| **Response builder** | `createPostResponse`, `CreatePostResponseError` |
| **Header / CORS helpers** | `createActionHeaders`, `actionCorsMiddleware` |
| **Constants** | `ACTIONS_CORS_HEADERS`, `ACTIONS_CORS_HEADERS_MIDDLEWARE`, `BLOCKCHAIN_IDS`, `MEMO_PROGRAM_ID`, `BLINKS_QUERY_PARAM` |
| **GET types** | `Action`, `ActionGetResponse`, `ActionType`, `LinkedAction`, `LinkedActionType`, `ActionError` |
| **Input types** | `ActionParameter`, `ActionParameterSelectable`, `ActionParameterType`, `TypedActionParameter` |
| **POST types** | `ActionPostRequest`, `ActionPostResponse` (`TransactionResponse` / `PostResponse` / `ExternalLinkResponse` / `SignMessageResponse`) |
| **Chaining types** | `NextAction`, `NextActionLink`, `PostNextActionLink`, `InlineNextActionLink`, `CompletedAction`, `NextActionPostRequest` |
| **actions.json types** | `ActionsJson`, `ActionRuleObject` |
| **Action Identity helpers** | `createActionIdentifierInstruction`, `validateActionIdentifierMemo`, `verifySignatureInfoForIdentity`, `getActionIdentityFromEnv` |
| **Solana Pay-adjacent** | `encodeURL`, `parseURL`, `createQR`, `fetchTransaction`, `findReference` |
| **Protocol constants** | `SupportedProtocols`, `SOLANA_ACTIONS_PROTOCOL`, `SOLANA_PAY_PROTOCOL` |

---

## 3. Constants (verified from `constants.js`)

### `ACTIONS_CORS_HEADERS` — Next.js `HeadersInit` form

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

### `ACTIONS_CORS_HEADERS_MIDDLEWARE` — Hono/Express/Fastify `cors()` plugin form

```js
export const ACTIONS_CORS_HEADERS_MIDDLEWARE = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", "Authorization", "Content-Encoding", "Accept-Encoding",
    "X-Accept-Action-Version", "X-Accept-Blockchain-Ids",
  ],
  exposedHeaders: ["X-Action-Version", "X-Blockchain-Ids"],
};
```

Spec minimum on `OPTIONS`: `Access-Control-Allow-Origin: *`,
`Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS`, and an `Access-Control-Allow-Headers` that
includes at least `Content-Type, Authorization, Content-Encoding, Accept-Encoding`. **Scope
`Allow-Origin: *` to Action routes + `actions.json` only** — the SDK warns against setting it
globally.

### Other constants

| Constant | Value |
|---|---|
| `MEMO_PROGRAM_ID` | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` (SPL Memo program) |
| `BLINKS_QUERY_PARAM` | `"action"` (interstitial query param; value begins with `solana-action:`) |
| `BLOCKCHAIN_IDS` | see §8 |

---

## 4. Header helpers (verified from `utils.js`)

### `createActionHeaders(args?)`

```ts
type HeaderHelperArgs = {
  headers?: typeof ACTIONS_CORS_HEADERS;
  chainId?: keyof typeof BLOCKCHAIN_IDS | string;   // "mainnet" | "devnet" | "testnet" | raw CAIP-2
  actionVersion?: string | number;
};

export function createActionHeaders(args?: HeaderHelperArgs): Record<string, string>;
```

Behavior: starts from `ACTIONS_CORS_HEADERS`; if `chainId` is passed it adds `X-Blockchain-Ids`
(resolving `"mainnet"|"devnet"|"testnet"` via `BLOCKCHAIN_IDS`, otherwise using the raw string); if
`actionVersion` is passed it adds `X-Action-Version` (`.toString()`). Called with **no args** it
returns bare `ACTIONS_CORS_HEADERS` — neither negotiation header is emitted, which makes the Dialect
client warn *"Blink compatibility metadata is not set."* Always pass both in production:

```ts
const headers = createActionHeaders({ chainId: "devnet", actionVersion: "2.4" });
// → ACTIONS_CORS_HEADERS + X-Blockchain-Ids: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 + X-Action-Version: 2.4
```

### `actionCorsMiddleware(args)` — Express/Connect

```ts
export function actionCorsMiddleware(
  args: HeaderHelperArgs,
): (_req: any, res: any, next: Function) => void;
// impl: res.set(createActionHeaders(args)); next();
```

For Hono/Fastify-native CORS, feed `ACTIONS_CORS_HEADERS_MIDDLEWARE` into that framework's `cors()`
plugin instead.

---

## 5. `createPostResponse(...)` (verified from `createPostResponse.d.ts`/`.js`)

```ts
import { Commitment, PublicKey, Signer, Transaction, VersionedTransaction } from "@solana/web3.js";

export class CreatePostResponseError extends Error { name: string; }

export interface CreateActionPostResponseArgs<
  TransactionType = Transaction | VersionedTransaction
> {
  fields: Omit<TransactionResponse, "transaction"> & {
    transaction: TransactionType;   // a web3.js v1 Transaction or VersionedTransaction (NOT yet base64)
  };
  signers?: Signer[];               // extra signers (e.g. a newly-created mint keypair)
  actionIdentity?: Signer;          // optional Action Identity keypair (attribution memo)
  reference?: PublicKey;            // optional reference key (Solana Pay-style attribution)
  options?: { commitment?: Commitment };
}

export function createPostResponse(
  args: CreateActionPostResponseArgs,
): Promise<ActionPostResponse>;
```

What it does:

1. Falls back to `getActionIdentityFromEnv()` when no `actionIdentity` is passed (silently continues
   if the env keypair is absent).
2. Requires **≥1 instruction**, else throws `CreatePostResponseError("at least 1 instruction is required")`.
3. If an `actionIdentity` is present, appends an SPL Memo identifier instruction and injects the
   `identity` + `reference` as read-only **non-signer** keys onto the first **non-memo** instruction
   (throws if the tx has only memo instructions).
4. Signs with any `signers` (`partialSign` for legacy, `sign` for versioned).
5. Serializes and **base64-encodes**: legacy uses `serialize({ requireAllSignatures: false })`;
   versioned uses `transaction.serialize()`. Returns the `fields` object with `transaction` replaced
   by the base64 string.

Pass a real web3.js transaction; the SDK returns the spec-shaped `{ type, transaction: <base64>, ... }`.
`VersionedTransaction` (v0) is fully supported — build a
`new TransactionMessage(...).compileToV0Message()` → `new VersionedTransaction(msg)` and hand it over
(see `examples/transfer-action/route.ts`).

---

## 6. GET types (verified from `@solana/actions-spec@2.4.2`)

```ts
export type ActionType = "action" | "completed";

// `type` is OPTIONAL on ActionGetResponse (backwards compat); set it to "action".
export interface ActionGetResponse extends Omit<Action, "type"> {
  type?: "action";
}

export interface Action<T extends ActionType = "action"> {
  type: T;
  icon: string;         // absolute HTTP(S) URL to an SVG, PNG, or WebP image
  title: string;
  description: string;
  label: string;        // button text (verb-first, ≤5 words); IGNORED when links.actions is present
  disabled?: boolean;   // default false
  links?: { actions: LinkedAction[] };
  error?: ActionError;  // non-fatal message shown to the user
}

export interface ActionError { message: string; }
```

- `icon` **must** be an absolute URL to **SVG / PNG / WebP** or the client rejects it as malformed.
- If `links.actions` is **absent**, the client renders one button using the root `label` and POSTs
  to the GET URL. If **present**, the client renders only the listed actions and ignores the root
  `label`.

### `LinkedAction` — note the required `type`

```ts
export type LinkedActionType = "transaction" | "message" | "post" | "external-link";

export interface LinkedAction {
  type: LinkedActionType;                     // REQUIRED in the 2.x package type
  href: string;                               // relative or same-origin absolute; {slots} filled from parameters
  label: string;                              // button text
  parameters?: Array<TypedActionParameter>;   // user inputs (see §9)
}
```

> ⚠️ The **spec markdown** shows a simplified `LinkedAction` *without* `type`. The **published
> package type requires it.** Clients tolerate its absence (defaulting to `transaction`), but set
> `type: "transaction"` explicitly for `actions-spec@2.x` correctness.

---

## 7. POST types (verified — discriminated union on `type`)

### `ActionPostRequest` (client → server)

```ts
export type PostActionType = LinkedActionType; // "transaction" | "message" | "post" | "external-link"

export interface ActionPostRequest<T = string> {
  type?: PostActionType;
  account: string;                                   // base58 pubkey that may sign the transaction
  data?: Record<keyof T, string | Array<string>>;    // input values keyed by parameter name (string[] = multi-select)
}
```

The client POSTs at minimum `{ "account": "<base58 pubkey>" }`. Named `parameters` usually arrive
via the `href` template (query or subpath); multi-option inputs may also land in `data`.

### `ActionPostResponse` (server → client)

```ts
export interface ActionResponse {
  type?: PostActionType;
  message?: string;
  links?: { next: NextActionLink };   // chaining hook (§10)
}

export interface TransactionResponse extends ActionResponse {
  type: "transaction";
  transaction: string;                // base64-encoded serialized transaction
}
export interface PostResponse extends ActionResponse {
  type: "post";                       // advances a chain with no signing pop-up
}
export interface ExternalLinkResponse extends ActionResponse {
  type: "external-link";
  externalLink: string;
}
export interface SignMessageResponse extends ActionResponse {
  type: "message";
  data: string | SignMessageData;
  state?: string;
  links: { next: PostNextActionLink }; // required for sign-message
}

export type ActionPostResponse =
  | TransactionResponse
  | PostResponse
  | ExternalLinkResponse
  | SignMessageResponse;
```

| `type` | Extra field(s) | Use for |
|---|---|---|
| `"transaction"` | `transaction: <base64>` | The common case — a signable tx. |
| `"message"` | `data`, `links.next` (required) | Sign-message / SIWS-style auth (spec 2.4). |
| `"post"` | — | A step that only advances a chain, no signing pop-up. |
| `"external-link"` | `externalLink: string` | Redirect the user to a URL. |

**The `transaction` field is base64, never base58.** For an unsigned tx the wallet ignores your
`feePayer` (sets it to the request `account`) and your `recentBlockhash` (sets the latest); you still
set both so it serializes cleanly. The client signs **only** with the request `account` — if any
other signature is expected it rejects the tx as **malicious**.

---

## 8. CAIP-2 blockchain IDs (verified from `BLOCKCHAIN_IDS`)

```js
export const BLOCKCHAIN_IDS = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet:  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
};
```

| Cluster | CAIP-2 ID |
|---|---|
| mainnet-beta | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| testnet | `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` |

Form: `solana:<genesis-hash-truncated-to-32-chars>` (CAIP-2 caps the reference at 32 chars).
Reference: `namespaces.chainagnostic.org/solana/caip10`.

### Header names (server ↔ client negotiation)

| Header | Direction | Meaning |
|---|---|---|
| `X-Action-Version` | server → client (exposed) | Actions spec version the provider implements. |
| `X-Blockchain-Ids` | server → client (exposed) | Comma-separated CAIP-2 chain IDs the action targets. |
| `X-Accept-Action-Version` | client → server (allowed) | Max spec version the client supports. |
| `X-Accept-Blockchain-Ids` | client → server (allowed) | Chain IDs the client supports. |

### Version values & feature gates (`X-Action-Version`)

Valid values are the `actions-spec` versions, compared **major.minor (patch ignored)**. Dialect
client baseline is `"2.2"`, current max `"2.4"`.

| Version | Adds |
|---|---|
| `2.0` | base v2 spec |
| `2.1` | additional blink input types (sRFC #29) |
| `2.2` | **action chaining** (`links.next`, `NextAction`, `completed`) |
| `2.3` | optional `transaction`; external-link responses |
| `2.4` | **sign-message** action type |

A blink is supported iff `providerVersion ≤ clientMaxVersion` **and** the provider's blockchain IDs
intersect the client's supported set.

---

## 9. Typed inputs (verified from package type)

### `ActionParameterType` (10 types)

```ts
type GeneralParameterType =
  | "text" | "email" | "url" | "number"
  | "date" | "datetime-local" | "textarea";

type SelectableParameterType = "select" | "radio" | "checkbox";

export type ActionParameterType = GeneralParameterType | SelectableParameterType;
// @default "text" — unknown values fall back to a plain text input.
```

Each resembles the matching HTML `<input type>` (or `<textarea>` / `<select>`). Unsupported HTML
types: `hidden`, `button`, `submit`, `file`.

### `ActionParameter` (non-selectable)

```ts
export interface ActionParameter<T extends ActionParameterType, M = MinMax<T>> {
  type?: T;                    // defaults to "text"
  name: string;                // matches the {name} slot in the LinkedAction href
  label?: string;              // placeholder text
  required?: boolean;          // defaults false
  pattern?: string;            // regex string for client-side validation (ignored if invalid regex)
  patternDescription?: string; // REQUIRED whenever `pattern` is provided
  min?: M;                     // see MinMax
  max?: M;
}

type MinMax<T extends ActionParameterType> =
  T extends "date" | "datetime-local" ? string  // ISO date string bounds
  : T extends "radio" | "select" ? never         // bounds meaningless
  : number;                                       // numeric bound OR character-length for strings
```

`min`/`max` semantics by type: numeric bounds for `number`; ISO date strings for
`date`/`datetime-local`; **character length** for other string inputs; `never` for `radio`/`select`.

### `ActionParameterSelectable` (select / radio / checkbox)

```ts
export interface ActionParameterSelectable<T extends ActionParameterType>
  extends Omit<ActionParameter<T>, "pattern"> {
  options: Array<{
    label: string;      // displayed option label
    value: string;      // submitted value
    selected?: boolean; // default-selected?
  }>;
}

export type TypedActionParameter<T extends ActionParameterType = ActionParameterType> =
  T extends SelectableParameterType
    ? ActionParameterSelectable<T>
    : ActionParameter<T>;
```

`select` → dropdown (single). `radio` → single choice. `checkbox` → multiple; selected values arrive
back as a **string array** in the POST body `data`. All three **require** an `options` array. Client
`pattern`/`min`/`max` is advisory only — **enforce every constraint server-side.**

Full walkthrough → `docs/typed-inputs-and-chaining.md`.

---

## 10. Chaining types (verified)

```ts
export type NextActionLink = PostNextActionLink | InlineNextActionLink;

export interface PostNextActionLink {
  type: "post";
  href: string;   // relative or SAME-ORIGIN URL; receives NextActionPostRequest, responds with NextAction
}
export interface InlineNextActionLink {
  type: "inline";
  action: NextAction; // rendered immediately after confirmation, no callback
}

export type NextAction = Action<"action"> | CompletedAction;
export type CompletedAction = Omit<Action<"completed">, "links">; // terminal; cannot chain further

export interface NextActionPostRequest extends Omit<ActionPostRequest, "type"> {
  account: string;      // base58 pubkey
  signature?: string;   // tx id OR message signature from the previous step
  state?: string;       // opaque value relayed back verbatim (round-trip state)
}
```

- After the returned `transaction` confirms, a `"post"` link makes the client POST
  `{ account, signature, state? }` to the **same-origin** `href`; the response is the next `Action`
  or a terminal `CompletedAction` (`type: "completed"`, no `links`). An `"inline"` link renders its
  embedded `action` with no callback.
- **Same-origin is enforced** — a cross-origin `href` makes the client skip the callback and show an
  error. Absence of `links.next` ⇒ the client shows its own completed state.
- **Security:** the callback is a public endpoint; confirming signature *status* is not enough
  (spoofable). `getParsedTransaction(signature)` and verify the tx actually did the expected thing.

Full example (two routes) → `docs/typed-inputs-and-chaining.md`.

---

## 11. `actions.json` (verified from `@solana/actions-spec`)

```ts
export interface ActionsJson { rules: ActionRuleObject[]; }
export interface ActionRuleObject {
  pathPattern: string; // pattern matched against the incoming website pathname (relative preferred)
  apiPath: string;     // destination: absolute pathname or external URL
}
```

> The field is **`apiPath`**, not `apiPathPattern` (that name does not exist in the spec or type
> package).

Path matching operators:

| Operator | Matches |
|---|---|
| `*` | a **single** path segment (no `/` separators) |
| `**` | zero or more chars incl. `/` across segments; **must be last** if combined with other operators |
| `?` | **unsupported** |

- Must be served at the **domain root** `https://<domain>/actions.json` with
  `Access-Control-Allow-Origin: *` on GET and OPTIONS.
- Query params from the original URL are **always preserved** and appended to the mapped URL.
- `apiPath` may point to an **external URL** — a malicious mapping can redirect a trusted-looking
  domain to an attacker's Action API, so lock down who can edit it.
- The idempotent self-map `{ "/api/actions/**" → "/api/actions/**" }` is the most common production
  rule: it advertises that everything under `/api/actions/` is an Actions API.

Runnable root file → `examples/actions.json`. Route-handler form → `docs/actions-spec.md`.

---

## 12. Action Identity helpers (attribution — verified from `actionIdentity.js`)

Optional mechanism to provably attribute on-chain activity to an Action Provider via a single SPL
Memo instruction of the form `solana-action:<identity>:<reference>:<signature>` (the signature is
`nacl.sign.detached(reference.toBytes(), identity.secretKey)`).

| Export | Purpose |
|---|---|
| `createActionIdentifierInstruction(identity, reference?)` | Build the memo identifier instruction → `{ memo, instruction, reference }`. |
| `validateActionIdentifierMemo(identityPubkey, memos)` | Verify the ed25519 signature + identity match → `{ verified, reference }` or `false`. |
| `verifySignatureInfoForIdentity(connection, identity, sigInfo)` | Validate the memo **and** confirm the on-chain signature matches the reference (`findReference`). Use in a chained `next-action` callback. |
| `getActionIdentityFromEnv(envKey = "ACTION_IDENTITY_SECRET")` | Load the identity `Keypair` from a JSON secret-key env var. |

`createPostResponse` builds/injects this automatically when you pass `actionIdentity`/`reference`, or
when `ACTION_IDENTITY_SECRET` is set. Keep the secret **server-only**. Full threat model →
`docs/security.md`.

---

## 13. `@dialectlabs/blinks` client surface (verified)

The dominant Blink renderer. Now multi-chain (Solana + EVM via viem/wagmi).

**Peer dependencies** (`@dialectlabs/blinks@0.22.5`):

```json
"peerDependencies": {
  "react": ">=18", "react-dom": ">=18",
  "@solana/web3.js": "^1.95.3",
  "@solana/wallet-adapter-react": "^0.15.0",
  "@solana/wallet-adapter-react-ui": "^0.9.0",
  "viem": "^2.x", "wagmi": "^2.x"
}
```

**Subpath exports:** `.`, `./api`, `./index.css`, `./ext/twitter`, `./hooks/solana`, `./hooks/evm`.

**Key exports:**

| Export | From | Role |
|---|---|---|
| `Blink` (a.k.a. `BlinkComponent`) | `@dialectlabs/blinks` | The React component that renders a Blink. |
| `useBlink({ url })` | `@dialectlabs/blinks` | Fetch + build the `BlinkInstance` from an Action URL. |
| `useBlinksRegistryInterval()` | `@dialectlabs/blinks` | Load + refresh the security registry (~10 min). |
| `useBlinkSolanaWalletAdapter(rpcUrl)` | `@dialectlabs/blinks/hooks/solana` | Wrap wallet-adapter connect/sign/confirm into a Blink `adapter`. |

```tsx
"use client";
import "@dialectlabs/blinks/index.css";
import { Blink, useBlink, useBlinksRegistryInterval } from "@dialectlabs/blinks";
import { useBlinkSolanaWalletAdapter } from "@dialectlabs/blinks/hooks/solana";

useBlinksRegistryInterval();
const { adapter } = useBlinkSolanaWalletAdapter(rpcUrl);
const { blink } = useBlink({ url: actionUrl });
// <Blink blink={blink} adapter={adapter} stylePreset="x-dark" securityLevel="only-trusted" />
```

- **`stylePreset`**: `"default"` (dial.to theme) | `"x-dark"` | `"x-light"` | `"custom"`.
- **`securityLevel`**: `"only-trusted"` | `"non-malicious"` | `"all"` — filters what renders against
  the registry state (`trusted` / `malicious` / `unknown`). Default to **`only-trusted`** in production.
- **Requires the classic wallet-adapter `WalletProvider` + `WalletModalProvider`** above in the tree
  (see the **wallet-adapter** skill).

> Rename to know: the original API used `Action` / `useAction` / `useActionSolanaWalletAdapter`;
> current names are `Blink` / `useBlink` / `useBlinkSolanaWalletAdapter`. Legacy aliases are kept, so
> old tutorials still compile.

### Registry & interstitial endpoints

| Thing | Value |
|---|---|
| Registry list (client lookup) | `GET https://actions-registry.dial.to/all` |
| CORS proxy (client relay) | `https://proxy.dial.to` |
| Interstitial (render + sign any Blink) | `https://dial.to/?action=solana-action:<url>` |
| Register a Blink (manual review) | `https://dial.to/register` |
| Debug tool | `https://www.blinks.xyz/inspector` |

Full client + provider guide → `docs/blinks-client-and-registry.md`.

---

## References

- Actions spec (authoritative) — https://solana.com/docs/advanced/actions
- `solana-developers/solana-actions` — https://github.com/solana-developers/solana-actions
- `@solana/actions` on npm — https://www.npmjs.com/package/@solana/actions
- `@solana/actions-spec` on npm — https://www.npmjs.com/package/@solana/actions-spec
- `@solana/actions` types — https://unpkg.com/@solana/actions@1.6.6/lib/types/index.d.ts
- `@solana/actions-spec` types — https://unpkg.com/@solana/actions-spec@2.4.2/index.d.ts
- Dialect Blinks docs — https://docs.dialect.to/blinks
- `@dialectlabs/blinks` on npm — https://www.npmjs.com/package/@dialectlabs/blinks
- CAIP-2 Solana namespace — https://namespaces.chainagnostic.org/solana/caip10
