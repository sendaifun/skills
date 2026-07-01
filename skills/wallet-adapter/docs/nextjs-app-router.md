# Next.js App Router Integration (Classic Wallet Adapter)

The long form of SKILL.md's "Next.js App Router" section. It shows the complete file
layout (`app/providers.tsx`, `app/layout.tsx`, a dynamic button module, and a page that
uses them), and explains *why* each Server-Side-Rendering (SSR) workaround is required —
not just what to type. If you copy the wrong thing here you get a `window is not defined`
crash at build time or a React hydration-mismatch warning at runtime.

This doc covers the **classic `@solana/wallet-adapter`** stack (web3.js v1). For the modern
Wallet Standard + Kit stack (`@solana/react-hooks`, `@wallet-ui/react`) and its own
`isReady` SSR gating, see [modern-stack.md](modern-stack.md).

## Why the App Router is different

In the Next.js App Router, every component is a **React Server Component (RSC) by default**.
Server Components render on the server (and at build time for static routes) where there is
**no `window`, no `localStorage`, and no wallet extension**. Wallet Adapter is a purely
client-side signing layer: `WalletProvider` subscribes to the browser's Wallet Standard
registry, persists the selected wallet to `localStorage`, and reads the DOM. None of that can
run on the server. The whole job of App Router integration is drawing a clean **client
boundary** (`'use client'`) around the wallet tree and keeping the one component whose output
depends on `localStorage` — `WalletMultiButton` — off the server entirely.

## The three hydration pitfalls (and the *why*)

### 1. Providers touch `window` / `localStorage` → the provider file needs `'use client'`

`WalletProvider` reads and writes `localStorage['walletName']` to remember the last wallet, and
`ConnectionProvider` / the Wallet Standard registry reach for `window`. A Server Component that
imports them throws (see pitfall 3) or, at minimum, produces server HTML that can never match
the client. **Fix:** put the provider component in its own file with `'use client'` at the top.
That file (and everything it renders) is bundled for the client; the Server Component
`layout.tsx` can still import and render it, because a Server Component is allowed to render a
Client Component — it just can't call client-only hooks itself.

> A 2026-04 wallet-adapter fix (`Fix localStorage ReferenceError in Node`, PR #1151) guards a
> bare `localStorage` reference so importing the package in a Node context no longer *crashes*,
> but the providers are still **client-only** — the `'use client'` boundary remains mandatory.

### 2. `WalletMultiButton`'s label comes from `localStorage['walletName']` → hydration mismatch

`WalletMultiButton` derives its label through `useWalletMultiButton`, whose text depends on
whether a wallet name is stored in `localStorage`:

- **On the server** there is no `localStorage`, so the button renders its disconnected label
  ("Select Wallet").
- **On the client**, immediately after mount, `localStorage['walletName']` may already hold a
  previously-selected wallet, so the button renders "Connect" or the truncated address instead.

React compares the server HTML to the first client render. They differ → you get the dreaded
`Hydration failed because the server rendered HTML didn't match the client` warning, React
throws away the server markup for that subtree and re-renders it, and the user sees a flash.
**Fix:** render the button **client-only** with `next/dynamic` and `{ ssr: false }` so it never
renders on the server — there is no server HTML to mismatch.

### 3. `window is not defined` during SSR / prerender

If *any* wallet-adapter code executes on the server — for example, you imported
`WalletMultiButton` directly into a Server Component, or referenced `window`/`localStorage` at a
module's top level — the server render throws `ReferenceError: window is not defined` and the
route (or the whole `next build`) fails. **Fix:** keep the entire wallet subtree behind the
`'use client'` boundary from pitfall 1, keep the button behind `ssr: false` from pitfall 2, and
never read `window`/`localStorage` at module scope (do it inside a `useEffect` or an event
handler, which only run on the client).

## Complete setup

Four files. This deepens (and stays consistent with) the provider snippet in SKILL.md and the
drop-in [templates/WalletProviders.tsx](../templates/WalletProviders.tsx) /
[templates/WalletButtonDynamic.tsx](../templates/WalletButtonDynamic.tsx).

### `app/providers.tsx` — the client boundary

```tsx
'use client';

import { ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Wallet Adapter's default modal/button styles. Import exactly once — here or in the
// root layout. The path is literal (see "The CSS import" below).
import '@solana/wallet-adapter-react-ui/styles.css';

export function SolanaProviders({ children }: { children: ReactNode }) {
  const network = WalletAdapterNetwork.Devnet; // 'devnet' | 'testnet' | 'mainnet-beta'
  // useMemo so a public RPC endpoint object identity is stable across re-renders; a new
  // endpoint string would tear down and recreate the underlying Connection.
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  // Empty array is correct: WalletProvider calls useStandardWalletAdapters() internally,
  // so every Wallet Standard wallet (Phantom, Solflare, Backpack, Coinbase, …) is
  // auto-registered, and Mobile Wallet Adapter is auto-injected on mobile web. Only add
  // adapters here for wallets that do NOT implement the Wallet Standard, or dev-only ones.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

Provider **order is fixed**: `ConnectionProvider` → `WalletProvider` → `WalletModalProvider`
(the modal needs both a connection and the wallet context). Everything that calls `useWallet()`
/ `useConnection()` must be a descendant. The rationale for the order and `wallets={[]}` lives in
SKILL.md's "Provider setup"; this doc only adds the App Router framing.

Production tip: drive the endpoint from an env var so you can point at a paid RPC in prod
without a code change — `process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl(network)`. The
`NEXT_PUBLIC_` prefix is required for the value to reach the browser bundle. See
[templates/WalletProviders.tsx](../templates/WalletProviders.tsx).

### `app/layout.tsx` — a Server Component wraps the client provider

```tsx
// No 'use client' here — this stays a Server Component.
import { SolanaProviders } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SolanaProviders>{children}</SolanaProviders>
      </body>
    </html>
  );
}
```

The layout renders the Client Component but never calls a client hook itself, so it stays a
Server Component — you keep RSC streaming/SEO for the rest of the tree while the wallet logic
is quarantined on the client.

### `app/wallet-button.tsx` — the dynamically imported button

```tsx
'use client';

