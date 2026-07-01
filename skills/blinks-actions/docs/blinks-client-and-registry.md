# Rendering Blinks & the Dialect Registry

Deep dive behind SKILL.md → "Rendering Blinks & distribution". This is the **client / render side**:
how to embed a signable transaction card in your own React app with `@dialectlabs/blinks`, how the
Dialect **registry** and `securityLevel` gate what auto-renders, and the honest distribution reality
(the `solana-action:` scheme, the `dial.to` interstitial, X/wallet-extension gating, and the
Standard Blinks Library of hosted Action APIs).

For the **server / Action** side (building the API that a Blink renders) see `docs/actions-spec.md`
and `docs/deployment.md`. For the untrusted-transaction threat model that a renderer must respect,
see `docs/security.md`.

---

## The two roles, restated

- You already built (or are calling) an **Action API** — a spec-compliant HTTP endpoint that returns
  JSON metadata on `GET` and a base64 transaction on `POST`.
- A **Blink** is a *client* that fetches that Action URL and unfurls it into a title/icon/buttons/
  inputs the user can sign in place. `@dialectlabs/blinks` is the dominant Blink client for the web.

You never "publish a Blink" as an artifact. You publish an Action URL, and a Blink-capable surface
(your own `<Blink>`, `dial.to`, a wallet extension) renders it.

---

## Package layout (`@dialectlabs/blinks@0.22.5`)

| Package | Version | Role |
|---|---|---|
| `@dialectlabs/blinks` | **0.22.5** | React `<Blink>` / `Miniblink` renderer + layouts + the X DOM observer. |
| `@dialectlabs/blinks-core` | **0.20.7** | Framework-agnostic core: `useBlink`, registry, security, URL mapping, adapters. |
| `@dialectlabs/blinks-react-native` | 0.8.6 | React Native `<Blink>` renderer. |

Both `@dialectlabs/blinks` and `-core` last published **2025-04-04** — the client is stable/frozen,
matching the frozen state of `@solana/actions`. Peer deps of `@dialectlabs/blinks` (verified from
its `package.json`):

```jsonc
"peerDependencies": {
  "react": ">=18", "react-dom": ">=18",
  "@solana/web3.js": "^1.95.3",              // web3.js v1, matches the Actions stack
  "@solana/wallet-adapter-react": "^0.15.0", // REQUIRES the classic wallet-adapter stack
  "@solana/wallet-adapter-react-ui": "^0.9.0",
  "viem": "^2.x", "wagmi": "^2.x"            // EVM support (Blinks are no longer Solana-only)
}
```

Subpath exports you will use: `.` (React `<Blink>`/`Miniblink` + layouts), `./index.css` (the
**required** stylesheet), `./hooks/solana` (`useBlinkSolanaWalletAdapter`), `./hooks/evm`,
`./api`, and `./ext/twitter` (the X DOM observer, used by browser extensions).

Install (Solana):

```bash
npm i @dialectlabs/blinks @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/web3.js@^1
```

---

## The render pattern (React, Next.js App Router)

Rendering a Blink is three hooks plus one component:

```tsx
'use client';
import '@dialectlabs/blinks/index.css';                          // REQUIRED — no styles otherwise
import { Blink, useBlink, useBlinksRegistryInterval } from '@dialectlabs/blinks';
import { useBlinkSolanaWalletAdapter } from '@dialectlabs/blinks/hooks/solana';

export function BlinkCard({ actionUrl, rpcUrl }: { actionUrl: string; rpcUrl: string }) {
  useBlinksRegistryInterval();                             // load + refresh the security registry (~10 min)
  const { adapter } = useBlinkSolanaWalletAdapter(rpcUrl); // wraps wallet-adapter connect/sign/confirm
  const { blink } = useBlink({ url: actionUrl });          // fetch the Action metadata → BlinkInstance
  if (!blink) return null;
  return (
    <Blink
      blink={blink}
      adapter={adapter}
      stylePreset="x-dark"        // "default" | "x-dark" | "x-light" | "custom"
      securityLevel="only-trusted" // gate what renders — see the registry section
    />
  );
}
```

