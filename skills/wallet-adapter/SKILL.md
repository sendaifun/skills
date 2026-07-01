---
name: wallet-adapter
description: Connect Solana wallets in web apps: the @solana/wallet-adapter React stack (ConnectionProvider/WalletProvider/WalletMultiButton, useWallet/useConnection) plus the modern Wallet Standard / framework-kit (@solana/client, @solana/react, @wallet-ui) path for new apps. Covers connect/disconnect, sending transactions, signMessage, Sign In With Solana (SIWS), Next.js App Router (SSR) integration, autoConnect, and mobile. Use when adding wallet connection, transaction signing, or wallet auth to a Solana dApp frontend.
---

# Solana Wallet Adapter

The standard way to connect wallets, sign, and send from a Solana web app — plus the modern Wallet Standard + Kit stack that is starting to replace it. This skill gets you a correct provider tree, a working "Connect Wallet" button, transaction signing, and secure Sign In With Solana (SIWS) auth without the usual SSR and feature-detection footguns.

## Overview

Every Solana dApp needs to answer one question: *how does the user's wallet sign things?* A decade ago this meant integrating each wallet (Phantom, Solflare, Backpack, …) by hand. The **Wallet Standard** fixed that: wallets now register themselves on `window`, and any app discovers all of them through one interface — no per-wallet code.

There are two live React stacks built on that base:

- **Classic `@solana/wallet-adapter`** — the dominant integration (`@solana/wallet-adapter-react` is ~662k weekly downloads, more than every modern React wallet layer combined). Battle-tested, works with React 18 and 19, but built on **`@solana/web3.js` v1** and in **maintenance mode** (core packages last shipped 2025-06-10; Anza accepts bug fixes, not new features). **Not deprecated.** Lead here for compatibility with existing code and tutorials.
- **Modern Wallet Standard + Kit** — for greenfield apps on `@solana/kit`. Three sub-paths: the Solana Foundation **framework-kit** (`@solana/client` + `@solana/react-hooks`, the `create-solana-dapp` default), the low-level **`@solana/react`** hooks, and the drop-in **`@wallet-ui/react`** component library. All discover the *same* wallets; the difference is React ergonomics and whether you're on web3.js v1 or Kit.

Both paths sit on the same Wallet Standard registry, so the choice is about ergonomics and your client library — not which wallets are supported. This skill leads with the classic stack (deep, copy-paste-ready) and gives the modern stack a clearly-labeled first-class section.

> Program IDs / on-chain addresses are not relevant to this skill — wallet-adapter is a client-side signing layer. All addresses here are npm package names and RPC endpoints.

## Which stack? Decision table

| You want… | Use | Client lib | Notes |
|---|---|---|---|
| Max ecosystem/tutorial compatibility, existing web3.js v1 code | **Classic `@solana/wallet-adapter`** | web3.js v1 | ~662k dl/wk, maintenance mode, not deprecated. **Default choice today.** |
| Fastest official greenfield path, batteries included | **framework-kit** (`@solana/client` + `@solana/react-hooks`) | Kit (v5, transitive) | The `create-solana-dapp` Kit template default: one `SolanaProvider` + rich hooks (`useWalletConnection`, `useBalance`, `useSolTransfer`). |
| Full control over Kit tx building | **`@solana/react`** (low-level) + `@wallet-standard/react` | Kit v7 | `UiWalletAccount` → Kit signers (`useWalletAccountTransactionSendingSigner`, `useSignIn`). Used by Kit's own example app. |
| A polished connect dropdown/modal with minimal code | **`@wallet-ui/react`** | Kit v6 | Drop-in `WalletUiDropdown` / `WalletUiModal`, built on `@solana/react`. |
| Just data hooks over Kit (no wallet connect) | `gill` + `@gillsdk/react` | Kit | Pair with any wallet layer above. Does not connect wallets. |

**Recommendation:** classic for compatibility and most tutorials; modern for greenfield apps already on `@solana/kit`. **Version-skew warning:** the three modern React layers each pin a *different* Kit generation — framework-kit → **Kit v5** (transitive), `@wallet-ui/react` 4.2 → **Kit v6**, `@solana/react` 7 → **Kit v7**. Installing `@solana/kit@7` directly *alongside* framework-kit yields **two Kit copies**. Pin exact versions and don't mix layers casually. See [docs/modern-stack.md](docs/modern-stack.md).

