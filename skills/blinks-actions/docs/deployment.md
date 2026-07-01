# Deploying an Actions Provider

Deep dive behind SKILL.md → "Building an Action (server)" and "Headers, CORS & CAIP-2". This is the
**hosting / operations** side: how to structure a Next.js App Router Actions API, scope CORS
correctly, choose a runtime, keep secrets server-side, avoid the caching trap that kills
transactions, and host `actions.json` at the apex domain even when your API lives on a subdomain. It
closes with the non-Next.js (Express / Hono) middleware forms.

The spec/type internals are in `docs/actions-spec.md`; the threat model is `docs/security.md`. This
doc is purely about **shipping** an Action API. All facts are accurate to `@solana/actions@1.6.6`
(web3.js v1; no `@solana/kit` port).

---

## 1. Project layout (Next.js App Router)

One `route.ts` per action, under `app/api/actions/<name>/`. Every route exports **`GET` + `POST` +
`OPTIONS`**. The `actions.json` mapping lives at the **apex root** (`app/actions.json/route.ts` or a
static `public/actions.json`).

```
app/
  actions.json/
    route.ts                     # apex actions.json (maps site URLs → Action API paths)
  api/
    actions/
      transfer/
        route.ts                 # GET + POST + OPTIONS
      donate/
        route.ts
      chaining-basics/
        route.ts                 # step 1
        next-action/
          route.ts               # step 2 (same-origin callback)
```

- **`OPTIONS` is mandatory on every Action route** (and on `actions.json`). Blink clients send a CORS
  preflight before the `GET`; a missing `OPTIONS` route is the single most common "Blink won't load"
  cause. Reuse the same headers object across all three exports:

```ts
import { createActionHeaders } from "@solana/actions";

const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

export const GET = async (req: Request) => Response.json(/* metadata */, { headers });
export const POST = async (req: Request) => Response.json(/* tx payload */, { headers });
export const OPTIONS = async () => new Response(null, { headers }); // MANDATORY
```

Full route handlers: `examples/transfer-action/route.ts` (SOL transfer),
`examples/parameterized-action/route.ts` (typed inputs), `examples/chained-action/route.ts` +
`examples/chained-action/next-action-route.ts` (chaining). Starter boilerplate:
`templates/action-route.ts`.

---

## 2. CORS — and scoping `Access-Control-Allow-Origin: *`

`createActionHeaders()` returns `ACTIONS_CORS_HEADERS` (see `resources/api-reference.md` for the exact
constant) plus, when you pass `chainId` / `actionVersion`, the `X-Blockchain-Ids` / `X-Action-Version`
negotiation headers. Attach it to `GET`, `POST`, and `OPTIONS`.

```ts
// Recommended — advertises chain + spec version so the Dialect client doesn't warn
// "Blink compatibility metadata is not set."
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });
```

> **Scope `Access-Control-Allow-Origin: *` to the Action routes + `/actions.json` ONLY.** The SDK
> explicitly warns against setting it globally. `*` on every route turns your whole site into an
> open-CORS surface; keep it on the paths that actually serve Actions.

In Next.js, applying `createActionHeaders()` only inside your `app/api/actions/**` and
`app/actions.json` route handlers already scopes it correctly — do **not** add a wildcard
`Access-Control-Allow-Origin: *` in `next.config.js` `headers()` (that would apply site-wide). If a
CDN/edge/proxy in front of the app rewrites or strips headers, verify the CORS set survives to the
client with `curl -i -X OPTIONS https://your.app/api/actions/<name>` — you must see
`Access-Control-Allow-Origin: *`.

---

## 3. Runtime: Node.js (default) vs Edge

Next.js route handlers run on the **Node.js runtime by default**. You can opt a route into the Edge
runtime with a route-segment export:

```ts
export const runtime = "nodejs"; // default — full Buffer / crypto / RPC compatibility (recommended)
// export const runtime = "edge"; // lower cold-start latency, but see the caveat below
```