- **`useBlink({ url })`** fetches the Action's `GET` metadata and returns a `BlinkInstance` (the
  fetched, introspected Action). Its `url` accepts **any of three forms** (verbatim from the hook's
  `.d.ts`): *"a direct API url, an interstitial URL, or a URL that can be mapped to a blink api URL
  through actions.json on the host. Note: no need to pass the `solana-actions` prefix."* So you pass
  `https://your.app/api/actions/donate`, or `https://your.app/donate` (mapped via `actions.json`),
  or a `dial.to` interstitial — **not** a `solana-action:`-prefixed string.
- **`useBlinkSolanaWalletAdapter(rpcUrlOrConnection)`** builds the `adapter` the `<Blink>` uses to
  talk to the connected wallet. It implements `connect(ctx)`, `signTransaction(txBase64, ctx)`,
  `confirmTransaction(sig)`, and `signMessage(data, ctx)` on top of the classic wallet-adapter.
- **`useBlinksRegistryInterval()`** loads the Dialect security registry and refreshes it every ~10
  minutes, so `securityLevel` filtering has fresh trust states. Mount it once high in your tree.
- **`<Blink>`** (exported alias: `BlinkComponent`) renders the card. **`<Miniblink>`** is the compact
  variant for tight spaces (e.g. inline chips). `BlinkProps` include `blink`, `adapter`,
  `stylePreset`, `securityLevel`, and CSS-var overrides via `stylePreset="custom"`.

> **Do not skip `import '@dialectlabs/blinks/index.css'`.** Without it the `<Blink>` renders unstyled
> (raw, broken layout) — a common "it looks nothing like the screenshots" bug.

### Required provider tree (classic wallet-adapter)

`@dialectlabs/blinks` **requires the classic `@solana/wallet-adapter` stack** above it in the tree.
`useBlinkSolanaWalletAdapter` reads the connected wallet from wallet-adapter's context, so the
provider tree must wrap your `<BlinkCard>`. This is the direct tie-in to the **wallet-adapter** skill
(`skills/wallet-adapter/SKILL.md`) — see it for the full provider setup, SSR caveats, and
feature-detection.

