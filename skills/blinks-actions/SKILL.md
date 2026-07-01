---
name: blinks-actions
description: Build Solana Actions and Blinks: implement the Actions spec (GET metadata + POST transaction) with @solana/actions, serve actions.json, add typed inputs, chain actions, and render Blinks with @dialectlabs/blinks. Covers Next.js Route Handlers, CORS/headers, CAIP-2 blockchain IDs, the Dialect registry (dial.to), security, and testing with the Blinks Inspector. Use when building shareable transaction links (Blinks) or Action API endpoints.
---

# Solana Actions & Blinks

Turn any Solana transaction into a shareable link that renders as an interactive button — a **Blink** — by serving the Actions HTTP spec. A user clicks the button, their wallet pops up a transaction you built server-side, they sign, and it lands. No redirect, no dApp visit.

## Overview — the two-layer model

Actions and Blinks are **two layers with two different owners**. Keep them separate in your head:

- **Actions** = an open HTTP spec + the `@solana/actions` SDK that **you host**. An Action is a spec-compliant endpoint that answers `GET` with metadata (icon/title/description/buttons/inputs) and `POST` with a base64-encoded transaction. It is just JSON over HTTP with CORS and a couple of custom headers. Maintained under `solana-developers/solana-actions`.
- **Blinks** (Blockchain Links) = **clients** that take an Action URL and unfurl it into interactive UI. A Blink is a wallet browser extension, the `dial.to` interstitial, or a `<Blink>` React component embedding your Action. The dominant client stack is Dialect's (`@dialectlabs/blinks`, `dial.to`, the registry).

**A Blink is a client, not a payload.** Your server returns JSON; a Blink renders it. You build Actions; the ecosystem provides Blinks.

**Status (mid-2026):** not deprecated — the spec matured to **v2** (typed actions, chaining, sign-message), the SDK is stable/frozen (`@solana/actions@1.6.6`, no API churn in over a year, still web3.js v1 with **no `@solana/kit` port**), and distribution consolidated under Dialect. The honest limitation: **X/Twitter never natively unfurled Blinks and still doesn't** — in-feed rendering is done by opt-in, registry-gated wallet browser extensions, never mobile. Lead with your own app + `dial.to` as the reliable surfaces.

## How it works — the request flow

One Action URL, four HTTP exchanges, all made by the *client* (wallet / Blink / bot) against *your server*:

```
  Blink client                              Your Action API (server)
  ------------                              ------------------------
  1. OPTIONS  ───────────────────────────▶  CORS preflight → 200 + CORS headers   (MANDATORY)
  2. GET      ───────────────────────────▶  ActionGetResponse (icon,title,desc,
                                             label, links.actions[], parameters)
     ◀─── render buttons + inputs ────────
  3. user picks a button / fills inputs
  4. POST {account:"<base58>", data?} ────▶  build tx → createPostResponse →
                                             { type:"transaction", transaction:<base64>, message }
     ◀─── wallet sets feePayer + fresh ───
          blockhash, user SIGNS + SENDS
  5. (optional) links.next ──────────────▶  chained NextAction → ... → completed
```

Key rule the wallet applies: if your returned transaction is **unsigned**, the client **ignores** your `feePayer` (sets it to the request `account`) and **ignores** your `recentBlockhash` (sets the latest). You still set both so the tx serializes cleanly — `createPostResponse` handles the `requireAllSignatures: false` serialization for you.

## Install & versions

Pin these explicitly — the Actions stack is stable/frozen, so pins read as evergreen, not stale.

| Package | Version | Purpose |
|---|---|---|
| `@solana/actions` | **1.6.6** | Server SDK. **web3.js v1** — depends on `@solana/web3.js ^1.61.0`. NO kit port. |
| `@solana/actions-spec` | **2.4.2** | Spec **v2** types (types-only; re-exported by the SDK — you rarely import it directly). |
| `@solana/web3.js` | **^1** (current v1: 1.98.4) | Build the `Transaction` / `VersionedTransaction` you pass to `createPostResponse`. |
| `@dialectlabs/blinks` | **0.22.5** | React client that renders a Blink (`useBlink`, `<Blink>`). Requires the classic wallet-adapter stack. |