- **Node.js runtime (recommended default).** `@solana/actions` and `@solana/web3.js` v1 run
  unmodified; `Buffer`, `getLatestBlockhash`, and `getParsedTransaction` all work. Start here.
- **Edge runtime (optional).** Edge functions have lower cold-start latency and run closer to the
  user, which suits the latency-sensitive GET/POST of a Blink. `@solana/actions` is pure JS
  (`@solana/web3.js` v1 + `tweetnacl` + `bs58` + `js-base64` + `cross-fetch`), and most Action
  handlers work on Edge. **Caveat (verify before shipping):** web3.js v1 and the memo/identity paths
  use `Buffer`, and some hosts' Edge sandboxes restrict Node built-ins. This has not been verified
  green across every host/dependency combination — if you hit a `Buffer is not defined` or
  `Module not found: fs/crypto` error on Edge, pin the route back to Node with
  `export const runtime = "nodejs"`. Test the full GET → POST → (chained) callback flow on Edge
  before relying on it.

Whichever runtime you choose, the CORS and caching rules below are identical.

---

## 4. Caching — never cache the POST response

The spec says the client *"should not cache the response except as instructed by HTTP caching
response headers,"* so caching is **provider-controlled** via `Cache-Control`. The critical rule:

> **Never cache POST (transaction-building) responses.** Every built transaction embeds a
> `recentBlockhash` that **expires in ~60–90 seconds**. A cached transaction is dead on arrival —
> the user gets `Blockhash not found` / "Transaction expired" when they sign. Fetch a fresh
> `getLatestBlockhash()` inside **every** `POST`.

```ts
export const POST = async (req: Request) => {
  // ... validate account ...
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(); // fresh per POST
  const transaction = new Transaction({ feePayer: account, blockhash, lastValidBlockHeight }).add(ix);
  // ... createPostResponse ...
};
```

To be explicit, mark POST responses uncacheable:

```ts
const headers = {
  ...createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" }),
  "Cache-Control": "no-store",
};
```

GET **metadata** (icon / title / description) is safe to cache and benefits from it — set a
`Cache-Control: public, max-age=...` on the GET response if the metadata is static. Only the POST
tx-build path must stay fresh.

Also disable Next.js's own route caching if you rely on request data: read `req.url` /
`req.json()` (dynamic by default) or set `export const dynamic = "force-dynamic"` on tx routes so
they are never statically optimized.

---

## 5. Environment & secrets (server-only)

Route handlers run on the server, so keep every secret out of the client bundle:

| Env var | Purpose | Notes |
|---|---|---|
| `SOLANA_RPC` | Your RPC endpoint | `clusterApiUrl("devnet")` is rate-limited and devnet-only. Use a paid mainnet RPC (Helius / QuickNode / Triton) in production. |
| `ACTION_IDENTITY_SECRET` | Action Identity keypair (JSON secret key) | `createPostResponse` / `getActionIdentityFromEnv()` read it automatically to inject the attribution memo. See `docs/security.md`. |

```ts
const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("devnet"));
```

- **Never** expose these as `NEXT_PUBLIC_*` and never read them in a client component — a
  `NEXT_PUBLIC_` prefix ships the value to the browser. The RPC key and identity keypair belong only
  in server-side env vars (Vercel/host project settings, `.env.local` locally, git-ignored).
- The client-side RPC used by `@dialectlabs/blinks` (`NEXT_PUBLIC_SOLANA_RPC`) is a **separate**,
  public read endpoint — do not reuse a privileged key there. See
  `docs/blinks-client-and-registry.md`.

---

## 6. Hosting `actions.json` (apex domain + cross-host `apiPath`)

`actions.json` maps a plain, human-shareable website URL (`example.com/donate`) to the Action API
endpoint that serves it, so a shared link is discoverable without a `solana-action:` prefix.

- **It MUST live at the apex/root domain:** `https://example.com/actions.json` — never on a subpath.
- **It MUST return `Access-Control-Allow-Origin: *`** on both `GET` and `OPTIONS`.
- **The API can be on a different host.** If your website is `alice.com` but your Actions API is on
  `api.alice.com`, `actions.json` still lives at `alice.com/actions.json`, and its `apiPath` points
  cross-host at the subdomain:

```json
{
  "rules": [
    { "pathPattern": "/donate",    "apiPath": "https://api.alice.com/api/actions/transfer" },
    { "pathPattern": "/trade/*",   "apiPath": "https://api.alice.com/api/actions/trade/*" },
    { "pathPattern": "/api/actions/**", "apiPath": "/api/actions/**" }
  ]
}
```

`apiPath` may be an **external/cross-host URL** — which is exactly why it is a security surface: a
maliciously-edited `actions.json` can redirect a trusted-looking domain to an attacker's Action API.
Lock down who can edit the apex `actions.json` and verify domain ownership (see `docs/security.md`).

### Route-handler form (bundles CORS via `createActionHeaders`)

The route-handler form is the cleanest in Next.js because `createActionHeaders()` attaches the CORS
set for you:

```ts
// app/actions.json/route.ts
import { type ActionsJson, createActionHeaders } from "@solana/actions";

const headers = createActionHeaders(); // CORS only — no chain/version needed on actions.json

export const GET = async () => {
  const payload: ActionsJson = {
    rules: [
      { pathPattern: "/donate", apiPath: "/api/actions/transfer" }, // pretty link → Action API
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }, // idempotent self-map
    ],
  };
  return Response.json(payload, { headers });
};

// MANDATORY — actions.json is preflighted too.
export const OPTIONS = async () => new Response(null, { headers });
```

### Static form

Alternatively drop a static file at `public/actions.json` (see `examples/actions.json`) — but then
you must configure the `Access-Control-Allow-Origin: *` header separately (e.g. in `next.config.js`
`headers()` **scoped to `/actions.json`**, or at your CDN). The route-handler form avoids that extra
step.

Field reminder: the keys are **`pathPattern`** + **`apiPath`** (there is no `apiPathPattern`); `*` =
one path segment, `**` = zero-or-more segments (must be **last** if combined), `?` unsupported; query
params from the original URL are always preserved. Full operator table: `resources/api-reference.md`.

---

## 7. Non-Next.js: Express / Hono / Fastify

The SDK ships two CORS helpers for server frameworks that use middleware instead of a per-response
`HeadersInit`:

- **`actionCorsMiddleware(args)`** — Express/Connect style. Internally it does
  `res.set(createActionHeaders(args)); next();`, so it sets the full CORS set **plus** the
  `X-Action-Version` / `X-Blockchain-Ids` values on every response, then calls `next()`. Because it
  only *sets* headers (it does not terminate the request), answer the `OPTIONS` preflight explicitly.
- **`ACTIONS_CORS_HEADERS_MIDDLEWARE`** — a plain policy object
  (`{ origin, methods, allowedHeaders, exposedHeaders }`) whose shape matches the **`cors` npm
  package** options. Feed it into a `cors()` plugin that handles preflight for you. Note it only
  *exposes* the negotiation headers — it does not set their *values*, so still emit
  `X-Action-Version` / `X-Blockchain-Ids` on your actual responses.

### Express with `actionCorsMiddleware` (sets header values, explicit preflight)

```ts
import express from "express";
import { actionCorsMiddleware } from "@solana/actions";

const app = express();
app.use(express.json());

// Sets ACTIONS_CORS_HEADERS + X-Action-Version + X-Blockchain-Ids on every response
// under these paths. Scope it to the Action routes + actions.json ONLY.
const actionsCors = actionCorsMiddleware({ chainId: "mainnet", actionVersion: "2.4" });
app.use(["/api/actions", "/actions.json"], actionsCors);

// actionCorsMiddleware only SETS headers (it calls next()), so answer preflight explicitly:
app.options(["/api/actions/*", "/actions.json"], actionsCors, (_req, res) => res.sendStatus(200));
```

### Express with the `cors` package + `ACTIONS_CORS_HEADERS_MIDDLEWARE` (auto preflight)