```tsx
// app/providers.tsx
'use client';
import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css'; // wallet-adapter's own stylesheet (separate from blinks)

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl('mainnet-beta'), []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* wallets={[]} → Wallet-Standard wallets (Phantom, Solflare, Backpack…) auto-register */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

Then wrap your app (`app/layout.tsx`) in `<Providers>`. The runnable end-to-end component lives at
`examples/blink-client.tsx`.

> **Two stylesheets, both required:** `@dialectlabs/blinks/index.css` (the Blink card) **and**
> `@solana/wallet-adapter-react-ui/styles.css` (the wallet modal/button). They are independent.

> **Next.js SSR:** the wallet button (`WalletMultiButton`) must be dynamically imported with
> `{ ssr: false }`; the provider tree needs `'use client'`. See the wallet-adapter skill.

### The Action → Blink rename (legacy aliases)

Dialect renamed the primary API from `Action*` to `Blink*`. **The old names are still exported as
backwards-compat aliases**, so tutorials written against the old API still compile:

| Current (use this) | Legacy alias (still exported) |
|---|---|
| `useBlink` | `useAction` |
| `<Blink>` / `BlinkComponent` | `<Action>` |
| `useBlinkSolanaWalletAdapter` | `useActionSolanaWalletAdapter` |
| `useBlinksRegistryInterval` | `useActionsRegistryInterval` |
| `BlinkInstance` | `Action` (the class, not the JSX component) |
| `BlinksRegistry` / `BlinksURLMapper` | `ActionsRegistry` / `ActionsURLMapper` |
| `fetchBlinksRegistryConfig` | `fetchActionsRegistryConfig` |
| `BlinkSolanaConfig` | `ActionConfig` |

If you inherit code using `useAction`/`<Action>`, it works as-is; migrate names opportunistically.
Note `Action` here is the *Dialect client class* (`= BlinkInstance`) — unrelated to the
`@solana/actions-spec` `Action` type on the server side.

### React Native

The hook comes from core; the renderer comes from the native package:

```tsx
import { useBlink, type BlinkAdapter } from '@dialectlabs/blinks';   // hook (re-exported from core)
import { Blink } from '@dialectlabs/blinks-react-native';            // native renderer
// <Blink theme={...} blink={blink} adapter={adapter} websiteUrl={...} websiteText={...} />
```

For non-wallet-adapter apps (React Native, custom wallets), implement the `BlinkAdapter` interface
directly instead of using `useBlinkSolanaWalletAdapter`.

---

## The Blinks registry & the security model

Actions are a **permissionless** spec — anyone can host one — so Blink clients gate what they will
auto-unfurl using the **Dialect registry** (an allowlist maintained as a public good with the Solana
Foundation). This is the primary anti-phishing layer at the *distribution* level; the
*transaction-level* defenses are in `docs/security.md`.

### Trust states vs. client security levels

Two distinct enums — do not conflate them:

**Registry entry state** (`SecurityBlinkState`) — the *server-side* trust label for a URL:

| State | Meaning |
|---|---|
| `trusted` | Registered by the developer and accepted by the Dialect registration committee. |
| `malicious` | Flagged as malicious by the registration community. |
| `unknown` | Unregistered — not in the registry (neither approved nor flagged). |

**Client `securityLevel`** (`SecurityLevel`) — *your* render policy, passed to `<Blink>` or
`setupTwitterObserver`:

| `securityLevel` | Renders when state is… | Use |
|---|---|---|
| `only-trusted` | `trusted` only | **Production default** — strictest. |
| `non-malicious` | `trusted` or `unknown` (blocks known-bad) | Permissive but blocks flagged blinks. |
| `all` | anything, including `unknown` | **Dev/testing only** — renders your unregistered blink. |

`securityLevel` may also be set **per source** with an object
(`{ websites, interstitials, actions, blinks }`) when different origins warrant different trust.

When multiple sources contribute a state to one blink (e.g. the blink URL and the underlying action
URL), the client **merges pessimistically: `malicious` > `unknown` > `trusted`** — the worst state
wins. A `trusted` action reached through a `malicious` interstitial resolves to `malicious`.

```tsx
// Production: only registry-verified actions render.
<Blink blink={blink} adapter={adapter} securityLevel="only-trusted" />

// Local dev: your action isn't registered yet, so relax the gate to see it render.
<Blink blink={blink} adapter={adapter} securityLevel="all" />
```

> **The #1 "my Blink is blank in production" cause:** your action is `unknown` (unregistered) but the
> client is at `only-trusted`. It renders in dev with `securityLevel="all"` and vanishes in prod.
> Fix: register at `dial.to/register`, or ship at `non-malicious` if you accept the weaker gate.

### Registry & infrastructure endpoints (verified from the `blinks-core` bundle)

| Purpose | Endpoint |
|---|---|
| Registry list (current) | `https://registry.dial.to/v1/list` → `{ actionUrl, blinkUrl, websiteUrl, createdAt, tags }[]` |
| Registry list (legacy / all-states) | `https://actions-registry.dial.to/all` |
| Blink data / preview APIs | `https://api.dial.to/v1/blink`, `/v1/blink-preview`, `/v1/blink-data-table` |
| Image/metadata **proxy** | `https://proxy.dial.to` (via `proxify` / `setProxyUrl`) |

The **proxy** (`https://proxy.dial.to`) routes third-party image/metadata fetches through Dialect so
a viewer's IP is not exposed to arbitrary action hosts. Override it with `setProxyUrl(url)` from
`@dialectlabs/blinks-core` if you self-host a proxy.