```bash
# Server (Action API)
npm i @solana/actions @solana/web3.js@^1

# Client (render Blinks in your own app) — also needs the wallet-adapter stack (see wallet-adapter skill)
npm i @dialectlabs/blinks @solana/wallet-adapter-react @solana/wallet-adapter-react-ui
```

> **Version hygiene:** the *runtime* SDK is `1.6.6` but the *spec/types* are `2.4.2` — different packages. "Actions v2" means the **spec** (`actions-spec`), which `@solana/actions@1.x` implements. If you need `@solana/kit` server-side, build the tx with kit and base64-encode it manually — but you lose `createPostResponse`'s signing/reference/identity plumbing.

## When to use what

| You want to… | Use | Notes |
|---|---|---|
| Serve custom transaction logic (your protocol/app) | **Build your own Action API** (`@solana/actions`) | GET+POST+**OPTIONS** route handler. The durable, spec-level core. |
| Offer swaps/lends on Jupiter, Kamino, Raydium, Orca, Meteora, Drift… | **Standard Blinks Library** (hosted `*.dial.to` APIs) | Don't build/maintain a tx server; call `https://<protocol>.dial.to/api/v0/...` with an `X-Blink-Client-Key`. See `docs/blinks-client-and-registry.md`. |
| Embed a signable transaction card in your own dApp | **`<Blink>` component** (`@dialectlabs/blinks`) | `useBlink` + `<Blink>` + `useBlinkSolanaWalletAdapter`. See `docs/blinks-client-and-registry.md`. |
| A single link that renders + signs anywhere | **`dial.to` interstitial** | `https://dial.to/?action=solana-action:<url-encoded action url>`. |
| In-feed unfurling on X / wallet extensions | **Register at `dial.to/register`** | Manual review; only `trusted` Actions auto-render (and only for users with a Blink-capable extension enabled). |

## Building an Action (server)

An Action is a **Next.js App Router Route Handler** exporting **`GET` + `POST` + `OPTIONS`**. The `OPTIONS` handler is **mandatory** — Blink clients preflight before every GET, and a missing `OPTIONS` is the #1 cause of "Blink won't load."

```ts
// app/api/actions/donate/route.ts
import {
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  ActionError,
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

// Emit CORS + X-Action-Version + X-Blockchain-Ids. Passing chainId/actionVersion
// avoids the Dialect client's "compatibility metadata not set" warning.
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

export const GET = async (req: Request) => {
  const { origin } = new URL(req.url);
  const payload: ActionGetResponse = {
    type: "action",
    icon: new URL("/icon.png", origin).toString(), // absolute HTTPS, SVG/PNG/WebP only
    title: "Donate SOL",
    description: "Support the project with a SOL donation.",
    label: "Donate", // ignored when links.actions is present
    links: {
      actions: [
        { type: "transaction", label: "0.1 SOL", href: "/api/actions/donate?amount=0.1" },
        { type: "transaction", label: "1 SOL",   href: "/api/actions/donate?amount=1" },
        {
          type: "transaction",
          label: "Donate", // button text for the custom-amount input
          href: "/api/actions/donate?amount={amount}",
          parameters: [
            { type: "number", name: "amount", label: "SOL amount", required: true, min: 0.001 },
          ],
        },
      ],
    },
  };
  return Response.json(payload, { headers });
};

// MANDATORY: preflight must succeed or the Blink never renders.
export const OPTIONS = async () => new Response(null, { headers });

export const POST = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const amount = Number(url.searchParams.get("amount"));
    if (!amount || amount <= 0) throw "Invalid amount";

    const body: ActionPostRequest = await req.json();
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("mainnet-beta"));

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: TREASURY,
        lamports: amount * LAMPORTS_PER_SOL,
      }),
    );
    transaction.feePayer = account; // the wallet re-sets this anyway
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction", // discriminated-union tag — set it for 2.x correctness
        transaction,
        message: `Donate ${amount} SOL — thank you!`,
      },
      // signers: [extraKeypair],       // extra Signers if the tx needs them
      // actionIdentity: identityKp,    // optional attribution memo (see docs/security.md)
    });

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = { message: typeof err === "string" ? err : "Unknown error" };
    return Response.json(actionError, { status: 400, headers });
  }
};
```