## Install (classic)

You **no longer install a package per wallet.** `WalletProvider` auto-registers every Wallet Standard wallet (Phantom, Solflare, Backpack, Coinbase, …) and injects Mobile Wallet Adapter on mobile web. Install only the core stack:

```shell
npm install --save \
  @solana/wallet-adapter-base@0.9.27 \
  @solana/wallet-adapter-react@0.15.39 \
  @solana/wallet-adapter-react-ui@0.9.39 \
  @solana/web3.js@1.98.4 \
  react
```

Optional: `@solana/wallet-adapter-wallets@0.19.38` only if you need a dev burner (`UnsafeBurnerWalletAdapter`), WalletConnect, or a legacy wallet that has *not* adopted the Wallet Standard. Do **not** pull it in just to list Phantom/Solflare — that's redundant and can double entries. Full pins and peer deps: [resources/api-reference.md](resources/api-reference.md).

> These packages peer-depend on `@solana/web3.js` `^1.98.0` and `react: "*"` — they work with **React 18 and React 19**. The classic stack has **not** migrated to `@solana/kit`; its types are web3.js v1 (`PublicKey`, `Transaction`, `VersionedTransaction`, `Connection`).

## Provider setup

Wrap your app in exactly this order — `ConnectionProvider` → `WalletProvider` → `WalletModalProvider` (the modal needs both contexts). Every component that calls `useWallet()` / `useConnection()` must be nested inside.

```tsx
import { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Required once; ships with the react-ui package. Exact path — see note below.
import '@solana/wallet-adapter-react-ui/styles.css';

export const SolanaProviders: FC<{ children: ReactNode }> = ({ children }) => {
  const network = WalletAdapterNetwork.Devnet; // 'devnet' | 'testnet' | 'mainnet-beta'
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  // Empty is correct. Every Wallet Standard wallet is auto-detected, and Mobile
  // Wallet Adapter is auto-injected on mobile web. Only add adapters here for
  // wallets that do NOT implement the Wallet Standard, or dev-only adapters.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletMultiButton />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
```

Key points:

- **`wallets={[]}` is intentional.** `WalletProvider` internally calls `useStandardWalletAdapters()`, which subscribes to the Wallet Standard registry and wraps each registered wallet in a `StandardWalletAdapter`, de-duplicating by name. Wallets installed *after* page load appear automatically via the `wallet-standard:register-wallet` event. Hand-listing Phantom/Solflare adapters is obsolete.
- **`autoConnect`** silently re-authorizes the last-used wallet (persisted to `localStorage['walletName']`, override via `localStorageKey`). It **never** pops a wallet dialog for a first-time user. It also accepts a predicate `(adapter) => Promise<boolean>` — the hook for one-click SIWS on load (see [docs/siws-and-auth.md](docs/siws-and-auth.md)).
- **CSS import path is exact:** `@solana/wallet-adapter-react-ui/styles.css`. Without it the modal/button render unstyled. Override the `.wallet-adapter-*` classes to theme.
- **Next.js App Router:** this whole tree must live behind a `'use client'` boundary and `WalletMultiButton` must be dynamically imported with `{ ssr: false }`. See [Next.js App Router](#nextjs-app-router) below and [docs/nextjs-app-router.md](docs/nextjs-app-router.md).

Runnable provider: [examples/nextjs-providers.tsx](examples/nextjs-providers.tsx). Drop-in boilerplate: [templates/WalletProviders.tsx](templates/WalletProviders.tsx). Provider prop reference (`ConnectionProviderProps`, `WalletProviderProps`, `WalletModalProviderProps`): [resources/api-reference.md](resources/api-reference.md).

## `useWallet()` and `useConnection()`

`useWallet()` returns the full `WalletContextState`:

```ts
interface WalletContextState {
  autoConnect: boolean;
  wallets: Wallet[];            // all available wallets, each with readyState
  wallet: Wallet | null;        // currently selected
  publicKey: PublicKey | null;  // connected account (null until connected)
  connecting: boolean;
  connected: boolean;
  disconnecting: boolean;

  select(walletName: WalletName | null): void;  // choose a wallet by branded name
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  sendTransaction: WalletAdapterProps['sendTransaction'];                      // ALWAYS present
  signTransaction?:     SignerWalletAdapterProps['signTransaction'];            // optional
  signAllTransactions?: SignerWalletAdapterProps['signAllTransactions'];        // optional
  signMessage?:         MessageSignerWalletAdapterProps['signMessage'];         // optional
  signIn?:              SignInMessageSignerWalletAdapterProps['signIn'];        // optional (SIWS)
}
```

`useConnection()` returns `{ connection: Connection }` (a web3.js v1 `Connection`).

**The single most important rule: `sendTransaction` is the only signing method guaranteed to exist.** `signTransaction`, `signAllTransactions`, `signMessage`, and `signIn` are `| undefined` — **you MUST feature-detect** before calling. This is the #1 cause of `"signMessage is not a function"` bugs.

```ts
const { signMessage } = useWallet();
if (!signMessage) throw new Error('This wallet does not support message signing');
const signature = await signMessage(new TextEncoder().encode('Hello Solana'));
```

For Anchor, `useAnchorWallet()` returns the `{ publicKey, signTransaction, signAllTransactions }` shape `AnchorProvider` expects (or `undefined` until a signing wallet connects). Full hook surface and `readyState` values: [resources/api-reference.md](resources/api-reference.md).

## Sending a transaction

`sendTransaction(tx, connection, options?)` **signs and broadcasts** through the wallet's own logic (wallets often set their own preflight/priority), returning the signature string. Then confirm against a fresh `lastValidBlockHeight`:

```tsx
'use client';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletNotConnectedError } from '@solana/wallet-adapter-base';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { FC, useCallback } from 'react';

export const SendSol: FC = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const onClick = useCallback(async () => {
    if (!publicKey) throw new WalletNotConnectedError();

    const lamports = await connection.getMinimumBalanceForRentExemption(0);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: Keypair.generate().publicKey, lamports }),
    );

    const {
      context: { slot: minContextSlot },
      value: { blockhash, lastValidBlockHeight },
    } = await connection.getLatestBlockhashAndContext();

    // Wallet signs AND broadcasts; returns the signature.
    const signature = await sendTransaction(tx, connection, { minContextSlot });
    await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
  }, [publicKey, sendTransaction, connection]);

  return <button onClick={onClick} disabled={!publicKey}>Send SOL</button>;
};
```

- Pass `minContextSlot` (from `getLatestBlockhashAndContext`) through both `sendTransaction` and `confirmTransaction` — it guards against the wallet using a stale RPC node.
- **`sendTransaction` vs `signTransaction`:** use `sendTransaction` for the normal sign-and-send path. Use `signTransaction` (feature-detected) only when you need the *signed but unsent* bytes — to relay, bundle, or co-sign server-side.
- **`VersionedTransaction` (v0):** gate on wallet capability first — not all wallets sign v0:

  ```ts
  const { wallet } = useWallet();
  const supported = wallet?.adapter.supportedTransactionVersions; // Set<TransactionVersion> | undefined
  if (!supported?.has(0)) throw new Error("Wallet doesn't support v0 transactions");
  ```

Full legacy + v0 treatment, address-lookup tables, and extra co-signers: [docs/sending-transactions.md](docs/sending-transactions.md). Runnable: [examples/connect-and-send.tsx](examples/connect-and-send.tsx). For priority fees, robust rebroadcast, and confirmation strategy, cross-link the **transaction-landing** skill ([../transaction-landing/SKILL.md](../transaction-landing/SKILL.md)) — wallet-adapter delegates broadcast to the wallet, so landing concerns still apply.

## UI components

From `@solana/wallet-adapter-react-ui@0.9.39`:

- **`WalletMultiButton`** — the all-in-one you want 95% of the time. Shows "Select Wallet" → opens the modal → after connect shows the truncated address with a dropdown (copy address / change wallet / disconnect). Accepts standard `ButtonProps` plus a `labels` override map.
- **`WalletModalButton`** — opens the connect modal only; pair with your own connected-state UI.
- **`WalletConnectButton`**, **`WalletDisconnectButton`**, **`WalletIcon`**, and themeable bases (`BaseWalletMultiButton`, …).
- **`useWalletModal()`** → `{ visible, setVisible }` to open the modal programmatically.

For a **custom button with no CSS dependency**, use the headless hook `useWalletMultiButton` from `@solana/wallet-adapter-base-ui@0.1.6`:

```tsx
import { useWalletMultiButton } from '@solana/wallet-adapter-base-ui';

function MyButton() {
  const { buttonState, publicKey, onConnect, onDisconnect, onSelectWallet } =
    useWalletMultiButton({ onSelectWallet: () => {/* open your wallet picker */} });
  // buttonState: 'connecting' | 'connected' | 'disconnecting' | 'has-wallet' | 'no-wallet'
  // ...render your own markup driven by buttonState
}
```

Runnable custom button: [examples/custom-wallet-button.tsx](examples/custom-wallet-button.tsx).

## Sign In With Solana (SIWS) and auth

SIWS is the Wallet Standard **`solana:signIn`** feature. It merges `connect` + `signMessage` into **one** wallet prompt where **the wallet builds the message** (the dApp supplies only fields), enabling domain-binding and phishing warnings. Prefer it over ad-hoc `signMessage` auth for new apps. Modeled on EIP-4361 (Sign-In With Ethereum).

```tsx
import { useWallet } from '@solana/wallet-adapter-react';
import type { SolanaSignInInput } from '@solana/wallet-standard-features';

const { signIn, publicKey } = useWallet();

async function onSignIn() {
  if (!signIn) throw new Error('Wallet does not support Sign In With Solana!');
  const input: SolanaSignInInput = {
    domain: window.location.host,
    address: publicKey?.toBase58(),  // optional; wallet fills it if omitted
    statement: 'Sign in to Example App.',
    nonce: serverNonce,               // fetch a fresh, single-use nonce from your backend
  };
  const output = await signIn(input); // { account, signedMessage, signature }
  // Send { input, output } to the server and verify there — this is authoritative.
}
```

**Security is server-side.** `verifySignIn(input, output)` from `@solana/wallet-standard-util@1.1.3` re-parses the returned message, checks it against `input`, and verifies the Ed25519 signature. But it does **not** enforce your freshness policy — the server must *additionally* confirm the nonce is one you issued and unused (replay), the `domain` matches your host, and the `issuedAt`/`expirationTime` window is valid. Never trust client-side verification alone. Full flow (client component, server route, `autoConnect` predicate, ABNF message format, `signMessage` fallback): [docs/siws-and-auth.md](docs/siws-and-auth.md). Runnable: [examples/siws-signin.tsx](examples/siws-signin.tsx), [examples/verify-siws.ts](examples/verify-siws.ts).

## Next.js App Router

Three hydration pitfalls, three fixes:

1. **Providers touch `window`/`localStorage`** → the provider component needs `'use client'`.
2. **`WalletMultiButton`'s label comes from `localStorage['walletName']`** → if server-rendered it prints "Select Wallet", then the client swaps it, causing a **hydration mismatch**. Fix: render it client-only with `dynamic(..., { ssr: false })`.
3. **`window is not defined`** if any wallet code runs during SSR/prerender → keep the whole subtree behind `'use client'` + the button behind `ssr:false`.

```tsx
'use client';
import dynamic from 'next/dynamic';

export const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false },
);
```

A Server Component root layout wraps the `'use client'` provider; the button is imported dynamically. Full `app/providers.tsx` + `app/layout.tsx` + the dynamic button, plus Turbopack/polyfill notes: [docs/nextjs-app-router.md](docs/nextjs-app-router.md). Drop-in: [templates/WalletProviders.tsx](templates/WalletProviders.tsx), [templates/WalletButtonDynamic.tsx](templates/WalletButtonDynamic.tsx).

## Modern / current-recommended path

For greenfield apps on `@solana/kit`, the Wallet Standard-native stack replaces the monolithic `useWallet()` with hooks that operate on `UiWalletAccount` handles. The Foundation's **framework-kit** is the `create-solana-dapp` default:

```tsx
// app/components/providers.tsx  — verbatim shape from the kit/nextjs template
'use client';
import { SolanaProvider } from '@solana/react-hooks';
import { autoDiscover, createClient } from '@solana/client';
import { PropsWithChildren } from 'react';

const client = createClient({
  endpoint: 'https://api.devnet.solana.com',
  walletConnectors: autoDiscover(), // auto-detect all Wallet Standard wallets
});

export function Providers({ children }: PropsWithChildren) {
  return <SolanaProvider client={client}>{children}</SolanaProvider>;
}
```

```tsx
'use client';
import { useWalletConnection } from '@solana/react-hooks';

export default function Home() {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  if (wallet) return <button onClick={() => disconnect()}>Disconnect {wallet.account.address.toString()}</button>;
  return connectors.map((c) => (
    <button key={c.id} onClick={() => connect(c.id)} disabled={status === 'connecting'}>Connect {c.name}</button>
  ));
}
```

The two alternates: **`@solana/react`** (low-level Kit signers — `useWalletAccountTransactionSendingSigner`, `useSignIn`, `useSignAndSendTransaction`) and **`@wallet-ui/react`** (drop-in `WalletUiDropdown` / `WalletUiModal`). Remember the **Kit version skew** (framework-kit→v5, `@wallet-ui/react`→v6, `@solana/react`→v7) — build the client at module scope and pin exactly. Full coverage of all three sub-paths, `SolanaClientConfig`, SSR `isReady` gating, and a Kit-native memo example: [docs/modern-stack.md](docs/modern-stack.md). Runnable: [examples/modern-framework-kit.tsx](examples/modern-framework-kit.tsx), [examples/modern-solana-react.tsx](examples/modern-solana-react.tsx).

## Mobile

- **Android mobile web (classic path):** Mobile Wallet Adapter (MWA) is **auto-injected** by `WalletProvider` when it detects a mobile-web environment — the user connects to any installed MWA wallet with **no adapter code**. MWA is Android-only at the protocol level (no iOS MWA). Do **not** call `disconnect()` on MWA casually — it wipes the authorization cache.
- **Modern / desktop QR:** for the Wallet Standard stack, register MWA once at startup with `registerMwa(...)` from `@solana-mobile/wallet-standard-mobile@0.5.3`. It exposes a local on-device wallet and a **Remote** desktop→phone QR flow (`remoteHostAuthority`).

Full MWA lifecycle, `autoConnect` semantics, and `registerMwa` config: [docs/mobile.md](docs/mobile.md).

## Guidelines

**DO**
- Wrap providers in the exact order `ConnectionProvider` → `WalletProvider` → `WalletModalProvider`, all client-side.
- Import `@solana/wallet-adapter-react-ui/styles.css` once (or replicate the classes).
- Pass `wallets={[]}` and rely on Wallet Standard auto-registration.
- **Feature-detect** `signTransaction` / `signAllTransactions` / `signMessage` / `signIn` before calling — they can be `undefined`.
- Gate `VersionedTransaction` on `wallet.adapter.supportedTransactionVersions?.has(0)`.
- Dynamically import `WalletMultiButton` with `{ ssr: false }` in Next.js App Router.
- Confirm with a fresh `blockhash` + `lastValidBlockHeight` (+ `minContextSlot`).
- **Verify SIWS / `signMessage` server-side**; enforce nonce/domain/timestamp policy yourself.
- Use `useAnchorWallet()` to build an Anchor `AnchorProvider`.

**DON'T**
- Hand-list per-wallet adapters (Phantom/Solflare/Backpack auto-register; double-listing duplicates entries).
- Assume `signMessage`/`signIn` exists — only `sendTransaction` is guaranteed.
- Assume `sendTransaction` merely signs — it signs **and** broadcasts, returning the signature.
- Use `@solana/wallet-adapter-backpack` (dead since 2023; Backpack auto-registers).
- Import wallet-adapter code in Server Components or at module top level.
- Expect `@solana/kit` types from the classic stack — it's web3.js v1.
- Mix the classic web3.js-v1 signing path with Kit in the same flow without an explicit bridge, and don't mix modern React layers that pin different Kit majors (two Kit copies).
- Treat user-rejection (`4001`) as an error to retry.

## Common Errors

### Error: `WalletNotConnectedError`
**Cause:** calling `sendTransaction` / `signMessage` / etc. while `publicKey` is `null`. Class is from `@solana/wallet-adapter-base`.
**Solution:** guard `if (!publicKey) throw new WalletNotConnectedError();` and disable the action button until `connected`.

### Error: `WalletNotSelectedError`
**Cause:** an operation needs a selected wallet but none is chosen. Class is from `@solana/wallet-adapter-react` (NOT `-base`).
**Solution:** open the modal with `useWalletModal().setVisible(true)` or call `select(walletName)` first; ensure `WalletModalProvider` wraps the tree.

### Error: user rejection (`4001`)
**Cause:** the user declined in the wallet. Surfaces as `WalletSignTransactionError` / `WalletSignMessageError` / `WalletConnectionError` wrapping the wallet's provider code **`4001`** ("User rejected the request").
**Solution:** catch and treat as non-fatal (`error?.code === 4001` or message match); show a soft "request cancelled" state; do **not** auto-retry. Central handling via `WalletProvider onError`.

### Error: `window is not defined` / hydration mismatch
**Cause:** wallet/provider code running during SSR, or `WalletMultiButton` server-rendered (its label depends on `localStorage`).
**Solution:** put the provider tree behind `'use client'`; import `WalletMultiButton` via `dynamic(..., { ssr: false })`; never read `window`/`localStorage` at module top level. See [docs/nextjs-app-router.md](docs/nextjs-app-router.md).

### Error: `"signMessage is not a function"` (or `signIn`/`signTransaction`)
**Cause:** using an optional method without feature-detecting; it's `undefined` on wallets that lack the feature.
**Solution:** `if (!signMessage) throw …` before calling. Only `sendTransaction` is guaranteed present.

### Error: "Wallet doesn't support versioned transactions"
**Cause:** building a `VersionedTransaction` for a wallet whose `adapter.supportedTransactionVersions` is `undefined` or lacks `0`.
**Solution:** feature-gate on `supportedTransactionVersions?.has(0)`; fall back to a legacy `Transaction`.

### Error: `Cannot destructure property 'publicKey' of 'useWallet(...)'`
**Cause:** the component is not wrapped by `WalletProvider` / `ConnectionProvider`.
**Solution:** ensure it's a descendant of the providers (App Router: inside the `'use client'` provider subtree).

Broader catalog with fixes: [docs/troubleshooting.md](docs/troubleshooting.md).

## Files in This Skill

```
skills/wallet-adapter/
  SKILL.md                          # this file — authoritative entry point
  docs/
    mobile.md                       # MWA auto-injection + registerMwa (desktop QR), autoConnect semantics
    modern-stack.md                 # framework-kit + @solana/react + @wallet-ui, version skew, Kit signers
    nextjs-app-router.md            # App Router SSR: 'use client', dynamic ssr:false, CSS, hydration
    sending-transactions.md         # legacy Transaction + v0, lookup tables, sendTransaction vs signTransaction, confirm
    siws-and-auth.md                # SIWS deep dive, server verification, signMessage fallback, autoConnect SIWS
    troubleshooting.md              # full error catalog
  resources/
    api-reference.md                # WalletContextState, hooks, provider props, UI components, base-ui hooks; version matrix + peer deps
  examples/
    connect-and-send.tsx            # connect + send a v0 VersionedTransaction, capability gating, confirm
    custom-wallet-button.tsx        # headless useWalletMultiButton + useWalletModal
    modern-framework-kit.tsx        # modern framework-kit path (SolanaProvider + hooks)
    modern-solana-react.tsx         # modern @solana/react low-level Kit v7 signers path
    nextjs-providers.tsx            # classic 3-provider tree for the App Router
    siws-signin.tsx                 # SIWS button (client) + signMessage fallback
    verify-siws.ts                  # SIWS server: challenge + verifySignIn + freshness policy
  templates/
    WalletButtonDynamic.tsx         # drop-in dynamic ssr:false WalletMultiButton wrapper
    WalletProviders.tsx             # drop-in classic provider boilerplate (endpoint prop)
```

## References

- Wallet Adapter repo (Anza): https://github.com/anza-xyz/wallet-adapter — `APP.md`, `FAQ.md`, `PACKAGES.md`
- Wallet Adapter live demo: https://anza-xyz.github.io/wallet-adapter/example
- Solana cookbook — Connect Wallet with React: https://solana.com/developers/cookbook/wallets/connect-wallet-react
- Wallet Standard: https://github.com/wallet-standard/wallet-standard
- Solana Foundation framework-kit: https://github.com/solana-foundation/framework-kit
- `@solana/react` / Kit docs: https://www.solanakit.com
- Wallet UI: https://github.com/wallet-ui/wallet-ui — https://wallet-ui.dev
- Sign In With Solana (Phantom): https://github.com/phantom/sign-in-with-solana — https://phantom.com/learn/developers/sign-in-with-solana
- Mobile Wallet Adapter: https://docs.solanamobile.com

> Related skill: **blinks-actions** renders Solana Action URLs and reuses this classic `WalletProvider` stack (`@dialectlabs/blinks` requires it) — see that skill when building Blinks.