The client-key header the SDK sets is **`x-blink-client`** (constant `BLINK_CLIENT_KEY_HEADER`, set
via `setClientKey(key)`). See the Standard Blinks Library section for the `X-Blink-Client-Key` casing
caveat.

### Registering your Action

- Apply at **`https://dial.to/register`** (Dialect docs also list emailing `hello@dialect.to`).
- **Review is manual** — Dialect vets functional correctness, clear descriptions, and security
  hygiene before promoting an entry to `trusted`. There is no public self-serve registration API.
- **Registration is required for real-world in-feed distribution:** wallet extensions and X-via-
  extension only auto-unfurl `trusted` actions. Until you register, a shared link renders as plain
  text everywhere except `dial.to` and your own `securityLevel="all"`/`non-malicious"` surfaces.

---

## Distribution: where a Blink actually renders

Be honest with users about reach. Ranked from most to least reliable:

### 1. Your own app (`<Blink>`) — most reliable

Embedding `<Blink>` in a page you control is the surface with zero gating: you set `securityLevel`,
you control the wallet stack, and no third party has to enable a toggle. This is the recommended
primary distribution channel.

### 2. The `dial.to` interstitial — the shareable link

`dial.to` is Dialect's hosted, forkable interstitial ("Stripe checkout, but for any onchain
action"). It renders and signs **any** blink regardless of registry state (showing the status badge),
so it is the reliable shareable-URL surface.

```
https://dial.to/?action=solana-action:https://your.app/api/actions/donate
```

- The query param name is **`action`** (`BLINKS_QUERY_PARAM = "action"`).
- Its value is a **`solana-action:`-prefixed** absolute **HTTPS** Action URL. `solana-action:` is the
  spec protocol identifier (`SOLANA_ACTIONS_PROTOCOL`); the legacy Solana Pay `solana:` is also
  recognized. A decoded value that is **not** an absolute HTTPS URL is **malformed** and rejected.
- URL-encode the inner URL if it carries its own query params:
  `https://dial.to/?action=solana-action%3Ahttps%3A%2F%2Fyour.app%2Fapi%2Factions%2Fdonate%3Famount%3D1`.

Any site can be an interstitial (`https://<host>/?action=<action_url>`); `dial.to` is just the hosted
default.

### 3. Wallet browser extensions & X — gated, never mobile

X/Twitter **never natively unfurled Blinks and still doesn't.** In-feed rendering is performed by
**wallet browser extensions** injecting a card into the X DOM — not by X:

| Client | In-feed X Blinks | Notes |
|---|---|---|
| **Phantom** (extension) | Opt-in, **off by default** | Settings → Experimental Features → **Blinks**. Renders **only registry-`trusted`** actions. Mobile: never in-feed. |
| **Backpack** | Yes | Dialect Blinks integrated in-app + extension. |
| **Solflare**, **OKX** | Yes | Supported by the Dialect Blinks extension. |
| **Dialect Blinks** (standalone extension) | Yes | Detects Action URLs on X and unfurls; works with Phantom/Backpack/Solflare. |
| **X native** / **mobile X** | **No** | No server-side unfurl; mobile never renders Blinks. |

The mechanism is the X DOM observer — an extension content script scans the timeline, checks the
registry, and injects `<Blink>` cards:

```ts
import { setupTwitterObserver } from '@dialectlabs/blinks/ext/twitter';

setupTwitterObserver(adapter, /* callbacks? */ undefined, {
  securityLevel: 'only-trusted', // or 'non-malicious' | 'all' | per-source object
  // supportStrategy,
});
```

You normally don't call `setupTwitterObserver` yourself — it's how extensions work internally — but
knowing it exists explains *why* "post a Blink to X and it just works" is a myth: it depends entirely
on the *viewer* having a Blink-capable extension enabled and your action being `trusted`.