import dynamic from 'next/dynamic';

// Import the NAMED export and disable SSR. `dynamic` expects a module or a promise that
// resolves to a component, so we await the package and hand back the named component.
export const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  {
    ssr: false,
    // Optional: reserve space so the button doesn't cause layout shift while it mounts.
    loading: () => <button className="wallet-adapter-button" disabled>Loading…</button>,
  },
);
```

Give `WalletDisconnectButton` / `WalletModalButton` the same treatment if you use them
standalone — any component whose output depends on `localStorage` must be `ssr: false`.

### `app/page.tsx` — using the button

```tsx
import { WalletMultiButtonDynamic } from './wallet-button';

export default function Home() {
  return (
    <main>
      <WalletMultiButtonDynamic />
      {/* your connected-wallet UI, e.g. <ConnectAndSend /> from examples/connect-and-send.tsx */}
    </main>
  );
}
```

`page.tsx` can stay a Server Component: `WalletMultiButtonDynamic` is already a Client
Component with `ssr: false`, so it is skipped on the server and mounted only in the browser.

## The CSS import

The path is **literal and exact**:

```ts
import '@solana/wallet-adapter-react-ui/styles.css';
```

The `@solana/wallet-adapter-react-ui@0.9.39` `package.json` maps `"./styles.css"` in its
`exports` field, so this bare specifier resolves without a relative path or a loader plugin.
Import it **once** — either at the top of `app/providers.tsx` (as above) or in
`app/layout.tsx`. Without it, the modal and `WalletMultiButton` render **unstyled** (a common
"the connect modal looks broken" report). To theme, override the `.wallet-adapter-*` classes in
your own global CSS *after* this import, or skip the CSS entirely and use the headless hook
below.

## Dynamic import: the interop detail

`next/dynamic` resolves either a module with a `default` export or a promise returning a
component. `WalletMultiButton` is a **named** export, so the arrow function `async () =>
(await import(...)).WalletMultiButton` pulls the named component out and returns it. A naive
`dynamic(() => import('@solana/wallet-adapter-react-ui'))` would try to render the *module
object* and fail. The `ssr: false` flag is what actually solves pitfall 2 — it is a Client
Component-only option, which is why the `wallet-button.tsx` file itself is `'use client'`.

**Alternative without `dynamic`:** render the button only after mount with a guard. Slightly
more code, same effect (no server render → no mismatch):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export function ClientOnlyWalletButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <WalletMultiButton /> : null;
}
```

Prefer `dynamic(..., { ssr: false })` — it also keeps the button's code out of the server
bundle, whereas the mounted-guard still imports it server-side.

## The `labels` prop

`WalletMultiButton` (via `BaseWalletMultiButton`) accepts a `labels` map to override the text
for each state. The keys are the full state set:

| Label key | Shown when |
|---|---|
| `no-wallet` | No wallet selected — default "Select Wallet" |
| `has-wallet` | A wallet is selected but not connected — default "Connect" |
| `connecting` | Connection in progress |
| `connected` | Connected (dropdown trigger; normally the truncated address) |
| `disconnect` | Dropdown item to disconnect |
| `change-wallet` | Dropdown item to switch wallets |
| `copy-address` | Dropdown item to copy the address |
| `copied` | Transient state after copying |

```tsx
<WalletMultiButtonDynamic labels={{ 'no-wallet': 'Connect Wallet', connected: 'Account' }} />
```

Only override the keys you want; the rest fall back to defaults.

## Headless alternative (zero SSR headache)

If you want a fully custom button and don't want the CSS import or the dynamic wrapper, use the
headless hook `useWalletMultiButton` from `@solana/wallet-adapter-base-ui@0.1.6`. It returns
state, not markup, so **you** decide what renders — and because it's inside a `'use client'`
component you render conditionally, there's nothing to server-mismatch:

```tsx
'use client';
import { useWalletMultiButton } from '@solana/wallet-adapter-base-ui';

export function MyConnectButton() {
  const { buttonState, publicKey, onConnect, onDisconnect, onSelectWallet } =
    useWalletMultiButton({ onSelectWallet: () => {/* open your wallet picker / modal */} });

  switch (buttonState) {
    case 'no-wallet':    return <button onClick={onSelectWallet}>Select Wallet</button>;
    case 'has-wallet':   return <button onClick={onConnect}>Connect</button>;
    case 'connecting':   return <button disabled>Connecting…</button>;
    case 'connected':    return <button onClick={onDisconnect}>{publicKey?.toBase58().slice(0, 4)}… Disconnect</button>;
    case 'disconnecting':return <button disabled>Disconnecting…</button>;
  }
}
```

`buttonState ∈ 'connecting' | 'connected' | 'disconnecting' | 'has-wallet' | 'no-wallet'`. Full
headless-hook surface: [resources/api-reference.md](../resources/api-reference.md). Runnable
version: [examples/custom-wallet-button.tsx](../examples/custom-wallet-button.tsx).

## Turbopack / Webpack / polyfills

With modern Next.js (App Router, Turbopack or Webpack) you generally **do not need manual Node
polyfills** (`crypto`, `stream`, `buffer` `fallback` entries in `next.config.js`) for the
classic wallet-adapter stack — provided the wallet code lives behind `'use client'` + the button
behind `ssr: false`, so it only bundles for the browser where those globals exist. If a specific
legacy wallet adapter you added by hand pulls a Node-only dependency, the correct fix is still to
keep it out of the server bundle (client boundary), not to add server polyfills. Do **not** add
wallet-adapter imports to Server Components or to module top level as a way to "share" them.

## Guidelines

**DO**
- Put the provider tree in a `'use client'` file; import it from the Server Component layout.
- Import `@solana/wallet-adapter-react-ui/styles.css` exactly once (provider file or layout).
- `useMemo` the endpoint and the (empty) `wallets` array so their identity is stable.
- Dynamically import `WalletMultiButton` with `{ ssr: false }`; add `loading` to avoid layout shift.
- Give `WalletDisconnectButton` / `WalletModalButton` the same `ssr: false` treatment if used standalone.

**DON'T**
- Import `WalletMultiButton` (or any wallet-adapter component) directly into a Server Component.
- Read `window` / `localStorage` at module top level — only inside `useEffect` or event handlers.
- Add `'use client'` to `layout.tsx` just to make imports work — quarantine the client code instead.
- Add Node polyfills to `next.config.js` to "fix" `window is not defined` — fix the boundary.
- Re-list Phantom/Solflare adapters in `wallets` — the App Router changes nothing about auto-registration.

## Common Errors

### Error: `ReferenceError: window is not defined` (build or request)
**Cause:** wallet-adapter code executed on the server — a Server Component imported a provider
or `WalletMultiButton`, or `window`/`localStorage` was read at module scope.
**Solution:** move providers into a `'use client'` file; import `WalletMultiButton` via
`dynamic(..., { ssr: false })`; move any `window`/`localStorage` access into `useEffect`.

### Error: `Hydration failed because the server rendered HTML didn't match the client`
**Cause:** `WalletMultiButton` was server-rendered; its label depends on
`localStorage['walletName']`, which is absent on the server and present on the client.
**Solution:** render it client-only with `dynamic(..., { ssr: false })` (or the mounted-guard
pattern). See pitfall 2 above.

### Error: modal / button appears unstyled
**Cause:** missing the CSS import.
**Solution:** add `import '@solana/wallet-adapter-react-ui/styles.css';` once in the provider
file or the root layout.

### Error: `Cannot destructure property 'publicKey' of 'useWallet(...)'`
**Cause:** a component calling `useWallet()` is rendered outside the `'use client'` provider
subtree.
**Solution:** ensure the component is a descendant of `SolanaProviders` (it must itself be a
Client Component, directly or transitively under the providers).

Broader catalog: [docs/troubleshooting.md](troubleshooting.md).

## References

- Wallet Adapter `APP.md` (setup, CSS import, auto-registration): https://github.com/anza-xyz/wallet-adapter/blob/master/APP.md
- Wallet Adapter `FAQ.md` (provider-wrap errors, feature detection): https://github.com/anza-xyz/wallet-adapter/blob/master/FAQ.md
- Next.js — `next/dynamic` (`ssr: false`): https://nextjs.org/docs/app/api-reference/functions/dynamic
- Next.js — Server and Client Components: https://nextjs.org/docs/app/building-your-application/rendering
- React — Hydration mismatch: https://react.dev/link/hydration-mismatch
- Solana cookbook — Connect Wallet with React: https://solana.com/developers/cookbook/wallets/connect-wallet-react
</content>
</invoke>