`createPostResponse` takes a real web3.js `Transaction` (or `VersionedTransaction`), requires **≥1 instruction** (else throws `CreatePostResponseError`), signs with any `signers`, optionally injects an Action Identity memo, and **base64-encodes** the result. **Never base58-encode the transaction** — the wire format is base64.

Full multi-button parameterized version → **`examples/transfer-action/route.ts`**. Reusable boilerplate → **`templates/action-route.ts`**. Deep spec (all types, lifecycle, `createPostResponse`/`createActionHeaders` internals) → **`docs/actions-spec.md`**. Hosting, RPC env, caching → **`docs/deployment.md`**.

### POST response types (discriminated union on `type`)

Your `POST` can return one of four shapes. Set the `type` tag explicitly:

| `type` | Returns | Use for |
|---|---|---|
| `"transaction"` | `transaction: <base64>` | The common case — a signable tx. |
| `"message"` | `data`, `links.next` (required) | Sign-message / SIWS-style auth (spec 2.4). |
| `"post"` | (no tx) | A step that only advances a chain, no signing pop-up. |
| `"external-link"` | `externalLink: string` | Redirect the user to a URL. |

## Headers, CORS & CAIP-2

Every Action route (and `actions.json`) must return the Actions CORS header set. Use `createActionHeaders()` — it returns `ACTIONS_CORS_HEADERS` plus optional negotiation headers:

- **Server → client, exposed:** `X-Action-Version` (spec version you implement) + `X-Blockchain-Ids` (CAIP-2 chains you target).
- **Client → server, accepted:** `X-Accept-Action-Version` + `X-Accept-Blockchain-Ids`. These are in `Access-Control-Allow-Headers` so browsers pass them through preflight.

```ts
import { createActionHeaders, ACTIONS_CORS_HEADERS } from "@solana/actions";

// Recommended — advertises spec version + chain so clients don't warn:
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });
// Bare createActionHeaders() omits X-Action-Version/X-Blockchain-Ids → Dialect shows
// "Blink compatibility metadata is not set. Please contact the blink provider."
```

**CAIP-2 blockchain IDs** (`BLOCKCHAIN_IDS`) — form `solana:<genesis-hash-truncated-to-32-chars>`:

| Cluster | CAIP-2 ID |
|---|---|
| mainnet-beta | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| testnet | `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` |

**Scope `Access-Control-Allow-Origin: *` to Action routes + `actions.json` only** — the SDK explicitly warns against setting it globally. For Express/Hono/Fastify use `ACTIONS_CORS_HEADERS_MIDDLEWARE` or `actionCorsMiddleware(...)` instead of the Next.js `HeadersInit` form. Header names, version-negotiation math (major.minor compare, patch ignored), and middleware forms → **`docs/deployment.md`** and **`resources/api-reference.md`**.

## actions.json

`actions.json` maps a website's human-shareable URLs → your Action API endpoints, so a plain link (`example.com/donate`, not a `solana-action:` URL) is discoverable and unfurl-able. It **must** be served at the **domain root** (`https://example.com/actions.json`) with `Access-Control-Allow-Origin: *`.