**Takeaway:** treat X/extension unfurling as a bonus, not a plan. Lead with `<Blink>` in your app and
`dial.to` links; register at `dial.to/register` to unlock the extension surface.

---

## The Standard Blinks Library — don't build what's hosted

If you need swaps/lends/stakes on an established protocol, **do not build and maintain your own
Action server** — Dialect hosts production, spec-compliant Action APIs for the major protocols under
`*.dial.to`. This is the **Standard Blinks Library (SBL)**.

- **Base URL pattern:** `https://<protocol>.dial.to/api/v0/...`
- **Protocols (per Dialect docs):** Jupiter, Kamino, Raydium, Orca, Meteora, Drift, DeFiTuna,
  DeFiCarrot, MarginFi, Lulo, Save, plus native Solana token transfers. New protocols added
  regularly.
- **Auth:** an `X-Blink-Client-Key` header (token from the Dialect dashboard). Responses conform to
  the Actions spec, so they drop straight into `<Blink>` or `dial.to`.

```bash
# GET metadata (Kamino deposit)
curl 'https://kamino.dial.to/api/v0/lend/HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E/deposit' \
  -H 'X-Blink-Client-Key: YOUR_SECRET_TOKEN'

# POST → returns a base64 transaction, exactly like your own Action POST
curl -X POST 'https://kamino.dial.to/api/v0/lend/HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E/deposit?amount=1' \
  -H 'Content-Type: application/json' \
  -H 'X-Blink-Client-Key: YOUR_SECRET_TOKEN' \
  -d '{ "type": "transaction", "account": "6JpNV6DK88auwzKVizdeT4Bw3D44sam5GqjcPCJ7y176" }'
```

Because SBL responses are spec-compliant, you render them the same way — pass the SBL URL to
`useBlink({ url })`:

```tsx
const { blink } = useBlink({ url: 'https://jupiter.dial.to/swap/SOL-Bonk' });
```

> **Header casing caveat:** SBL docs show `X-Blink-Client-Key`; the SDK constant
> (`BLINK_CLIENT_KEY_HEADER`) is `x-blink-client`. **HTTP header names are case-insensitive**, so
> `X-Blink-Client-Key` and `x-blink-client` are the same header — send either. If a specific SBL
> endpoint rejects one spelling, try the other; the underlying token is identical.

**When to use SBL vs. your own Action API:**

| Situation | Use |
|---|---|
| Swap/lend/stake on Jupiter, Kamino, Raydium, Orca, Meteora, Drift, MarginFi… | **SBL** (`<protocol>.dial.to`) |
| Your own program / custom transaction logic | **Your own Action API** (`@solana/actions`, see `docs/actions-spec.md`) |
| A protocol not in the SBL list | Your own Action API |

---

## Cross-references

- **Server side (building the Action a Blink renders):** `docs/actions-spec.md`, `docs/deployment.md`.
- **Untrusted-transaction threat model (what a renderer must respect):** `docs/security.md`.
- **Wallet provider setup, SSR, feature detection:** the **wallet-adapter** skill
  (`skills/wallet-adapter/SKILL.md`).
- **Runnable client component:** `examples/blink-client.tsx`.
- **Client-side render/registry problems:** `docs/troubleshooting.md`.

## References

- Dialect Blinks docs — https://docs.dialect.to/blinks
- Blinks client UI components — https://docs.dialect.to/blinks/blinks-client/integrate/ui-components/blinks
- Blinks Public Registry — https://docs.dialect.to/blinks/blinks-provider/blink-registry
- Standard Blinks Library — https://docs.dialect.to/standard-blinks-library
- `@dialectlabs/blinks` on npm — https://www.npmjs.com/package/@dialectlabs/blinks
- dial.to interstitial + registry — https://dial.to and https://dial.to/register
- Phantom Actions & Blinks (extension toggle) — https://docs.phantom.com/developer-powertools/solana-actions-and-blinks
- Blinks Inspector (debug) — https://www.blinks.xyz/inspector