```ts
import cors from "cors";
import { ACTIONS_CORS_HEADERS_MIDDLEWARE, createActionHeaders } from "@solana/actions";

// The `cors` package answers the OPTIONS preflight for you; scope it to Action paths.
app.use(["/api/actions", "/actions.json"], cors(ACTIONS_CORS_HEADERS_MIDDLEWARE));

// ACTIONS_CORS_HEADERS_MIDDLEWARE only EXPOSES the negotiation headers — set their VALUES per response:
const { "X-Action-Version": actionVersion, "X-Blockchain-Ids": blockchainIds } =
  createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });
app.use(["/api/actions", "/actions.json"], (_req, res, next) => {
  res.set({ "X-Action-Version": actionVersion, "X-Blockchain-Ids": blockchainIds });
  next();
});
```

### Hono / Fastify-native cors

Hono's `cors()` uses different option names (`allowMethods` / `allowHeaders` / `exposeHeaders`) than
the `cors`-package shape of `ACTIONS_CORS_HEADERS_MIDDLEWARE` (`methods` / `allowedHeaders` /
`exposedHeaders`). Translate the field names when wiring it up, or set the raw `ACTIONS_CORS_HEADERS`
object directly on responses. The header **values** are identical either way; only the plugin's
option keys differ. (The `@solana/actions` repo ships reference `examples/express`, `examples/axum`,
and `examples/cloudflare-workers` deployments alongside `examples/next-js`.)

---

## 8. Deploy checklist

- [ ] Every Action route exports `GET`, `POST`, **and `OPTIONS`** with a shared `createActionHeaders`
      object.
- [ ] `createActionHeaders({ chainId, actionVersion })` (not bare) so clients don't warn about missing
      compatibility metadata.
- [ ] `Access-Control-Allow-Origin: *` scoped to `/api/actions/**` + `/actions.json` only — never
      site-wide.
- [ ] `actions.json` reachable at the **apex root** with CORS; `apiPath` points at the right (possibly
      cross-host) API; edit access locked down.
- [ ] **No caching of POST responses**; fresh `getLatestBlockhash()` per POST; `dynamic = "force-dynamic"`
      (or dynamic request reads) on tx routes.
- [ ] `SOLANA_RPC` = a paid mainnet RPC (not `clusterApiUrl`); `ACTION_IDENTITY_SECRET` server-only;
      no secret behind `NEXT_PUBLIC_`.
- [ ] Runtime chosen deliberately (Node default; Edge only after testing the full flow).
- [ ] Verified live: `curl -i -X OPTIONS`, `curl -s GET | jq`, `curl -s -X POST … | jq`, then the
      Blinks Inspector (`https://www.blinks.xyz/inspector`).

## Cross-references

- **Spec types, `createPostResponse` / `createActionHeaders` internals:** `docs/actions-spec.md`,
  `resources/api-reference.md`.
- **Threat model (untrusted tx, secrets, `actions.json` redirect risk):** `docs/security.md`.
- **Client rendering + the separate public RPC:** `docs/blinks-client-and-registry.md`.
- **Error catalog (CORS, caching, blockhash):** `docs/troubleshooting.md`.
- **Runnable route handlers:** `examples/transfer-action/route.ts`,
  `examples/parameterized-action/route.ts`, `examples/chained-action/*`; static `actions.json` →
  `examples/actions.json`; boilerplate → `templates/action-route.ts`.

## References

- Actions spec (OPTIONS/CORS, caching, actions.json) — https://solana.com/docs/advanced/actions
- `solana-developers/solana-actions` (SDK + `examples/next-js`, `express`, `axum`, `cloudflare-workers`) — https://github.com/solana-developers/solana-actions
- `@solana/actions` on npm — https://www.npmjs.com/package/@solana/actions
- Next.js Route Handlers — https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- Next.js runtimes (Node.js / Edge) — https://nextjs.org/docs/app/building-your-application/rendering/edge-and-nodejs-runtimes
- CAIP-2 Solana namespace — https://namespaces.chainagnostic.org/solana/caip10