```json
{
  "rules": [
    { "pathPattern": "/donate",         "apiPath": "/api/actions/donate" },
    { "pathPattern": "/actions/*",      "apiPath": "/api/actions/*" },
    { "pathPattern": "/api/actions/**", "apiPath": "/api/actions/**" }
  ]
}
```

- The field is **`apiPath`**, not `apiPathPattern` (that name does not exist).
- `*` = one path segment; `**` = zero-or-more segments incl. `/` (must be **last** if combined); `?` unsupported. Query params from the original URL are always preserved.
- The idempotent self-map `{"/api/actions/**" → "/api/actions/**"}` is the most common production rule: it advertises that everything under `/api/actions/` is an Actions API.
- `apiPath` can point to an **external URL** — verify domain ownership and lock down who can edit `actions.json`; a malicious mapping redirects a trusted-looking domain to an attacker's Action API (see Security).

Static root file with hosting notes → **`examples/actions.json`**; the route-handler form (bundles CORS via `createActionHeaders()`) and apex-domain / cross-host `apiPath` details → **`docs/deployment.md`**.

## Typed inputs

Add form inputs by attaching `parameters[]` to a `LinkedAction`. The value the user enters is spliced into the `{name}` slot in the `href`. There are **10 `ActionParameterType`s**:

`text`, `email`, `url`, `number`, `date`, `datetime-local`, `textarea` (general) and `select`, `radio`, `checkbox` (selectable — each **requires an `options[]` array**).

```ts
parameters: [
  { type: "number", name: "amount", label: "SOL amount", required: true, min: 0.1, max: 100 },
  { type: "textarea", name: "note", label: "Optional note", max: 280 },
  {
    type: "select",
    name: "tier",
    label: "Membership tier",
    required: true,
    options: [
      { label: "Basic", value: "basic", selected: true },
      { label: "Pro",   value: "pro" },
    ],
  },
]
```

- `min`/`max` semantics depend on `type`: numeric bounds for `number`; ISO date strings for `date`/`datetime-local`; **character length** for other string types; meaningless (`never`) for `radio`/`select`.
- `pattern` (regex) + `patternDescription` (required whenever `pattern` is set) do **client-side** validation only — **enforce every constraint server-side** in `POST`. `checkbox` values arrive back as a **string array** in the POST body `data`.

Full type reference, per-type behavior, and parameterized-href patterns → **`docs/typed-inputs-and-chaining.md`**; lookup table → **`resources/api-reference.md`**. Runnable typed-input Action (a `select` token + `number` amount) → **`examples/parameterized-action/route.ts`**.

## Chaining actions

Return `links.next` in any `ActionPostResponse` to render a **next action** after the transaction confirms — for multi-step flows, personalized success screens, and server-side verification.

```ts
const payload = await createPostResponse({
  fields: {
    type: "transaction",
    transaction,
    message: "Post memo on-chain",
    links: { next: { type: "post", href: "/api/actions/vote/next" } }, // SAME-ORIGIN
  },
});
```

- `next.type: "post"` → after confirmation the client POSTs `{ account, signature, state? }` (`NextActionPostRequest`) to the **same-origin** `href`; your callback returns the next `Action` or a terminal `CompletedAction` (`type: "completed"`, no further `links`).
- `next.type: "inline"` → embed the next `action` directly, no callback.
- **Same-origin is enforced**: a cross-origin `href` makes the client show an error and skip the callback. Absence of `links.next` ⇒ the client shows its own completed state.

