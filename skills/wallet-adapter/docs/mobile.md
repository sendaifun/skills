# Mobile Wallet Adapter (MWA)

How wallet connection works on mobile — for both the classic `@solana/wallet-adapter` stack and
the modern Wallet Standard path. The headline: on the classic path you get MWA **for free** on
Android mobile web (no adapter code), and on the modern path you register it once and even get a
desktop→phone QR ("Remote") flow. This is the long form of SKILL.md's "Mobile" section.

> **Android-only at the protocol level.** The Mobile Wallet Adapter protocol has **no iOS
> implementation** — there is no in-browser MWA on iOS. On iOS, users connect via a wallet's own
> in-app browser (which injects a Wallet Standard wallet) or a deep link. Everywhere, keep
> feature-detecting `signMessage` / `signIn` / v0 support — mobile changes discovery, not the
> per-wallet capability contract.

---

## Classic path: MWA is auto-injected on mobile web

Inside `WalletProvider`, when `getEnvironment()` detects a **mobile-web** environment and no MWA
adapter is already present, it constructs and **prepends** a `SolanaMobileWalletAdapter` (from
`@solana-mobile/wallet-adapter-mobile@2.2.9`) with sensible defaults:

```ts
// This is what WalletProvider does internally — you do NOT write it.
new SolanaMobileWalletAdapter({
  addressSelector: createDefaultAddressSelector(),
  appIdentity: { uri: `${location.protocol}//${location.host}` },
  authorizationResultCache: createDefaultAuthorizationResultCache(), // localStorage-backed
  cluster: getInferredClusterFromEndpoint(connection?.rpcEndpoint),   // from ConnectionProvider
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
});
```

Consequences:

- On an **Android mobile browser**, the user can connect to any installed MWA-compatible wallet
  **without you adding any adapter** — the same `wallets={[]}` provider you already wrote
  (see [../SKILL.md](../SKILL.md) "Provider setup") just works.
- The injected MWA adapter supports `signIn`, `signMessage`, `signTransaction`,
  `signAllTransactions`, and `sendTransaction`, and advertises `supportedTransactionVersions`
  including **v0** — so SIWS and versioned transactions work on mobile too.
- The `cluster` is inferred from your `ConnectionProvider` endpoint, so devnet/mainnet follows
  the RPC you configured.

### Do not `disconnect()` MWA casually

Disconnecting the MWA adapter **wipes its authorization cache**, so the next connect requires a
fresh in-wallet approval. `WalletProvider` special-cases this: selecting a *different* wallet does
**not** disconnect MWA. But an explicit `disconnect()` in your code does — reserve it for an
explicit user "sign out". (See [troubleshooting.md](troubleshooting.md), "connecting to MWA works
once, then re-prompts".)

---

## `autoConnect` semantics (precise)

`WalletProvider`'s `autoConnect` prop defaults to **`false`**. Set it (a boolean or a predicate)
to reconnect the wallet whose name is stored under `localStorageKey` (default `'walletName'`) on
load:

- On mount, if `autoConnect` is truthy and an adapter matches the remembered name, the provider
  calls `adapter.autoConnect()` — a **silent** reconnect that must not pop a window — or
  `adapter.connect()` if the user just selected it this session.
- **Auto-connect never triggers a wallet popup for a first-time user.** With no stored wallet name
  it does nothing; it only silently re-authorizes a previously-approved wallet.
- For MWA specifically, `BaseSolanaMobileWalletAdapter.autoConnect()` re-uses the **cached MWA
  authorization**. The old method name `autoConnect_DO_NOT_USE_OR_YOU_WILL_BE_FIRED()` is
  **deprecated** — use `autoConnect()`.
- To expose a user-facing "remember me" toggle, the official starter keeps a separate
  `useLocalStorage('autoConnect', true)` context (`AutoConnectProvider`) — independent of the
  wallet-name key — and feeds its value into the `autoConnect` prop.

```tsx
// Silent reconnect of the remembered wallet (Android MWA re-uses its cached authorization).
<WalletProvider wallets={[]} autoConnect>{children}</WalletProvider>
```

For the **one-click SIWS-on-load** variant (`autoConnect` as an async predicate), see
[siws-and-auth.md](siws-and-auth.md).

---

## Modern path: `registerMwa` (Wallet Standard + desktop QR)

For the modern Wallet Standard / `@solana/react` stack (see [modern-stack.md](modern-stack.md)),
you register MWA **once at startup** as a Wallet Standard wallet, using
`@solana-mobile/wallet-standard-mobile@0.5.3`. It then appears in any Wallet-Standard UI — and,
via `remoteHostAuthority`, in a **desktop→phone "Remote" QR** flow:

```tsx
'use client';
import {
  registerMwa,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-standard-mobile';

// Call ONCE, at app startup (module scope or a top-level effect). It registers MWA on the
// Wallet Standard registry so useWallets()/wallet-ui pick it up like any other wallet.
registerMwa({
  appIdentity: { name: 'My App', uri: 'https://myapp.com', icon: 'favicon.ico' },
  authorizationCache: createDefaultAuthorizationCache(),
  chains: ['solana:devnet', 'solana:mainnet'],
  chainSelector: createDefaultChainSelector(),
  onWalletNotFound: createDefaultWalletNotFoundHandler(),
  // remoteHostAuthority: '<your-host>', // OPTIONAL: enables the desktop→phone Remote/QR flow
});
```

What it exposes:

- **`LocalSolanaMobileWalletAdapterWallet`** — the on-device wallet (Android mobile web).
- **`RemoteSolanaMobileWalletAdapterWallet`** — the desktop wallet that scans a QR to drive an
  Android phone (only when `remoteHostAuthority` is set).
- Both register under `SolanaMobileWalletAdapterWalletName = 'Mobile Wallet Adapter'`.

Because this path goes through the Wallet Standard registry, the low-level `@solana/react` hooks
(`useWallets()` → `UiWalletAccount` → signers) treat MWA exactly like a browser-extension wallet —
see [../examples/modern-solana-react.tsx](../examples/modern-solana-react.tsx).

---

## Which mobile path?

| Situation | Path | Why |
|---|---|---|
| Existing classic wallet-adapter app, Android mobile web | **Nothing to do** | `WalletProvider` auto-injects `SolanaMobileWalletAdapter`; `wallets={[]}` is enough. |
| Modern Wallet Standard / `@solana/react` / `@wallet-ui/react` app | **`registerMwa(...)`** once at startup | Registers MWA on the Standard registry; opt into desktop QR with `remoteHostAuthority`. |
| Native React Native app | **Solana Mobile stack (out of scope here)** | Uses `@solana-mobile/mobile-wallet-adapter-protocol` directly, not the web adapter. |

---

## Guidelines

**DO**
- Rely on classic auto-injection on Android mobile web — keep `wallets={[]}`.
- Call `registerMwa(...)` exactly once at startup on the modern path; set `remoteHostAuthority`
  only if you want the desktop QR flow.
- Keep feature-detecting `signMessage` / `signIn` / `supportedTransactionVersions.has(0)` — mobile
  wallets vary just like desktop ones.
- Reserve `disconnect()` on MWA for an explicit user sign-out.

**DON'T**
- Expect MWA on **iOS** — the protocol is Android-only; iOS users connect via a wallet's in-app
  browser or a deep link.
- Call `disconnect()` on MWA casually — it wipes the authorization cache and forces re-approval.
- Use the deprecated `autoConnect_DO_NOT_USE_OR_YOU_WILL_BE_FIRED()` — use `autoConnect()`.
- Register a manual `SolanaMobileWalletAdapter` on the classic path — the provider already injects
  one on mobile web (a duplicate can shadow it).

---

## Common Errors

### Error: MWA connects once, then re-prompts every load / loses authorization
**Cause:** something calls `disconnect()` on the MWA adapter, wiping its authorization cache.
**Solution:** avoid casual `disconnect()`; let `WalletProvider` manage the MWA lifecycle. See
[troubleshooting.md](troubleshooting.md).

### Error: no MWA option appears on iOS
**Cause:** MWA has no iOS protocol implementation — this is expected, not a bug.
**Solution:** on iOS, connect through the wallet's in-app browser (which injects a Wallet Standard
wallet) or a deep link; do not depend on in-browser MWA there.

### Error: desktop shows no QR / Remote wallet
**Cause:** `registerMwa` was called without `remoteHostAuthority`, so only the local (on-device)
wallet is registered.
**Solution:** set `remoteHostAuthority` to enable `RemoteSolanaMobileWalletAdapterWallet`.

---

## References

- Solana Mobile docs (MWA protocol, Android-only): https://docs.solanamobile.com
- `@solana-mobile/wallet-adapter-mobile` (classic MWA adapter): https://www.npmjs.com/package/@solana-mobile/wallet-adapter-mobile
- `@solana-mobile/wallet-standard-mobile` (`registerMwa`, Remote/QR): https://www.npmjs.com/package/@solana-mobile/wallet-standard-mobile
- `WalletProvider` source (mobile-web auto-injection, autoConnect logic): https://github.com/anza-xyz/wallet-adapter/blob/master/packages/core/react/src/WalletProvider.tsx
- Modern stack overview: [modern-stack.md](modern-stack.md)
</content>