**Security rule (load-bearing):** the next-action callback is a **public POST endpoint** — any client can hit it with **any** valid signature. Confirming the signature *status* is **not enough** (it's spoofable). You **must** `getParsedTransaction(signature)` and verify the transaction actually performed the expected action (ideally by matching an Action Identity memo/reference you embedded):

```ts
const status = await connection.getSignatureStatus(signature);
if (!["confirmed", "finalized"].includes(status.value?.confirmationStatus ?? "")) throw "unconfirmed";
// NOT ENOUGH — any confirmed signature would pass. Now verify the tx did the right thing:
const tx = await connection.getParsedTransaction(signature, "confirmed");
// ...assert the instructions/accounts/amounts match what YOU issued...
```

Full chaining walkthrough (two-route example, state round-trip via `state`/JWT, sign-message chains) → **`docs/typed-inputs-and-chaining.md`**. Runnable two-route example → **`examples/chained-action/route.ts`** + **`examples/chained-action/next-action-route.ts`**.

## Rendering Blinks & distribution

To render a Blink **in your own app**, use `@dialectlabs/blinks`. It **requires the classic wallet-adapter `WalletProvider` stack** — wrap the tree in `<WalletProvider>` + `<WalletModalProvider>` (see the **wallet-adapter** skill).

```tsx
"use client";
import "@dialectlabs/blinks/index.css";
import { Blink, useBlink, useBlinksRegistryInterval } from "@dialectlabs/blinks";
import { useBlinkSolanaWalletAdapter } from "@dialectlabs/blinks/hooks/solana";

export function BlinkCard({ actionUrl, rpcUrl }: { actionUrl: string; rpcUrl: string }) {
  useBlinksRegistryInterval();                              // loads + refreshes the security registry (~10 min)
  const { adapter } = useBlinkSolanaWalletAdapter(rpcUrl);  // wraps wallet-adapter connect/sign/confirm
  const { blink } = useBlink({ url: actionUrl });           // url = API URL, interstitial, or actions.json-mappable URL
  if (!blink) return null;
  return <Blink blink={blink} adapter={adapter} stylePreset="x-dark" securityLevel="only-trusted" />;
}
```

The Action→Blink rename (`useAction`→`useBlink`, `<Action>`→`<Blink>`, `useActionSolanaWalletAdapter`→`useBlinkSolanaWalletAdapter`) keeps legacy aliases, so old tutorials still compile. Full provider tree + `Miniblink`, `stylePreset`, and React Native → **`docs/blinks-client-and-registry.md`**; runnable component → **`examples/blink-client.tsx`**.

**Distribution reality — be honest about it:**

- **`solana-action:` URL scheme** — an Action URL prefixed `solana-action:` (conditionally URL-encoded absolute **HTTPS** URL). A decoded non-HTTPS URL is malformed.
- **`dial.to` interstitial** — `https://dial.to/?action=solana-action:<url>`. Renders + signs any Blink and shows its registry status. The reliable shareable-link surface.
- **Dialect Actions Registry** — register at **`dial.to/register`** (manual review). Entry state is `trusted` / `malicious` / `unknown`; only **`trusted`** Actions auto-render in wallet extensions. Client `securityLevel` (`only-trusted` / `non-malicious` / `all`) filters what renders — default to **`only-trusted`** in production.
- **X/Twitter** — **not native.** In-feed Blinks are injected by wallet browser extensions (Phantom's toggle is **off by default** and only renders registry-verified Actions) or the Dialect Blinks extension. **Never on mobile X.** Do not assume a link posted to X unfurls.

## Security

Treat the returned transaction as **UNTRUSTED**, and treat attacker-set metadata as a lie:

- **Displayed `title`/`description`/`message` are attacker-controlled** and must never be trusted as a description of what the transaction does. A malicious Action can show "Claim airdrop" while returning a tx that drains SOL, sets a token delegate, or reassigns an authority. The wallet — not the user's eyeballs — must validate: simulate the tx and surface asset/authority deltas.
- **The client signs only with the request `account`.** If the returned tx expects **any other signature**, the client must reject it as **malicious**. Never smuggle in an extra required signer.
- **Build the trusted transaction server-side** and keep secrets server-side (`SOLANA_RPC`, `ACTION_IDENTITY_SECRET`) — never in client bundles.
- **Action Identity (attribution):** pass `actionIdentity` (a `Keypair`) to `createPostResponse` to inject an SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) of the form `solana-action:<identity>:<reference>:<signature>`, provably linking on-chain activity to your Action. Verify later with `getSignaturesForAddress(identity)` + the reference.
- **Chained callbacks:** verify the actual transaction with `getParsedTransaction`, not just signature status (see Chaining).
- **`actions.json` external `apiPath`** can redirect a trusted domain to an attacker's API — lock down edit access.

Full threat model (untrusted-tx client rules, Action Identity memo verification, phishing patterns, sign-message anti-replay via `nonce`) → **`docs/security.md`**.

## Testing

- **Blinks Inspector** — `https://www.blinks.xyz/inspector`. The official debug tool: inspect GET/POST payloads, response headers, and exercise every input. Use it first when a Blink won't render.
- **curl the three methods** — verify `OPTIONS`, `GET`, and `POST` directly:

```bash
# OPTIONS preflight — must return CORS headers (Access-Control-Allow-Origin: *)
curl -i -X OPTIONS https://your.app/api/actions/donate

# GET metadata
curl -s https://your.app/api/actions/donate | jq

# POST — returns { type:"transaction", transaction:"<base64>", message }
curl -s -X POST https://your.app/api/actions/donate?amount=1 \
  -H 'Content-Type: application/json' \
  -d '{"account":"6JpNV6DK88auwzKVizdeT4Bw3D44sam5GqjcPCJ7y176"}' | jq
```

- **`dial.to`** renders any Blink regardless of registry state (with the status badge) — good for a real signing dry-run on devnet.

## Guidelines

**DO**
- Always export an **`OPTIONS`** handler returning the CORS headers — the #1 "Blink won't load" cause.
- Serve a root **`actions.json`** with `Access-Control-Allow-Origin: *`; use the idempotent `/api/actions/**` self-map.
- Pass `chainId` + `actionVersion` to `createActionHeaders()` so clients don't warn about missing metadata.
- Return a real web3.js v1 `Transaction`/`VersionedTransaction` to `createPostResponse`; let it base64-encode.
- Use absolute HTTPS `icon` URLs to **SVG / PNG / WebP** only.
- Set `type: "transaction"` on the POST response and each `LinkedAction` for `actions-spec@2.x` correctness.
- Validate & sanitize every user parameter and enforce `required` **server-side** — client `pattern`/`min`/`max` is advisory.
- Fetch a fresh `getLatestBlockhash` per POST; never cache built transactions.

**DON'T**
- Don't set `Access-Control-Allow-Origin: *` on non-Action routes (spec warns against it).
- Don't base58-encode the transaction — it must be **base64**.
- Don't expect a signature other than the request `account`; clients reject that as malicious.
- Don't trust attacker-set `title`/`description`/`message` as the tx's real effect.
- Don't confirm chained callbacks by signature status alone — `getParsedTransaction` and verify.
- Don't reach for `@solana/kit` here — the SDK is web3.js v1 only.
- Don't assume X unfurls Blinks natively — it's extension- and registry-gated, never mobile.

## Common Errors

### Error: Blink shows "Unable to load" / never renders
**Cause** Missing `OPTIONS` handler, missing/incorrect CORS headers, missing root `actions.json`, or an `icon` that isn't an absolute HTTPS SVG/PNG/WebP.
**Solution** Export `OPTIONS` returning `createActionHeaders(...)`; serve `actions.json` at the domain root with `Access-Control-Allow-Origin: *`; make `icon` absolute HTTPS. Confirm with the Blinks Inspector.

### Error: `CreatePostResponseError: at least 1 instruction is required`
**Cause** You passed an empty `Transaction` to `createPostResponse`.
**Solution** Add at least one instruction before calling `createPostResponse`.

### Error: `transaction requires at least 1 non-memo instruction`
**Cause** You used `actionIdentity` on a memo-only transaction; the identity keys need a non-memo instruction to attach to.
**Solution** Include a real (non-memo) instruction — e.g. a `ComputeBudgetProgram.setComputeUnitPrice` ix — alongside the memo.

### Error: Wallet rejects the transaction as malicious/malformed
**Cause** The returned tx expects a signature other than the request `account`, or a partially-signed tx whose existing signatures don't verify, or a non-absolute-HTTPS action URL.
**Solution** Only require the request `account` to sign; if you partially sign, ensure signatures are valid; use absolute HTTPS URLs.

### Error: "Blink compatibility metadata is not set. Please contact the blink provider."
**Cause** Your response omits `X-Action-Version` / `X-Blockchain-Ids` (bare `createActionHeaders()`).
**Solution** Pass `{ chainId, actionVersion }` to `createActionHeaders()`.

### Error: Chained next-action never fires (or shows an error)
**Cause** `links.next.href` is a different origin than the initial POST.
**Solution** Use a **same-origin** relative/absolute `href` for the `post` next-action.

### Error: Transaction won't decode / wallet errors on the payload
**Cause** You base58-encoded the transaction (Solana Pay confusion).
**Solution** The Actions POST `transaction` field is **base64**. Use `createPostResponse` (it base64-encodes for you).

## Files in This Skill

```
skills/blinks-actions/
  SKILL.md                                  # you are here — entry point
  docs/
    actions-spec.md                         # full spec: lifecycle, all types, headers, createPostResponse/createActionHeaders internals
    typed-inputs-and-chaining.md            # 10 param types, selectable options, parameterized hrefs, links.next chaining + verification
    blinks-client-and-registry.md           # @dialectlabs/blinks rendering, providers, Standard Blinks Library, registry, dial.to, distribution
    security.md                             # untrusted-tx model, client validation rules, Action Identity memo, phishing, sign-message anti-replay
    deployment.md                           # Next.js Route Handlers, CORS scoping, Node/Edge runtime, caching, RPC/identity env, actions.json hosting
    troubleshooting.md                      # exhaustive error catalog
  resources/
    api-reference.md                        # @solana/actions exports + signatures, actions-spec types, CORS constants, CAIP-2 IDs, param/operator tables, Dialect client surface
  examples/
    transfer-action/route.ts                # canonical GET+POST+OPTIONS SOL transfer (v0 VersionedTransaction)
    parameterized-action/route.ts           # typed inputs: a select (token) + number (amount) tip action
    actions.json                            # static root actions.json (hosting notes inline)
    chained-action/route.ts                 # step 1: build tx + links.next (same-origin post)
    chained-action/next-action-route.ts     # step 2: verify signature via getParsedTransaction → CompletedAction
    blink-client.tsx                        # client-side <Blink> rendering inside the wallet-adapter stack
  templates/
    action-route.ts                         # drop-in starter Action route handler
```

## References

- Actions spec (authoritative) — https://solana.com/docs/advanced/actions
- `solana-developers/solana-actions` (SDK + spec + examples) — https://github.com/solana-developers/solana-actions
- `@solana/actions` on npm — https://www.npmjs.com/package/@solana/actions
- `@solana/actions-spec` on npm — https://www.npmjs.com/package/@solana/actions-spec
- Dialect Blinks docs — https://docs.dialect.to/blinks
- `@dialectlabs/blinks` on npm — https://www.npmjs.com/package/@dialectlabs/blinks
- Blinks Inspector (debug) — https://www.blinks.xyz/inspector
- dial.to interstitial + registry — https://dial.to and https://dial.to/register
- Phantom Actions & Blinks — https://docs.phantom.com/developer-powertools/solana-actions-and-blinks
- CAIP-2 Solana namespace — https://namespaces.chainagnostic.org/solana/caip10
- Awesome Blinks (community ideas) — https://github.com/solana-developers/awesome-blinks
